// Emiten chatbot backend.
//
// Two layers over one engine:
//   1. A deterministic Indonesian parser that screens all 962 emiten. Always
//      available, no key, no cost, instant.
//   2. Claude, enabled only when ANTHROPIC_API_KEY is present. It does not get
//      to invent numbers — it calls the SAME query engine as a tool and writes
//      prose around whatever that returns.
//
// Layer 2 never replaces layer 1: if Claude is unreachable or errors, the
// deterministic answer is what the user sees.
//
// Claude gets TWO tools, and the split matters. `screen_emiten` answers "which
// stocks match X" across the whole exchange. `kupas_emiten` answers "tell me
// about THIS stock" and returns a single dossier — price and trend, the three
// hard screener rules, liquidity and foreign flow, the financial statements,
// and the controlling group if it has one. Without the second tool a question
// like "kupas BBRI" degenerates into a one-row screen, and the model fills the
// gap from memory, which is exactly what this file exists to prevent.

import Anthropic from '@anthropic-ai/sdk';
import { MarketDatabase } from '../data/marketRepository';
import { EmitenQuote, EmitenStatements, FundamentalsDatabase } from '../data/fundamentalsRepository';
import { computeAllFactors } from '../models/factorEngine';
import { FactorSnapshot } from '../types/market';
import {
  EmitenQuery,
  QueryResult,
  formatRowsAsText,
  parseIndonesianQuery,
  queryEmiten,
} from '../models/emitenQueryEngine';
import { runStockScreener } from '../models/stockScreener';
import { groupOf } from '../data/conglomerates';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatAnswer {
  reply: string;
  /** Structured rows so the UI can render a table rather than parse prose. */
  rows: QueryResult['rows'];
  totalMatched: number;
  appliedFilters: string[];
  engine: 'lokal' | 'claude';
  understood: string[];
  note?: string;
}

// Factor computation walks every emiten's full history, so it is cached for the
// lifetime of the process and rebuilt only when the database object changes.
let factorCache: { db: MarketDatabase; factors: Map<string, FactorSnapshot> } | null = null;

function factorsFor(db: MarketDatabase): Map<string, FactorSnapshot> {
  if (!factorCache || factorCache.db !== db) {
    factorCache = { db, factors: computeAllFactors(db) };
  }
  return factorCache.factors;
}

function describe(result: QueryResult, understood: string[], fellBack: boolean): string {
  if (!result.rows.length) {
    return fellBack
      ? 'Saya belum menemukan emiten yang cocok. Coba sebutkan sektor, batas P/E, likuiditas, atau kode emitennya — misalnya "saham batu bara P/E di bawah 10 yang likuid".'
      : `Tidak ada emiten yang memenuhi ${understood.join(', ')}. Coba longgarkan salah satu kriterianya.`;
  }

  const head = understood.length
    ? `Kriteria yang saya pakai: ${understood.join(', ')}.`
    : `Pencarian kata kunci.`;

  return `${head} Ditemukan ${result.totalMatched} emiten, menampilkan ${result.rows.length} teratas berdasarkan ${result.sortLabel}.`;
}

export function answerLocally(
  message: string,
  db: MarketDatabase,
  fundamentals: FundamentalsDatabase
): ChatAnswer {
  const parsed = parseIndonesianQuery(message);
  const factors = factorsFor(db);
  const result = queryEmiten(db, factors, fundamentals, parsed.query);

  return {
    reply: describe(result, parsed.understood, parsed.fellBackToTextSearch),
    rows: result.rows,
    totalMatched: result.totalMatched,
    appliedFilters: result.appliedFilters,
    engine: 'lokal',
    understood: parsed.understood,
  };
}

// ------------------------------------------------------------------- Claude

const SCREEN_TOOL = {
  name: 'screen_emiten',
  description:
    'Screen every emiten listed on the Indonesia Stock Exchange (IDX). Returns matching companies with price, market cap, liquidity, returns, P/E, P/BV, dividend yield and 20-day net foreign flow. Use this for ANY question about Indonesian stocks — never answer from memory, because this tool holds the live database.',
  input_schema: {
    type: 'object' as const,
    properties: {
      text: { type: 'string', description: 'Keyword match on ticker, company name, industry or business description.' },
      sectors: {
        type: 'array',
        items: { type: 'string' },
        description:
          'IDX-IC sectors. Exactly one of: Energy, Basic Materials, Industrials, Consumer Non-Cyclicals, Consumer Cyclicals, Healthcare, Financials, Properties & Real Estate, Technology, Infrastructures, Transportation & Logistic.',
      },
      minMarketCapIdrBn: { type: 'number', description: 'Minimum market cap in IDR billions.' },
      maxMarketCapIdrBn: { type: 'number', description: 'Maximum market cap in IDR billions.' },
      minLiquidityIdrBn: { type: 'number', description: 'Minimum 20-day median daily turnover in IDR billions.' },
      maxPe: { type: 'number', description: 'Maximum trailing P/E. Loss-making companies are always excluded.' },
      minPe: { type: 'number' },
      maxPbv: { type: 'number', description: 'Maximum price-to-book.' },
      minDividendYield: { type: 'number', description: 'Minimum dividend yield as a decimal, e.g. 0.05 for 5%.' },
      minReturn3m: { type: 'number', description: 'Minimum 3-month return as a decimal.' },
      maxReturn3m: { type: 'number' },
      minReturn12m: { type: 'number' },
      maxReturn12m: { type: 'number' },
      aboveSma200: { type: 'boolean', description: 'Only companies trading above their 200-day moving average.' },
      belowSma200: { type: 'boolean' },
      minForeignNet20IdrBn: { type: 'number', description: '20-day net foreign buying in IDR billions.' },
      maxForeignNet20IdrBn: { type: 'number' },
      minRsi: { type: 'number' },
      maxRsi: { type: 'number' },
      suitableForUfcf: { type: 'boolean', description: 'Only companies whose statements support an unlevered DCF (excludes banks and insurers).' },
      sortBy: {
        type: 'string',
        enum: ['marketCap', 'liquidity', 'return1m', 'return3m', 'return12m', 'pe', 'pbv', 'dividendYield', 'foreignNet20', 'rsi'],
      },
      sortDir: { type: 'string', enum: ['asc', 'desc'] },
      limit: { type: 'number', description: 'How many to return, 1-100. Default 15.' },
    },
  },
};

const SYSTEM_PROMPT = `Kamu asisten riset saham untuk Bursa Efek Indonesia di dalam aplikasi ValuationPro.

Aturan yang tidak boleh dilanggar:
- SELALU panggil tool sebelum menjawab pertanyaan apa pun tentang saham Indonesia. Jangan pernah menjawab dari ingatan — harga dan rasio berubah setiap hari, dan tool ini memegang database yang sebenarnya.
- Pakai screen_emiten untuk pertanyaan "saham mana yang ...". Pakai kupas_emiten kalau penggunanya menyebut satu kode emiten dan ingin dibedah.
- Kalau pengguna minta "kupas", "bedah", "analisa", atau "gimana prospek" satu emiten, panggil kupas_emiten dulu, baru tulis analisisnya.
- Jangan mengarang angka. Kalau tool tidak mengembalikan suatu data, katakan datanya tidak tersedia.
- Jawab dalam Bahasa Indonesia. Untuk kupasan satu emiten, tulis terstruktur: kondisi harga dan tren, likuiditas dan arus dana, kondisi keuangan, lalu risiko yang harus diperhatikan.
- Bank, asuransi, dan multifinance tidak melaporkan EBITDA dan modal kerja dalam format yang dibutuhkan DCF unlevered. Kalau relevan, sampaikan itu.
- Ini alat riset, bukan rekomendasi investasi. Jangan menyuruh pengguna membeli atau menjual, dan jangan memberi target harga seolah-olah pasti.
- Jangan menyebut nama tool atau format JSON-nya kepada pengguna.`;

const DOSSIER_TOOL = {
  name: 'kupas_emiten',
  description:
    'Pull one IDX ticker apart: price and moving averages, the three hard screener rules, liquidity, foreign flow, momentum and RSI, annual financial statements, and the controlling group if it has one. Call this whenever the user names a single ticker and wants it analysed, dissected, or explained.',
  input_schema: {
    type: 'object' as const,
    properties: {
      code: { type: 'string', description: 'The 4-letter IDX ticker, e.g. BBRI.' },
    },
    required: ['code'],
  },
};

const n2 = (v: number | undefined, d = 2) =>
  Number.isFinite(v as number) ? (v as number).toFixed(d) : 'tidak tersedia';
const pctText = (v: number | undefined, d = 1) =>
  Number.isFinite(v as number) ? `${((v as number) * 100).toFixed(d)}%` : 'tidak tersedia';

/**
 * The last three reported years, plus whatever the statements can and cannot
 * support.
 *
 * `quality.suitableForUfcf` is carried through verbatim because it decides
 * whether a DCF conversation is even meaningful: banks and insurers do not
 * report EBITDA or working capital in a form unlevered free cash flow can use,
 * and a model that does not know that will happily invent one.
 */
function formatStatements(st: EmitenStatements): string {
  const lines: string[] = [];
  lines.push(
    `Laporan tahunan dalam ${st.currency} ${st.units === 'billions' ? 'miliar' : st.units}. ${st.quality.years} tahun tersedia.`
  );
  if (!st.quality.suitableForUfcf) {
    lines.push(
      'Struktur laporannya TIDAK cocok untuk DCF unlevered — biasanya bank, asuransi, atau multifinance. Katakan itu kalau pengguna menanyakan valuasi arus kas.'
    );
  }
  if (st.quality.operatingProfitDerived) {
    lines.push('Catatan: laba operasi diturunkan, bukan dilaporkan langsung.');
  }

  const recent = st.historicalData.slice(-3);
  for (const y of recent) {
    const bits = [
      `pendapatan ${fmtNum(y.revenue)}`,
      `EBITDA ${fmtNum(y.ebitda)}`,
      `EBIT ${fmtNum(y.ebit)}`,
      `laba bersih ${fmtNum(y.netIncome)}`,
      `capex ${fmtNum(y.capex)}`,
      `kas ${fmtNum(y.cash)}`,
      `utang ${fmtNum(y.totalDebt)}`,
    ];
    lines.push(`${y.year}: ${bits.join(', ')}.`);
  }
  return lines.join('\n');
}

function fmtNum(v: number | undefined): string {
  return Number.isFinite(v as number)
    ? (v as number).toLocaleString('id-ID', { maximumFractionDigits: 1 })
    : 'n/a';
}

function formatRatios(q: EmitenQuote): string {
  const parts: string[] = [];
  const push = (label: string, v: number | null, suffix = '') => {
    if (v !== null && Number.isFinite(v)) parts.push(`${label} ${v.toFixed(2)}${suffix}`);
  };
  push('P/E trailing', q.trailingPE);
  push('P/E forward', q.forwardPE);
  push('P/BV', q.priceToBook);
  push('EPS trailing', q.epsTrailing);
  if (q.dividendYield !== null && Number.isFinite(q.dividendYield)) {
    parts.push(`dividend yield ${(q.dividendYield * 100).toFixed(2)}%`);
  }
  if (q.financialCurrency && q.financialCurrency !== 'IDR') {
    parts.push(`melapor dalam ${q.financialCurrency}, bukan rupiah`);
  }
  return parts.length ? parts.join(' · ') : 'Rasio valuasi tidak tersedia.';
}

/**
 * Everything the model is allowed to know about one emiten, as plain text.
 *
 * Text rather than JSON on purpose: the model writes prose from this, and a
 * labelled sentence is harder to misread than a nested object. Every missing
 * field says so out loud, so "tidak tersedia" is never mistaken for zero.
 */
function buildDossier(
  code: string,
  db: MarketDatabase,
  factors: Map<string, FactorSnapshot>,
  fundamentals: FundamentalsDatabase
): string {
  const key = code.trim().toUpperCase();
  const emiten = db.byCode.get(key);
  if (!emiten) return `Emiten ${key} tidak ada di daftar tercatat IDX.`;

  const quote = db.daily.get(key);
  const f = factors.get(key);
  const screen = runStockScreener(db);
  const row = screen.all.get(key);
  const group = groupOf(key);
  const statements = fundamentals.fundamentals?.companies[key] ?? null;
  const ratios = fundamentals.quotes?.quotes[key] ?? null;

  const lines: string[] = [];
  lines.push(`${key} — ${emiten.name} (${emiten.fullName})`);
  lines.push(`Sektor ${emiten.sector} / ${emiten.subIndustry}. Papan ${emiten.board}, tercatat ${emiten.listingDate}.`);
  lines.push(`Kegiatan usaha: ${emiten.business || 'tidak tersedia'}.`);
  lines.push('');

  lines.push(`HARGA — sesi ${db.meta.latestSession}${db.live?.applied ? ' (harga live intraday)' : ''}`);
  if (quote) {
    lines.push(
      `Terakhir ${quote.close.toLocaleString('id-ID')}, sebelumnya ${quote.prev.toLocaleString('id-ID')} (${quote.change >= 0 ? '+' : ''}${quote.change.toFixed(2)}%).`
    );
    lines.push(
      `Volume ${(quote.volume / 1e6).toFixed(1)} juta lembar, nilai transaksi Rp ${(quote.value / 1e9).toFixed(1)} miliar dari ${quote.freq.toLocaleString('id-ID')} transaksi.`
    );
    if (quote.freq > 0) {
      lines.push(
        `Rata-rata nilai per transaksi Rp ${(quote.value / quote.freq / 1e6).toFixed(1)} juta — makin besar makin menandakan pemain besar, bukan ritel.`
      );
    }
    lines.push(`Kapitalisasi pasar Rp ${(quote.marketCap / 1e12).toFixed(1)} triliun.`);
    lines.push(`Arus asing sesi ini Rp ${(quote.foreignNet / 1e9).toFixed(2)} miliar (positif berarti asing net beli).`);
  } else {
    lines.push('Tidak ada kuotasi untuk sesi terakhir — kemungkinan emiten ini tidak bertransaksi.');
  }
  lines.push('');

  lines.push('TREN DAN ATURAN SCREENER');
  if (row) {
    lines.push(
      `MA${screen.settings.maShort} ${n2(row.maShort, 1)} dan MA${screen.settings.maLong} ${n2(row.maLong, 1)}. Harga ${row.passMa ? 'DI ATAS keduanya' : 'BELUM di atas keduanya'}.`
    );
    lines.push(
      `Aturan screener: MA ${row.passMa ? 'lolos' : 'gagal'}, volume ${row.passVolume ? 'lolos' : 'gagal'}, nilai transaksi ${row.passValue ? 'lolos' : 'gagal'}.`
    );
    lines.push(`Sudah ${row.sessionsAboveMaLong} sesi berturut-turut bertahan di atas MA${screen.settings.maLong}.`);
    lines.push(`Volume hari ini ${n2(row.volumeSurge)}x rata-rata 20 sesi.`);
  } else {
    lines.push('Belum cukup riwayat harga untuk menghitung rata-rata bergerak.');
  }
  if (f) {
    lines.push(
      `Return: 1 minggu ${pctText(f.return1w)}, 1 bulan ${pctText(f.return1m)}, 3 bulan ${pctText(f.return3m)}, 12 bulan ${pctText(f.return12m)}.`
    );
    lines.push(
      `Harga terhadap MA200 ${pctText(f.priceVsSma200)}. RSI 14 ${n2(f.rsi14, 0)}. Volatilitas tahunan ${pctText(f.annualisedVol)}.`
    );
    lines.push(
      `Jarak dari puncak 52 minggu ${pctText(f.distanceFrom52wHigh)}. Drawdown terdalam 6 bulan ${pctText(f.maxDrawdown6m)}.`
    );
    lines.push(
      `Likuiditas: median nilai harian 20 sesi Rp ${n2(f.medianValue20IdrBn, 1)} miliar, bertransaksi ${f.tradedSessions20} dari 20 sesi terakhir.`
    );
    lines.push(
      `Arus asing bersih: 5 sesi Rp ${n2(f.foreignNet5IdrBn, 1)} miliar, 20 sesi Rp ${n2(f.foreignNet20IdrBn, 1)} miliar, 60 sesi Rp ${n2(f.foreignNet60IdrBn, 1)} miliar.`
    );
  }
  lines.push('');

  lines.push('LAPORAN KEUANGAN');
  lines.push(statements ? formatStatements(statements) : 'Laporan keuangan emiten ini belum ada di basis data.');
  lines.push('');

  lines.push('RASIO VALUASI');
  lines.push(ratios ? formatRatios(ratios) : 'Rasio valuasi emiten ini belum ada di basis data.');
  lines.push('');

  lines.push('GRUP PENGENDALI');
  if (group) {
    lines.push(
      `${group.name} (${group.principal}), ${group.kind === 'negara' ? 'klaster negara' : 'grup keluarga'}, keyakinan afiliasi ${group.confidence}.`
    );
    lines.push(`Anggota lain: ${group.members.filter((m) => m !== key).join(', ') || 'tidak ada'}.`);
    if (group.note) lines.push(`Catatan kurator: ${group.note}`);
  } else {
    lines.push('Tidak terdaftar di tabel grup pengendali yang dikurasi aplikasi ini.');
  }

  return lines.join('\n');
}

/**
 * Sonnet 5 request shape, and why each field is what it is.
 *
 *   - `thinking: {type: 'adaptive'}` is the only on-mode on this model; the old
 *     `budget_tokens` form is rejected with a 400.
 *   - `temperature`, `top_p` and `top_k` were REMOVED on Sonnet 5 — sending any
 *     of them is a 400, which is why none appear here.
 *   - Streaming, because adaptive thinking plus an 8k ceiling can outrun the
 *     SDK's non-streaming HTTP timeout on a slow answer.
 *   - The system prompt is cached: it is the same bytes on every request, and
 *     the session line that changes daily sits AFTER the cache breakpoint so it
 *     never invalidates the prefix.
 */
const MODEL = 'claude-sonnet-5';

async function answerWithClaude(
  message: string,
  history: ChatTurn[],
  db: MarketDatabase,
  fundamentals: FundamentalsDatabase,
  client: Anthropic
): Promise<ChatAnswer> {
  const factors = factorsFor(db);

  const messages: Anthropic.MessageParam[] = [
    ...history.slice(-6).map((t) => ({ role: t.role, content: t.content }) as Anthropic.MessageParam),
    { role: 'user', content: message },
  ];

  let lastResult: QueryResult | null = null;
  let understood: string[] = [];

  // Four rounds: the model may screen, then dissect one of the results, then
  // write. Three was enough when there was only one tool.
  for (let round = 0; round < 4; round++) {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      system: [
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        {
          type: 'text',
          text: `Sesi data terakhir: ${db.meta.latestSession}. Jumlah emiten tercatat: ${db.emiten.length}.`,
        },
      ],
      tools: [SCREEN_TOOL, DOSSIER_TOOL],
      messages,
    });
    const reply = await stream.finalMessage();

    const toolUses = reply.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');

    if (!toolUses.length || reply.stop_reason !== 'tool_use') {
      const text = reply.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();

      return {
        reply: text || 'Saya tidak menemukan jawabannya.',
        rows: lastResult?.rows || [],
        totalMatched: lastResult?.totalMatched || 0,
        appliedFilters: lastResult?.appliedFilters || [],
        engine: 'claude',
        understood,
      };
    }

    // Thinking blocks must be echoed back unchanged while the conversation
    // continues on the same model, so the whole content array goes back.
    messages.push({ role: 'assistant', content: reply.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      if (use.name === DOSSIER_TOOL.name) {
        const wanted = String((use.input as { code?: string }).code ?? '');
        toolResults.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: buildDossier(wanted, db, factors, fundamentals),
        });
        continue;
      }

      const query = (use.input || {}) as EmitenQuery;
      const result = queryEmiten(db, factors, fundamentals, query);
      lastResult = result;
      understood = result.appliedFilters;
      toolResults.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: `Cocok: ${result.totalMatched} emiten. Diurutkan berdasarkan ${result.sortLabel}.\n\n${formatRowsAsText(result)}`,
      });
    }

    // Every result for one assistant turn goes back in ONE user message —
    // splitting them teaches the model to stop calling tools in parallel.
    messages.push({ role: 'user', content: toolResults });
  }

  throw new Error('Claude tidak menyelesaikan jawaban dalam batas putaran tool');
}

export async function answerQuestion(
  message: string,
  history: ChatTurn[],
  db: MarketDatabase,
  fundamentals: FundamentalsDatabase
): Promise<ChatAnswer> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return answerLocally(message, db, fundamentals);

  try {
    const client = new Anthropic({ apiKey });
    return await answerWithClaude(message, history, db, fundamentals, client);
  } catch (err) {
    // Falling back keeps the feature working rather than showing an error page.
    const local = answerLocally(message, db, fundamentals);
    local.note = `Claude tidak dapat dihubungi (${(err as Error).message.slice(0, 120)}) — dijawab oleh mesin lokal.`;
    return local;
  }
}
