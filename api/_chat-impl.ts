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
//
// WHY THIS FILE IS PRE-BUNDLED. It is the first serverless function here to
// import from src/, and the first deploy of it returned FUNCTION_INVOCATION_
// FAILED on every request including GET — the module never loaded. Rather than
// keep guessing at how Vercel's builder resolves a deep relative TypeScript
// import under `"type": "module"`, `npm run build` now bundles this file into
// one self-contained ESM module with esbuild — the same tool and the same
// settings that already build the local service — and api/chat.ts is a nine-line
// wrapper around it. The failure mode is gone rather than diagnosed, which for
// a build toolchain is the right trade.

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
import { answerQuestion, ChatContext, ChatTurn } from '../src/server/chatApi';
import { AnnouncementsFile } from '../src/models/announcements';
import { OwnershipFile } from '../src/models/ownershipFlow';
import { MacroFile } from '../src/models/macroLinkage';
import type { WorldMapSummary } from '../src/server/chatApi';

interface Loaded {
  db: MarketDatabase;
  fundamentals: FundamentalsDatabase;
  /**
   * Filings and the KSEI register.
   *
   * Fetched with tryJson like the other optional files, so a deployment whose
   * weekly ingest has not landed yet still answers — the dossier prints that the
   * file is missing rather than reporting a quiet emiten.
   */
  chatContext: ChatContext;
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

export interface ChatRequestLike {
  headers: Record<string, string | string[] | undefined>;
}

function originOf(req: ChatRequestLike): string {
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

async function load(req: ChatRequestLike): Promise<Loaded> {
  if (loaded && Date.now() - loaded.at < TTL_MS) return loaded;

  const base = originOf(req);
  const [meta, universe, daily, history, indices, intraday, fundamentals, quotes, announcements, ownership, macro, worldmap] =
    await Promise.all([
      getJson<MarketMeta>(base, 'meta.json'),
      getJson<UniverseFile>(base, 'universe.json'),
      getJson<DailyFile>(base, 'daily.json'),
      getJson<HistoryFile>(base, 'history.json'),
      getJson<IndicesFile>(base, 'indices.json'),
      tryJson<IntradayFile>(base, 'intraday.json'),
      tryJson<FundamentalsFile>(base, 'fundamentals.json'),
      tryJson<QuotesFile>(base, 'quotes.json'),
      tryJson<AnnouncementsFile>(base, 'announcements.json'),
      tryJson<OwnershipFile>(base, 'ownership.json'),
      tryJson<MacroFile>(base, 'macro.json'),
      tryJson<WorldMapSummary>(base, 'worldmap.json'),
    ]);

  loaded = {
    db: assembleMarketDatabase({ meta, universe, daily, history, indices, intraday }),
    fundamentals: { fundamentals, quotes },
    chatContext: { announcements, ownership, macro, worldmap },
    at: Date.now(),
  };
  return loaded;
}

/**
 * Answer one chat turn.
 *
 * Returns a status plus a body rather than writing to a response, so the thin
 * Vercel wrapper stays the only file that knows about Vercel — and so this can
 * be exercised from a plain Node script when something breaks in production.
 */
export async function handleChat(
  req: ChatRequestLike,
  body: { message?: string; history?: ChatTurn[] }
): Promise<{ status: number; body: unknown }> {
  const message = String(body?.message ?? '').trim();
  if (!message) return { status: 400, body: { error: 'Pertanyaan kosong.' } };

  try {
    const { db, fundamentals, chatContext } = await load(req);
    const answer = await answerQuestion(
      message,
      Array.isArray(body.history) ? body.history : [],
      db,
      fundamentals,
      chatContext
    );
    return { status: 200, body: answer };
  } catch (err) {
    return { status: 500, body: { error: (err as Error).message } };
  }
}
