// Shared low-level helpers for talking to the IDX primary API.
// Node >= 18. Used only by the ingest scripts and the dev-server proxy plugin,
// never bundled into the browser build.
//
// NOTE ON TRANSPORT: idx.co.id sits behind Cloudflare bot protection that
// fingerprints the TLS handshake. Node's built-in fetch (undici) is rejected
// with HTTP 403 no matter which headers we send, while curl passes cleanly.
// So every request is shelled out to curl instead of using fetch.

import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const IDX_BASE = 'https://www.idx.co.id/primary';

// A persistent cookie jar keeps the Cloudflare clearance cookie across calls.
// Without it every request is treated as a cold visitor and the edge starts
// serving challenge pages after a few dozen hits.
const COOKIE_JAR = join(tmpdir(), 'valuationpro-idx-cookies.txt');

// Minimum gap between outbound requests, serialised process-wide. IDX tolerates
// a steady ~2-3 req/s from one session but blocks bursts.
let minGapMs = 320;
let chain = Promise.resolve();

export function setRequestGap(ms) {
  minGapMs = Math.max(0, ms);
}

/** Serialise callers so requests leave at a fixed cadence. */
function throttle() {
  const ticket = chain.then(() => sleep(minGapMs));
  chain = ticket;
  return ticket;
}
export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// The 11 IDX-IC sectors. Counts across these sum exactly to the listed universe.
export const IDX_SECTORS = [
  'Energy',
  'Basic Materials',
  'Industrials',
  'Consumer Non-Cyclicals',
  'Consumer Cyclicals',
  'Healthcare',
  'Financials',
  'Properties & Real Estate',
  'Technology',
  'Infrastructures',
  'Transportation & Logistic',
];

export const SECTOR_SLUG = {
  Energy: 'energy',
  'Basic Materials': 'basic',
  Industrials: 'industrials',
  'Consumer Non-Cyclicals': 'noncyclical',
  'Consumer Cyclicals': 'cyclical',
  Healthcare: 'healthcare',
  Financials: 'financials',
  'Properties & Real Estate': 'property',
  Technology: 'technology',
  Infrastructures: 'infrastructure',
  'Transportation & Logistic': 'transportation',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Raw GET via curl. Resolves with the response body as a string. */
function curlGet(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const args = [
      '-s',
      '-L',
      '--compressed',
      '--max-time',
      String(Math.ceil(timeoutMs / 1000)),
      '-A',
      UA,
      '-b',
      COOKIE_JAR,
      '-c',
      COOKIE_JAR,
      '-H',
      'Accept: application/json, text/plain, */*',
      '-H',
      'Accept-Language: en-US,en;q=0.9,id;q=0.8',
      '-H',
      'Referer: https://www.idx.co.id/en/market-data/trading-summary/stock-summary/',
      url,
    ];
    execFile('curl', args, { maxBuffer: 256 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

/**
 * GET + JSON with retry/backoff. IDX occasionally throws 403/502 under load.
 */
export async function getJson(url, { retries = 5, timeoutMs = 40000, pauseMs = 1200 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await throttle();
      const text = await curlGet(url, timeoutMs);
      if (!text || !text.trim()) throw new Error(`Empty response for ${url}`);
      if (text.trimStart().startsWith('<')) throw new Error(`Non-JSON (HTML/blocked) response for ${url}`);
      return JSON.parse(text);
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(pauseMs * Math.pow(2, attempt) + Math.random() * 300);
    }
  }
  throw lastErr;
}

/** Run `worker` over `items` with bounded concurrency, preserving input order. */
export async function mapPool(items, concurrency, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

export const enc = (s) => encodeURIComponent(s);
export const ymd = (d) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
export const isoDay = (s) => String(s).slice(0, 10);

/** Calendar days back from `end`, weekends dropped (IDX trades Mon-Fri). */
export function tradingCalendar(end, calendarDaysBack) {
  const days = [];
  for (let i = calendarDaysBack; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 86400000);
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue;
    days.push(d);
  }
  return days;
}

export { sleep };
