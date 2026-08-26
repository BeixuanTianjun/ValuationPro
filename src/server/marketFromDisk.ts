// Node-side loader for the IDX market database.
//
// The browser reads public/data/idx over HTTP; the scheduler reads the same
// files from disk. Both then call the SAME assembleMarketDatabase and the SAME
// screener, so the picks emailed at 12:05 WIB are byte-for-byte the picks the
// app shows — a divergence there would be worse than no alert at all.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DailyFile,
  HistoryFile,
  IndicesFile,
  IntradayFile,
  MarketMeta,
  ScreenResult,
  StrategyId,
  UniverseFile,
} from '../types/market';
import { MarketDatabase, assembleMarketDatabase, computeBreadth } from '../data/marketRepository';
import { computeAllFactors } from '../models/factorEngine';
import { ScreenFilters, MarketBreadth } from '../types/market';
import { buildDailyBriefing, runScreen } from '../models/alphaScreener';
import {
  FundamentalsDatabase,
  FundamentalsFile,
  QuotesFile,
} from '../data/fundamentalsRepository';

async function readJson<T>(dir: string, name: string): Promise<T> {
  return JSON.parse(await readFile(join(dir, name), 'utf8')) as T;
}

async function tryReadJson<T>(dir: string, name: string): Promise<T | null> {
  try {
    return await readJson<T>(dir, name);
  } catch {
    return null;
  }
}

export async function loadMarketDatabaseFromDisk(dataDir: string): Promise<MarketDatabase> {
  const [meta, universe, daily, history, indices, intraday] = await Promise.all([
    readJson<MarketMeta>(dataDir, 'meta.json'),
    readJson<UniverseFile>(dataDir, 'universe.json'),
    readJson<DailyFile>(dataDir, 'daily.json'),
    readJson<HistoryFile>(dataDir, 'history.json'),
    readJson<IndicesFile>(dataDir, 'indices.json'),
    tryReadJson<IntradayFile>(dataDir, 'intraday.json'),
  ]);
  return assembleMarketDatabase({ meta, universe, daily, history, indices, intraday });
}

export async function loadFundamentalsFromDisk(dataDir: string): Promise<FundamentalsDatabase> {
  const [fundamentals, quotes] = await Promise.all([
    tryReadJson<FundamentalsFile>(dataDir, 'fundamentals.json'),
    tryReadJson<QuotesFile>(dataDir, 'quotes.json'),
  ]);
  return { fundamentals, quotes };
}

export interface DailyPickRun {
  db: MarketDatabase;
  result: ScreenResult;
  breadth: MarketBreadth;
  briefing: string;
}

export async function computeDailyPicks(
  dataDir: string,
  strategyId: StrategyId = 'balanced-alpha',
  filters: Partial<ScreenFilters> = {}
): Promise<DailyPickRun> {
  const db = await loadMarketDatabaseFromDisk(dataDir);
  const factors = computeAllFactors(db);

  const sma50 = new Map<string, number>();
  const sma200 = new Map<string, number>();
  for (const [code, f] of factors) {
    sma50.set(code, f.sma50);
    sma200.set(code, f.sma200);
  }
  const breadth = computeBreadth(db, sma50, sma200);

  const result = runScreen(db, { strategyId, filters, factors });
  const briefing = buildDailyBriefing(result, breadth.advancers, breadth.decliners);

  return { db, result, breadth, briefing };
}
