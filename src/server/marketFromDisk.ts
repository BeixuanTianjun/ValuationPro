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
  UniverseFile,
} from '../types/market';
import { MarketDatabase, assembleMarketDatabase, computeBreadth } from '../data/marketRepository';
import { computeAllFactors } from '../models/factorEngine';
import { MarketBreadth } from '../types/market';
import { ScreenerResult, runStockScreener } from '../models/stockScreener';
import { WatchlistResult, buildWatchlist } from '../models/watchlist';
import { buildEventRadar, type RadarResult } from '../models/eventRadar';
import { AnnouncementsFile } from '../models/announcements';
import { ChatContext } from './chatApi';
import { MacroFile } from '../models/macroLinkage';
import { WorldMapSummary } from './chatApi';
import { OwnershipFile } from '../models/ownershipFlow';
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

/**
 * @param historyFile which history payload to build from. The backtest passes
 *   'history-recent.json' to check that the browser's first-phase database is
 *   not quietly full of NaNs — the shorter window is what the terminal draws
 *   from for the first few seconds of every visit, and nothing else exercises it.
 */
export async function loadMarketDatabaseFromDisk(
  dataDir: string,
  historyFile = 'history.json'
): Promise<MarketDatabase> {
  const [meta, universe, daily, history, indices, intraday] = await Promise.all([
    readJson<MarketMeta>(dataDir, 'meta.json'),
    readJson<UniverseFile>(dataDir, 'universe.json'),
    readJson<DailyFile>(dataDir, 'daily.json'),
    readJson<HistoryFile>(dataDir, historyFile),
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

/**
 * The two optional feeds the chatbot dossier needs.
 *
 * Returned as nulls rather than throwing when a weekly ingest has not run: the
 * dossier prints "this file was never built" for a null, which is a different
 * and more useful answer than "this emiten filed nothing".
 */
export async function loadChatContextFromDisk(dataDir: string): Promise<ChatContext> {
  const [announcements, ownership, macro, worldmap] = await Promise.all([
    tryReadJson<AnnouncementsFile>(dataDir, 'announcements.json'),
    tryReadJson<OwnershipFile>(dataDir, 'ownership.json'),
    tryReadJson<MacroFile>(dataDir, 'macro.json'),
    tryReadJson<WorldMapSummary>(dataDir, 'worldmap.json'),
  ]);
  return { announcements, ownership, macro, worldmap };
}

export interface DailyDigestRun {
  db: MarketDatabase;
  screener: ScreenerResult;
  watchlist: WatchlistResult;
  breadth: MarketBreadth;
  /**
   * Baris radar peristiwa untuk sesi ini.
   *
   * Ikut di sini dan bukan di kanal sendiri karena radar adalah SATU-SATUNYA
   * layar yang gunanya justru saat aplikasinya tidak dibuka: pengajuan
   * perubahan kendali terbit di tengah jam bursa, dan yang membacanya besok
   * pagi sudah membaca berita, bukan radar.
   */
  radar: RadarResult;
}

/**
 * The digest the email actually sends, built from the two systems the terminal
 * shows — not from the factor model.
 *
 * Both run against the SAME database the browser assembles: a digest that
 * disagrees with the screen the app shows would be worse than no digest. The watchlist runs on the weekly clock because the email goes out
 * daily and a monthly half-life would resend the same three names for a month.
 */
export async function computeDailyDigest(dataDir: string): Promise<DailyDigestRun> {
  const db = await loadMarketDatabaseFromDisk(dataDir);
  const factors = computeAllFactors(db);

  const sma50 = new Map<string, number>();
  const sma200 = new Map<string, number>();
  for (const [code, f] of factors) {
    sma50.set(code, f.sma50);
    sma200.set(code, f.sma200);
  }
  const breadth = computeBreadth(db, sma50, sma200);

  // Both feeds are optional: the digest degrades to screener-only rather than
  // failing if a weekly ingest has not run yet.
  const [announcements, ownership] = await Promise.all([
    tryReadJson<AnnouncementsFile>(dataDir, 'announcements.json'),
    tryReadJson<OwnershipFile>(dataDir, 'ownership.json'),
  ]);

  const screener = runStockScreener(db);
  const watchlist = buildWatchlist({
    db,
    factors,
    announcements,
    ownership,
    horizon: 'mingguan',
    limit: 8,
  });

  return { db, screener, watchlist, breadth, radar: buildEventRadar(db, announcements) };
}
