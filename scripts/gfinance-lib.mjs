// Google Finance as a SECOND quote source.
//
// WHAT WAS ACTUALLY MEASURED, before deciding how to use it:
//
//   · Google carries IDX intraday as 5-minute OHLCV bars with WIB timestamps,
//     right through the closing auction. On 2026-08-27 its last bar closed BBCA
//     at 6400 — the same number Yahoo's quote endpoint returned. So Google is
//     NOT fresher than Yahoo. It is a second opinion, not an upgrade.
//   · There is no batch endpoint. `/async/finance_wholepage_realtime_update`
//     answers 404. One ticker means one 182 KB HTML page, so quoting all 962
//     emiten from Google would be 962 requests and ~175 MB per refresh — an
//     order of magnitude worse than Yahoo's 60-symbols-per-call batch.
//   · The price lives in an undocumented JSON blob inside the page, not in a
//     documented API. That is fragile by construction, which is exactly why it
//     is wired as a fallback and never as the primary.
//
// SO IT IS USED FOR ONE THING: when Yahoo returns nothing — its quote API is
// gated behind a cookie+crumb pair that periodically fails with
// "Unauthorized" — the most liquid names are re-quoted here so the terminal
// shows a live market instead of a blank one. Bounded on purpose: a full
// fallback sweep would take longer than the session it is trying to report.

import { execFile } from 'node:child_process';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function curl(url, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    execFile(
      'curl',
      ['-s', '-L', '--compressed', '-m', String(Math.ceil(timeoutMs / 1000)), '-A', UA, url],
      { maxBuffer: 32 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(stdout))
    );
  });
}

/**
 * Bar field order, established by continuity rather than by documentation:
 * each bar's second field equals the next bar's first field, which only holds
 * if the layout is [open, close, high, low, isoTime, volume].
 */
const BAR = /\[(\d+(?:\.\d+)?),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?),"([0-9T:+\-]+)",(\d+)\]/g;

/**
 * Quote one IDX ticker from Google Finance.
 *
 * Returns null rather than throwing when the page shape changes: a fallback
 * that crashes the ingest is worse than a fallback that declines.
 */
export async function fetchGoogleQuote(code) {
  let html;
  try {
    html = await curl(`https://www.google.com/finance/quote/${encodeURIComponent(code)}:IDX`);
  } catch {
    return null;
  }
  if (!html || html.length < 5000) return null;

  const bars = [];
  BAR.lastIndex = 0;
  let m;
  while ((m = BAR.exec(html)) !== null) {
    bars.push({
      open: Number(m[1]),
      close: Number(m[2]),
      high: Number(m[3]),
      low: Number(m[4]),
      time: m[5],
      volume: Number(m[6]),
    });
  }
  if (!bars.length) return null;

  // The page embeds several ranges (1D, 5D, 1M...). Only the bars carrying the
  // most recent calendar date belong to today's session.
  const lastDay = bars[bars.length - 1].time.slice(0, 10);
  const today = bars.filter((b) => b.time.startsWith(lastDay));
  if (!today.length) return null;

  return {
    code,
    tradingDate: lastDay,
    price: today[today.length - 1].close,
    open: today[0].open,
    high: Math.max(...today.map((b) => b.high)),
    low: Math.min(...today.map((b) => b.low)),
    volume: today.reduce((s, b) => s + b.volume, 0),
    lastBarAt: today[today.length - 1].time,
    bars: today.length,
    source: 'google-finance',
  };
}

/** Quote a bounded list with small concurrency. Google throttles hard. */
export async function fetchGoogleQuotes(codes, { concurrency = 3, limit = 120 } = {}) {
  const wanted = codes.slice(0, limit);
  const out = new Map();
  let cursor = 0;

  const worker = async () => {
    while (cursor < wanted.length) {
      const code = wanted[cursor++];
      const q = await fetchGoogleQuote(code);
      if (q) out.set(code, q);
      await new Promise((r) => setTimeout(r, 250));
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, wanted.length) }, worker));
  return out;
}
