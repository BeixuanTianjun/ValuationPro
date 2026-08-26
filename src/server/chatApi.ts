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

import { MarketDatabase } from '../data/marketRepository';
import { FundamentalsDatabase } from '../data/fundamentalsRepository';
import { computeAllFactors } from '../models/factorEngine';
import { FactorSnapshot } from '../types/market';
import {
  EmitenQuery,
  QueryResult,
  formatRowsAsText,
  parseIndonesianQuery,
  queryEmiten,
} from '../models/emitenQueryEngine';

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
- SELALU panggil tool screen_emiten untuk pertanyaan apa pun tentang saham Indonesia. Jangan pernah menjawab dari ingatan — harga dan rasio berubah setiap hari, dan tool ini memegang database yang sebenarnya.
- Jangan mengarang angka. Kalau tool tidak mengembalikan suatu data, katakan datanya tidak tersedia.
- Jawab dalam Bahasa Indonesia, ringkas dan padat. Maksimal 4 kalimat sebelum menyebut daftar emitennya.
- Sebutkan jumlah emiten yang cocok dan kriteria yang dipakai, supaya pengguna bisa mengoreksi.
- Bank, asuransi, dan multifinance tidak melaporkan EBITDA dan modal kerja dalam format yang dibutuhkan DCF unlevered. Kalau relevan, sampaikan itu.
- Ini alat riset, bukan rekomendasi investasi. Jangan menyuruh pengguna membeli atau menjual.
- Jangan menyebut nama tool atau format JSON-nya kepada pengguna.`;

interface AnthropicBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

async function callAnthropic(body: unknown, apiKey: string): Promise<{ content: AnthropicBlock[]; stop_reason: string }> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return (await res.json()) as { content: AnthropicBlock[]; stop_reason: string };
}

async function answerWithClaude(
  message: string,
  history: ChatTurn[],
  db: MarketDatabase,
  fundamentals: FundamentalsDatabase,
  apiKey: string
): Promise<ChatAnswer> {
  const factors = factorsFor(db);

  const messages: Record<string, unknown>[] = [
    ...history.slice(-6).map((t) => ({ role: t.role, content: t.content })),
    { role: 'user', content: message },
  ];

  let lastResult: QueryResult | null = null;
  let understood: string[] = [];

  // Two rounds is enough: one tool call, then the written answer.
  for (let round = 0; round < 3; round++) {
    const reply = await callAnthropic(
      {
        model: 'claude-sonnet-5',
        max_tokens: 1400,
        system: `${SYSTEM_PROMPT}\n\nSesi data terakhir: ${db.meta.latestSession}. Jumlah emiten tercatat: ${db.emiten.length}.`,
        tools: [SCREEN_TOOL],
        messages,
      },
      apiKey
    );

    const toolUses = reply.content.filter((b) => b.type === 'tool_use');
    if (!toolUses.length || reply.stop_reason !== 'tool_use') {
      const text = reply.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text || '')
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

    messages.push({ role: 'assistant', content: reply.content });

    const toolResults: Record<string, unknown>[] = [];
    for (const use of toolUses) {
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
    return await answerWithClaude(message, history, db, fundamentals, apiKey);
  } catch (err) {
    // Falling back keeps the feature working rather than showing an error page.
    const local = answerLocally(message, db, fundamentals);
    local.note = `Claude tidak dapat dihubungi (${(err as Error).message.slice(0, 120)}) — dijawab oleh mesin lokal.`;
    return local;
  }
}
