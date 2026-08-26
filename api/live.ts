// Live price endpoint for the deployed terminal.
//
// WHY THIS EXISTS: on Vercel the app reads a committed snapshot of
// public/data/idx/intraday.json, refreshed only when the GitHub Actions cron
// runs — twice a trading day. Between 12:05 and 16:20 WIB the deployed prices
// therefore sat still while the market moved.
//
// A scheduler, a writable disk and `curl` are all genuinely impossible on
// serverless, which is why the ingest lives in CI. A stateless read-through
// proxy is the opposite: exactly what serverless is good at. Yahoo answers
// Node's built-in fetch (unlike IDX, which fingerprints TLS and rejects it),
// so this function can quote the whole universe on demand.
//
// The response is shaped identically to intraday.json, so the client folds it
// in through the same code path and falls back to the committed snapshot if
// this endpoint is unavailable.
//
// WHAT IT STILL CANNOT DO: foreign buy/sell volume. IDX publishes that only at
// end of day, from an endpoint that blocks datacenter fetch. Those factors keep
// coming from the committed snapshot, and the UI says so.

import type { VercelRequest, VercelResponse } from '@vercel/node';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const BATCH = 60;
const CONCURRENCY = 4;

/** Yahoo quotes these two IDX indices live; the sector indices are not quoted anywhere. */
const LIVE_INDEX_SYMBOLS: Record<string, string> = { '^JKSE': 'COMPOSITE', '^JKLQ45': 'LQ45' };

interface YahooQuote {
  symbol?: string;
  regularMarketPrice?: number;
  regularMarketPreviousClose?: number;
  regularMarketOpen?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
  regularMarketChangePercent?: number;
  regularMarketTime?: number;
  marketState?: string;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Jakarta wall-clock date, so the trading day matches what the app expects. */
function wibDate(at: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value])
  ) as Record<string, string>;
  return `${p.year}-${p.month}-${p.day}`;
}

function wibPhase(at: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hour12: false,
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value])
  ) as Record<string, string>;

  const weekday = p.weekday;
  if (weekday === 'Sat' || weekday === 'Sun') return 'weekend';

  const minutes = (Number(p.hour) % 24) * 60 + Number(p.minute);
  const friday = weekday === 'Fri';
  const sesi1End = friday ? 11 * 60 + 30 : 12 * 60;
  const sesi2Start = friday ? 14 * 60 : 13 * 60 + 30;

  if (minutes < 9 * 60) return 'pre-open';
  if (minutes < sesi1End) return 'sesi-1';
  if (minutes < sesi2Start) return 'break';
  if (minutes < 16 * 60 + 15) return 'sesi-2';
  return 'closed';
}

async function mapPool<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = cursor++;
        if (i >= items.length) return;
        out[i] = await worker(items[i]);
      }
    })
  );
  return out;
}

/** Yahoo gates its batch quote API behind a cookie + crumb pair. */
async function authenticate(): Promise<{ cookie: string; crumb: string }> {
  const seed = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': UA } }).catch(() => null);
  const cookie = (seed?.headers as unknown as { getSetCookie?: () => string[] })?.getSetCookie?.()
    ?.map((c) => c.split(';')[0])
    .join('; ') ?? '';

  const res = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, cookie },
  });
  const crumb = (await res.text()).trim();
  if (!crumb || crumb.includes('<') || crumb.length > 32) throw new Error('Tidak mendapat crumb dari Yahoo');
  return { cookie, crumb };
}

async function fetchBatch(symbols: string[], auth: { cookie: string; crumb: string }): Promise<YahooQuote[]> {
  const url =
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(','))}` +
    `&crumb=${encodeURIComponent(auth.crumb)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, cookie: auth.cookie } });
  if (!res.ok) return [];
  const body = (await res.json()) as { quoteResponse?: { result?: YahooQuote[] } };
  return body.quoteResponse?.result ?? [];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const started = Date.now();

  try {
    // The listed universe is a committed artefact; read it from the deployment
    // rather than shipping a second copy inside the function bundle.
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
    const universeRes = await fetch(`${proto}://${host}/data/idx/universe.json`);
    if (!universeRes.ok) throw new Error(`universe.json tidak terbaca (HTTP ${universeRes.status})`);
    const universe = (await universeRes.json()) as { emiten: { code: string }[] };

    const codes = universe.emiten.map((e) => e.code);
    const auth = await authenticate();

    const batches: string[][] = [];
    for (let i = 0; i < codes.length; i += BATCH) batches.push(codes.slice(i, i + BATCH).map((c) => `${c}.JK`));
    batches.push(Object.keys(LIVE_INDEX_SYMBOLS));

    const results = await mapPool(batches, CONCURRENCY, (b) => fetchBatch(b, auth).catch(() => []));

    const quotes: Record<string, unknown> = {};
    const indices: Record<string, unknown> = {};
    let marketState = 'UNKNOWN';
    let newestTime = 0;

    for (const rows of results) {
      for (const q of rows) {
        const symbol = String(q.symbol ?? '');
        const price = num(q.regularMarketPrice);
        if (!symbol || price === null) continue;

        if (q.marketState) marketState = q.marketState;
        if ((q.regularMarketTime ?? 0) > newestTime) newestTime = q.regularMarketTime ?? 0;

        const indexCode = LIVE_INDEX_SYMBOLS[symbol];
        if (indexCode) {
          indices[indexCode] = {
            close: price,
            prevClose: num(q.regularMarketPreviousClose),
            changePercent: num(q.regularMarketChangePercent),
          };
          continue;
        }

        quotes[symbol.replace('.JK', '')] = {
          price,
          prevClose: num(q.regularMarketPreviousClose),
          open: num(q.regularMarketOpen),
          high: num(q.regularMarketDayHigh),
          low: num(q.regularMarketDayLow),
          volume: num(q.regularMarketVolume),
          changePercent: num(q.regularMarketChangePercent),
          time: num(q.regularMarketTime),
        };
      }
    }

    const covered = Object.keys(quotes).length;
    // A near-empty result means Yahoo throttled us. Better to fail and let the
    // client keep the committed snapshot than to serve a half-empty market.
    if (covered < codes.length * 0.5) {
      throw new Error(`hanya ${covered}/${codes.length} emiten terkutip — kemungkinan dibatasi Yahoo`);
    }

    const now = new Date();
    // Cached at the edge: one invocation serves every visitor for a minute, so
    // traffic does not translate into load on Yahoo.
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=240');
    res.status(200).json({
      generatedAt: now.toISOString(),
      tradingDate: newestTime ? wibDate(new Date(newestTime * 1000)) : wibDate(now),
      marketState,
      sessionPhase: wibPhase(now),
      covered,
      attempted: codes.length,
      source: 'Vercel serverless -> Yahoo Finance (live, ~10 menit delay)',
      onDemand: true,
      foreignFlowAsOf: 'IDX end-of-day only — not available intraday',
      elapsedMs: Date.now() - started,
      quotes,
      indices,
    });
  } catch (err) {
    // 503 rather than 500: the client is expected to fall back to the committed
    // snapshot, and this is a dependency being unavailable, not a bug.
    res.setHeader('Cache-Control', 'no-store');
    res.status(503).json({ error: (err as Error).message, elapsedMs: Date.now() - started });
  }
}
