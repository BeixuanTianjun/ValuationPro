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
// about THIS stock". Without the second tool a question like "kupas BBRI"
// degenerates into a one-row screen, and the model fills the gap from memory,
// which is exactly what this file exists to prevent.
//
// WHAT THE DOSSIER IS FOR. It is deliberately not a data dump. Every other
// screen in this app can already say what the tape DID; the dossier exists so
// one answer can say WHY, and "why" only ever emerges from two facts landing in
// the same month. So it carries the filings, the curated policy themes, the
// controlling group WITH its measured rotation and cohesion, the KSEI register
// with its three-month drift, the detected corporate actions, and the
// sub-industry peers with their market caps — assembled in one block so the
// model can find the through-line instead of reciting six unrelated sections.
//
// The peers are there for one specific question this market asks constantly:
// "what would this have to become to be worth what its neighbour is worth."
// Handing over the neighbours and their caps makes that arithmetic checkable.
// The database holds no un-injected mine and no unannounced acquisition, so the
// prompt requires that answer to be stated as conditional arithmetic, and points
// at the filings as the only place a real asset injection would leave a trace.

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
import { AnnouncementsFile, buildNarrativeSignals } from '../models/announcements';
import { OwnershipFile, computeOwnershipProfile } from '../models/ownershipFlow';
import { computeGroupRotation } from '../models/conglomerateRotation';
import { THEMES_BY_CODE } from '../data/narratives';
import { MacroFile, RECENT_WINDOW, buildMacroLinkage, linkagesForEmiten } from '../models/macroLinkage';

/**
 * The two feeds the dossier needs that do not live in MarketDatabase.
 *
 * Both optional on purpose: the chatbot must still answer when a weekly ingest
 * has not run. Every section that depends on one says so out loud rather than
 * silently omitting itself — "no filings" and "the filings file was never
 * built" are different answers, and a model that cannot tell them apart will
 * confidently report a quiet quarter for an emiten that just did a rights issue.
 */
export interface ChatContext {
  announcements?: AnnouncementsFile | null;
  ownership?: OwnershipFile | null;
  macro?: MacroFile | null;
}

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

const SYSTEM_PROMPT = `Kamu analis saham IDX di dalam aplikasi ValuationPro. Kamu ngobrol sama trader Indonesia, bukan bikin laporan riset buat komite investasi.

== CARA NGOMONG ==
Bahasa tongkrongan. Santai, langsung, kayak ngobrol sama temen yang sama-sama ngerti pasar.
- Pendek. Kalau bisa 5 kalimat jangan 15. Jangan bertele-tele, jangan basa-basi pembuka.
- Boleh pakai "lo/gue", "nih", "sih", "udah", "belum", "kayaknya", "gede", "nyangkut", "ARA", "ARB", "barang", "tape".
- JANGAN pakai bullet point bertingkat dan heading formal. Tulis mengalir, maksimal beberapa paragraf pendek.
- Angka tetap presisi. Santai itu gayanya, bukan datanya. "Naik 12,4% sebulan" bukan "naik lumayan".

== YANG BIKIN JAWABANMU BERGUNA: SAMBUNGIN TITIKNYA ==
Kalau user nyebut satu emiten, jangan cuma bacain isi dossier baris per baris. Itu kerjaan tabel, bukan kerjaan lo.
Yang diminta: SATU CERITA yang nyambung dari:
  narasi/pengajuan ke bursa  ->  grup & rotasi konglomerasi  ->  price action & arus dana
  ->  aksi korporasi  ->  kepemilikan KSEI  ->  pembanding sektor
Tugasmu nyari BENANG MERAH di antara itu, terus bilang benang merahnya apa.

Contoh cara mikirnya (bukan template yang harus diikuti persis):
- "Institusi naik 3 pp dalam 3 bulan, dan di bulan yang sama dia filing transaksi material. Itu bukan kebetulan."
- "Harganya lari 40% tapi kohesi grupnya cuma 0,12 — jadi ini bukan rotasi grup, ini emiten ini doang."
- "Bursa lagi nanya (UMA) sementara ritel yang nambah, bukan institusi. Hati-hati."
- "Kapitalisasinya 6x lebih kecil dari pesaing terdekat. Buat nyamain, dia butuh aset atau laba tambahan sebesar X — dan sampai sekarang belum ada filing yang nunjukin itu masuk."

Kalau titiknya memang NGGAK nyambung, bilang begitu. "Nggak ada yang nyambung sih, dia naik sendiri tanpa kabar" itu jawaban yang jujur dan berguna.

== ATURAN YANG NGGAK BOLEH DILANGGAR ==
- SELALU panggil tool sebelum jawab apa pun soal saham Indonesia. Jangan jawab dari ingatan — harga dan rasio berubah tiap hari, tool ini megang database beneran.
- screen_emiten buat "saham mana yang ...". kupas_emiten buat satu kode yang mau dibedah.
- Jangan ngarang angka. Kalau dossier bilang suatu data nggak tersedia, bilang nggak tersedia. Jangan tambal pakai ingatan.
- BEDAKAN "nggak ada kabar" dari "berkasnya belum dibangun". Dossier menyatakan yang mana; jangan dicampur.
- Aksi korporasi: return panjang di dossier SUDAH bersih dari split/rights. Jangan sebut faktor penyesuaian sebagai jatuhnya harga.
- Kepemilikan KSEI itu BULANAN, TANPA NAMA pengelola, dan penyebutnya register kustodian bukan saham tercatat. Sebut batas ini kalau ngutip angkanya.
- Kohesi grup di bawah 0,25 artinya "rotasi" nggak punya dasar. Jangan sebut rotasi kalau kohesinya rendah.
- KALAU USER NYEBUT PENGGERAK LUAR — batu bara, minyak, emas, nikel, kurs, dolar, suku bunga, S&P, sentimen global — WAJIB buka bagian PENGGERAK DARI LUAR dan sebut angka korelasinya. Itu satu-satunya bagian yang bisa jawab "beneran nyeret atau cuma cerita". Jawaban yang mengiyakan hubungan komoditas tanpa nyebut angkanya sama saja mengarang.
- Di bursa ini korelasi harian ke luar negeri MEMANG kecil semua. r di bawah 0,25 artinya di data harian hubungannya NGGAK KEBACA — bilang begitu terang-terangan, jangan diperhalus jadi "ada pengaruh sedikit". Boleh tambahin bahwa eksposur komoditas munculnya di laporan keuangan dan gerakan kuartalan, bukan di tick harian.
- Kalau yang ditanya komoditas yang datanya nggak ada (CPO/sawit, nikel, batu bara Newcastle), bilang datanya nggak ada. Jangan pakai instrumen lain sebagai pengganti.
- SEMUA jawaban 100% Bahasa Indonesia. Boleh istilah pasar yang lazim dipakai trader Indonesia (ARA, ARB, cuan, nyangkut, tape). Nol kata Mandarin, Jepang, atau bahasa lain yang nyelip.
- Bank, asuransi, multifinance nggak lapor EBITDA dan modal kerja dalam format yang DCF unlevered butuh. Sebut itu kalau relevan.
- Hitungan "biar setara pesaing butuh berapa" boleh, TAPI nyatakan sebagai aritmetika bersyarat. Database ini nggak punya rencana akuisisi atau cadangan tambang yang belum diinjeksi — kalau ada jejaknya, adanya di pengajuan ke bursa.
- Ini alat riset, bukan rekomendasi. Jangan nyuruh beli atau jual, jangan kasih target harga seolah-olah pasti.
- Jangan sebut nama tool atau format JSON-nya ke user.`;

const DOSSIER_TOOL = {
  name: 'kupas_emiten',
  description:
    'Pull one IDX ticker apart into a single connected dossier: price, moving averages and the three hard screener rules; liquidity, foreign flow, momentum and RSI; annual financial statements and valuation ratios; detected corporate actions; every disclosure the emiten filed with the exchange in the last window, classified; curated policy themes it belongs to; its controlling group WITH the measured rotation and cohesion of that group; the KSEI ownership register with institutional/retail/foreign/mutual-fund movement; its sub-industry peers with market caps for "what would it take to be worth what they are worth" questions; and the measured correlation of this emiten against 29 instruments outside Indonesia (rupiah, coal, oil, metals, regional and US indices, US rates, crypto). Call this whenever the user names a single ticker — it is the only way to answer why a stock is moving rather than merely that it moved.',
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
 * Signed percentage-point change, or an honest gap.
 *
 * An emiten listed inside the window has no three-month-ago reading, so these
 * arrive NaN. Formatting them straight through printed "institusi NaN pp" into
 * the dossier — and a model handed NaN will either repeat it or, worse, round it
 * to something that looks like a number.
 */
const ppText = (v: number | undefined, d = 2) =>
  Number.isFinite(v as number)
    ? `${(v as number) >= 0 ? '+' : ''}${((v as number) * 100).toFixed(d)} pp`
    : 'tidak tersedia (riwayatnya belum cukup panjang)';

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
export function buildDossier(
  code: string,
  db: MarketDatabase,
  factors: Map<string, FactorSnapshot>,
  fundamentals: FundamentalsDatabase,
  ctx: ChatContext = {}
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

  lines.push('AKSI KORPORASI');
  const series = db.series.get(key);
  if (series && series.adjustments > 0) {
    lines.push(
      `${series.adjustments} penyesuaian harga terdeteksi di riwayat ${db.dates.length} sesi — split, reverse split, atau rights issue. Faktornya diturunkan dari selisih field Previous milik IDX terhadap penutupan sesi sebelumnya, jadi ini terdeteksi dari data bursa sendiri, bukan dari pengumuman.`
    );
    lines.push(
      'Artinya return jangka panjang di atas sudah bersih dari efek aksi korporasi. Jangan menyebut angka penyesuaian ini sebagai "penurunan harga".'
    );
  } else if (series) {
    lines.push('Tidak ada penyesuaian harga dalam jendela riwayat — belum ada split, reverse split, atau rights issue.');
  } else {
    lines.push('Riwayat harga emiten ini belum ada, jadi aksi korporasi tidak bisa diperiksa.');
  }
  lines.push('');

  // ---------------------------------------------------------------- narrative
  //
  // WHY THIS IS THE SECTION THAT MATTERS MOST. Every other block says what the
  // tape did. This one is the only place that can say WHY. A price move without
  // a filing behind it is a move; a price move on the week an emiten filed a
  // material transaction is a story, and the difference is what the user is
  // asking about when they name a ticker.
  lines.push('PENGAJUAN KE BURSA (keterbukaan informasi)');
  if (!ctx.announcements) {
    lines.push(
      'Berkas pengumuman IDX belum dibangun di lingkungan ini (npm run data:announcements). Katakan bahwa lapisan narasi TIDAK bisa diperiksa — jangan simpulkan emiten ini sepi kabar.'
    );
  } else {
    const signals = buildNarrativeSignals(ctx.announcements, 14);
    const sig = signals.get(key);
    lines.push(
      `Jendela data ${ctx.announcements.from} sampai ${ctx.announcements.to}. Sumbernya pengajuan resmi emiten ke bursa — BUKAN feed berita. Proyek pemerintah atau pemberitaan media hanya muncul kalau emitennya sendiri yang melaporkan perannya.`
    );
    if (!sig || !sig.filings.length) {
      lines.push('Emiten ini tidak mengajukan apa pun dalam jendela tersebut.');
    } else {
      const routine = sig.filings.length - sig.material.length;
      lines.push(
        `${sig.filings.length} pengajuan, ${sig.material.length} di antaranya material (${routine} sisanya rutin: laporan bulanan, bukti iklan, ganti sekretaris perusahaan).`
      );
      if (sig.underExchangeAttention) {
        lines.push(
          'BURSA SEDANG BERTANYA ke emiten ini (UMA atau permintaan penjelasan) dalam jendela ini. Itu berarti harganya sudah bergerak cukup jauh sampai bursa minta penjelasan — sinyal sekaligus peringatan.'
        );
      }
      for (const a of sig.material.slice(0, 12)) {
        lines.push(`  ${a.date} [${a.meta.label}] ${a.title}`);
      }
      if (sig.material.length > 12) lines.push(`  (+${sig.material.length - 12} pengajuan material lain)`);
      lines.push(
        `Bobot kategori mengatakan "ini layak dibaca", TIDAK PERNAH "ini kabar baik". "Perolehan atau kehilangan kontrak penting" adalah judul IDX sendiri dan menutupi kontrak yang menang maupun yang hilang dengan kata yang sama.`
      );
    }
  }
  lines.push('');

  lines.push('TEMA KEBIJAKAN TERKURASI');
  const themes = THEMES_BY_CODE.get(key) ?? [];
  if (!themes.length) {
    lines.push('Emiten ini tidak masuk tema kebijakan mana pun yang dikurasi aplikasi.');
  } else {
    for (const { theme, member } of themes) {
      lines.push(
        `  ${theme.name} (${member.exposure}, keyakinan ${theme.confidence}, diperiksa ${theme.checkedOn}${theme.source ? '' : ', TANPA SUMBER — bobotnya dipotong setengah'}): ${member.why}`
      );
      lines.push(`    Pendorong: ${theme.driver}`);
    }
    lines.push('Tema ini ditulis tangan oleh kurator, bukan ditarik dari feed. Tiap tema meluruh ke nol dalam 90 hari sejak terakhir diperiksa.');
  }
  lines.push('');

  // -------------------------------------------------------- group and rotation
  lines.push('GRUP PENGENDALI & ROTASI');
  if (group) {
    lines.push(
      `${group.name} (${group.principal}), ${group.kind === 'negara' ? 'klaster negara' : 'grup keluarga'}, keyakinan afiliasi ${group.confidence}.`
    );
    lines.push(`Anggota lain: ${group.members.filter((m) => m !== key).join(', ') || 'tidak ada'}.`);
    if (group.note) lines.push(`Catatan kurator: ${group.note}`);

    const rot = computeGroupRotation(db, factors, group);
    if (rot) {
      lines.push(
        `Grup bergerak ${pctText(rot.groupReturn1m)} dalam 1 bulan dan ${pctText(rot.groupReturn3m)} dalam 3 bulan (tertimbang kapitalisasi, ${rot.membersFound} dari ${rot.membersListed} anggota ketemu di bursa).`
      );
      lines.push(
        `Kohesi ${n2(rot.cohesion)} — korelasi rata-rata harian antar anggota. Di bawah 0,25 artinya "grup" ini tidak benar-benar bergerak bersama dan kata rotasi tidak punya dasar.`
      );
      lines.push(`Sebaran 3 bulan antar anggota ${(rot.dispersion3m * 100).toFixed(0)} poin persen. Arus asing grup 20 sesi Rp ${n2(rot.groupForeignNet20IdrBn, 1)} miliar.`);
      lines.push(`Vonis alat: ${rot.verdict.level} — ${rot.verdict.reason}`);
      if (rot.leader) lines.push(`Yang memimpin: ${rot.leader.code} (${pctText(rot.leader.return1m)} sebulan).`);
      if (rot.candidate) {
        lines.push(
          `Kandidat tertinggal: ${rot.candidate.code} (${pctText(rot.candidate.return1m)} sebulan)${rot.candidate.code === key ? ' — YAITU EMITEN INI SENDIRI.' : '.'}`
        );
      }
    }
  } else {
    lines.push('Tidak terdaftar di tabel grup pengendali yang dikurasi aplikasi ini.');
  }
  lines.push('');

  // ------------------------------------------------------------------ holders
  lines.push('KEPEMILIKAN (register KSEI)');
  if (!ctx.ownership) {
    lines.push('Register KSEI belum dibangun di lingkungan ini (npm run data:ownership). Jangan menebak siapa pemegangnya.');
  } else {
    const own = computeOwnershipProfile(ctx.ownership, key);
    if (!own) {
      lines.push('Emiten ini tidak ada di register KSEI pada bulan-bulan yang tersedia.');
    } else {
      const L = own.latest;
      lines.push(
        `Per ${L.month}: institusi ${pctText(L.institusi)}, ritel ${pctText(L.ritel)}, asing ${pctText(L.asing)}, reksa dana ${pctText(L.reksadana)}.`
      );
      lines.push(
        `Perubahan 3 bulan: institusi ${ppText(own.institusiChange3m)}, reksa dana ${ppText(
          own.reksadanaChange3m
        )}, asing ${ppText(own.asingChange3m)}, jarak institusi−ritel ${
          Number.isFinite(own.spreadChange3m)
            ? `${own.spreadChange3m >= 0 ? 'melebar' : 'menyempit'} ${Math.abs(own.spreadChange3m * 100).toFixed(2)} pp`
            : 'tidak tersedia (riwayatnya belum cukup panjang)'
        }.`
      );
      lines.push(`Vonis: ${own.verdict.level} — ${own.verdict.headline}. ${own.verdict.reason}`);
      lines.push(
        `PENYEBUTNYA REGISTER KUSTODIAN, BUKAN SAHAM TERCATAT: cakupan kustodian ${pctText(own.custodyCoverage)} dari saham tercatat. Blok pengendali sering di luar penitipan kolektif, jadi persentase di atas lebih dekat ke free float daripada ke total saham. Sebutkan ini kalau mengutip angkanya.`
      );
      lines.push(
        'Data ini BULANAN dan TANPA NAMA pengelola. Bisa mengatakan reksa dana secara keseluruhan menambah sekian, tidak bisa mengatakan reksa dana yang mana.'
      );
    }
  }
  lines.push('');

  // -------------------------------------------------------------------- peers
  //
  // The question behind "is the whole mine in yet" is always comparative: what
  // would this have to become to be worth what its neighbour is worth. Handing
  // the model the neighbours with their caps makes that arithmetic checkable
  // instead of imagined.
  // -------------------------------------------------------------- macro
  //
  // The only section that reaches outside Indonesia. It exists because half the
  // questions asked about a coal miner are really questions about coal, and
  // until now the dossier could not tell the model whether that link is real in
  // the data or only in the story.
  lines.push('PENGGERAK DARI LUAR (kurs, komoditas, indeks global, bunga)');
  if (!ctx.macro) {
    lines.push(
      'Berkas makro belum dibangun di lingkungan ini (npm run data:macro). Jangan menebak hubungan emiten ini dengan harga komoditas atau kurs — belum ada yang diukur.'
    );
  } else {
    const macroResult = buildMacroLinkage(ctx.macro, db);
    const nameById = new Map(macroResult.instruments.map((i) => [i.id, i]));
    const mine = linkagesForEmiten(macroResult, db, key, 6);
    if (!mine.length) {
      lines.push('Riwayat harga emiten ini belum cukup panjang untuk diukur terhadap instrumen luar mana pun.');
    } else {
      lines.push(
        `Korelasi return harian atas ${ctx.macro.sessions} sesi (${ctx.macro.from} → ${ctx.macro.to}). Instrumen yang pasarnya tutup setelah Jakarta dibandingkan dengan penutupan SEHARI SEBELUMNYA, karena harga New York hari ini belum ada saat Jakarta tutup.`
      );
      for (const l of mine) {
        const inst = nameById.get(l.instrumentId);
        if (!inst) continue;
        const recent = Number.isFinite(l.correlationRecent) ? l.correlationRecent.toFixed(2) : 'n/a';
        lines.push(
          `  ${inst.name} (${inst.klass}): r ${l.correlation.toFixed(2)}, ${RECENT_WINDOW} sesi terakhir ${recent}, R² ${(l.r2 * 100).toFixed(0)}%, beta ${l.beta.toFixed(2)}, n ${l.n}${l.expected ? ' — memang diharapkan nyambung' : ''}`
        );
      }
      lines.push(
        'BACA ANGKA INI DENGAN JUJUR. Di seluruh bursa ini tidak ada instrumen luar yang menerangkan lebih dari sekitar 13% gerakan harian satu sektor, jadi r di bawah 0,25 artinya TIDAK ADA hubungan yang terbaca — bukan hubungan lemah. Korelasi juga bukan sebab-akibat. Kalau angka jendela terakhir jauh lebih besar dari r keseluruhan, hubungan itu sedang menguat dan itu yang layak disebut.'
      );
      lines.push(
        `Yang TIDAK ada datanya sama sekali: ${ctx.macro.absent.map((a) => a.name).join(', ')}. Kalau pertanyaannya menyangkut itu, katakan datanya tidak ada — jangan pakai instrumen lain sebagai pengganti.`
      );
    }
  }
  lines.push('');

  lines.push('PEMBANDING SEKTOR (untuk pertanyaan "kalau mau setara siapa")');
  const myCap = quote?.marketCap ?? 0;
  const peers = db.emiten
    .filter((e) => e.code !== key && e.subIndustry === emiten.subIndustry)
    .map((e) => ({ e, q: db.daily.get(e.code) }))
    .filter((p): p is { e: typeof emiten; q: NonNullable<ReturnType<typeof db.daily.get>> } => !!p.q && p.q.marketCap > 0)
    .sort((a, b) => b.q.marketCap - a.q.marketCap)
    .slice(0, 8);
  if (!peers.length) {
    lines.push(`Tidak ada emiten lain di sub-industri "${emiten.subIndustry}" yang punya kuotasi sesi terakhir.`);
  } else {
    lines.push(`Sub-industri "${emiten.subIndustry}". Kapitalisasi ${key} sendiri Rp ${(myCap / 1e12).toFixed(2)} triliun.`);
    for (const p of peers) {
      const r = fundamentals.quotes?.quotes[p.e.code];
      const gap = myCap > 0 ? p.q.marketCap / myCap : 0;
      lines.push(
        `  ${p.e.code} ${p.e.name} — kapitalisasi Rp ${(p.q.marketCap / 1e12).toFixed(2)} T${
          gap > 0 ? ` (${gap.toFixed(1)}x ${key})` : ''
        }${r?.trailingPE ? `, P/E ${r.trailingPE.toFixed(1)}` : ''}${r?.priceToBook ? `, P/BV ${r.priceToBook.toFixed(2)}` : ''}`
      );
    }
    lines.push(
      'Selisih kapitalisasi ini boleh dipakai untuk menghitung "berapa besar laba atau aset tambahan yang dibutuhkan supaya setara", DENGAN SYARAT dinyatakan sebagai aritmetika bersyarat, bukan ramalan. Basis data ini tidak memuat rencana akuisisi atau cadangan tambang yang belum diinjeksi — kalau ada, jejaknya ada di bagian PENGAJUAN KE BURSA di atas, bukan di angka mana pun.'
    );
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
  client: Anthropic,
  ctx: ChatContext
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
          content: buildDossier(wanted, db, factors, fundamentals, ctx),
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
  fundamentals: FundamentalsDatabase,
  ctx: ChatContext = {}
): Promise<ChatAnswer> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return answerLocally(message, db, fundamentals);

  try {
    const client = new Anthropic({ apiKey });
    return await answerWithClaude(message, history, db, fundamentals, client, ctx);
  } catch (err) {
    // Falling back keeps the feature working rather than showing an error page.
    const local = answerLocally(message, db, fundamentals);
    local.note = `Claude tidak dapat dihubungi (${(err as Error).message.slice(0, 120)}) — dijawab oleh mesin lokal.`;
    return local;
  }
}
