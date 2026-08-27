// Emiten chatbot endpoint for the deployed terminal.
//
// WHY THIS EXISTS: the chatbot's Claude layer lives in src/server/chatApi.ts,
// which only runs inside `npm run auto` — a long-lived local process. On the
// deployed site there was no /api/chat at all, so every question fell through
// to the deterministic Indonesian parser and the answer never changed no matter
// which model the local service was configured for. Nothing was broken; the
// good half of the feature simply was not deployed.
//
// A chat turn is exactly the shape serverless is good at: stateless, one
// request in, one answer out. The expensive part is assembling the market
// database — six JSON files, one of them 6 MB — so it is built once per warm
// lambda and reused. A cold start pays ~2s; every question after that on the
// same instance pays nothing.
//
// WHAT IT NEEDS: ANTHROPIC_API_KEY in the Vercel project's environment. Without
// it the endpoint still answers, using the same deterministic parser the local
// service falls back to, and says so in `engine`.

import type { VercelRequest, VercelResponse } from '@vercel/node';

import { assembleMarketDatabase, MarketDatabase } from '../src/data/marketRepository';
import { FundamentalsDatabase, FundamentalsFile, QuotesFile } from '../src/data/fundamentalsRepository';
import {
  DailyFile,
  HistoryFile,
  IndicesFile,
  IntradayFile,
  MarketMeta,
  UniverseFile,
} from '../src/types/market';
import { answerQuestion, ChatTurn } from '../src/server/chatApi';

interface Loaded {
  db: MarketDatabase;
  fundamentals: FundamentalsDatabase;
  at: number;
}

/**
 * Warm-instance cache.
 *
 * Ten minutes rather than forever: the committed data changes when the CI cron
 * commits, and a lambda that lived through a market close would otherwise keep
 * answering from the morning's prices. Ten minutes is short enough that the
 * numbers stay honest and long enough that a burst of questions costs one load.
 */
let loaded: Loaded | null = null;
const TTL_MS = 10 * 60 * 1000;

function originOf(req: VercelRequest): string {
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
  const host = (req.headers['x-forwarded-host'] as string) || (req.headers.host as string);
  return `${proto}://${host}`;
}

async function getJson<T>(base: string, file: string): Promise<T> {
  const res = await fetch(`${base}/data/idx/${file}`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Gagal memuat ${file} (HTTP ${res.status})`);
  return (await res.json()) as T;
}

async function tryJson<T>(base: string, file: string): Promise<T | null> {
  try {
    return await getJson<T>(base, file);
  } catch {
    return null;
  }
}

async function load(req: VercelRequest): Promise<Loaded> {
  if (loaded && Date.now() - loaded.at < TTL_MS) return loaded;

  const base = originOf(req);
  const [meta, universe, daily, history, indices, intraday, fundamentals, quotes] = await Promise.all([
    getJson<MarketMeta>(base, 'meta.json'),
    getJson<UniverseFile>(base, 'universe.json'),
    getJson<DailyFile>(base, 'daily.json'),
    getJson<HistoryFile>(base, 'history.json'),
    getJson<IndicesFile>(base, 'indices.json'),
    tryJson<IntradayFile>(base, 'intraday.json'),
    tryJson<FundamentalsFile>(base, 'fundamentals.json'),
    tryJson<QuotesFile>(base, 'quotes.json'),
  ]);

  loaded = {
    db: assembleMarketDatabase({ meta, universe, daily, history, indices, intraday }),
    fundamentals: { fundamentals, quotes },
    at: Date.now(),
  };
  return loaded;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Gunakan POST.' });
    return;
  }

  const body = (req.body ?? {}) as { message?: string; history?: ChatTurn[] };
  const message = String(body.message ?? '').trim();
  if (!message) {
    res.status(400).json({ error: 'Pertanyaan kosong.' });
    return;
  }

  try {
    const { db, fundamentals } = await load(req);
    const answer = await answerQuestion(message, Array.isArray(body.history) ? body.history : [], db, fundamentals);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(answer);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
