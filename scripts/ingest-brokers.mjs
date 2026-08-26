/**
 * ingest-brokers.mjs — daily broker (anggota bursa) activity.
 *
 *   node scripts/ingest-brokers.mjs [--days 180] [--gap 350]
 *
 * WHAT IDX ACTUALLY PUBLISHES: /TradingSummary/GetBrokerSummary returns, for
 * each of the ~88 exchange members, its TOTAL volume, value and trade count for
 * the session — market-wide, not broken down by stock.
 *
 * WHAT IT DOES NOT PUBLISH: the per-stock broker breakdown ("which broker
 * accumulated BBCA today") that bandarmology tools use. That feed is a
 * commercial IDX Data Services product and is not reachable from the public
 * API — the `code=` parameter is silently ignored, returning the same
 * market-wide rows. This script therefore builds a market-participant view, and
 * the UI says plainly that per-stock attribution is unavailable rather than
 * implying otherwise.
 *
 * Writes public/data/idx/brokers.json
 */
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IDX_BASE, getJson, mapPool, ymd, isoDay, tradingCalendar, setRequestGap } from './idx-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'data', 'idx');
const CACHE_DIR = join(ROOT, '.cache', 'brokers');

const argv = process.argv.slice(2);
const argVal = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const DAYS = Number(argVal('--days', 180));
const CONCURRENCY = Number(argVal('--concurrency', 2));
setRequestGap(Number(argVal('--gap', 350)));

const log = (...a) => console.log(`[brokers ${new Date().toISOString().slice(11, 19)}]`, ...a);

async function fetchDay(date) {
  const key = ymd(date);
  const file = join(CACHE_DIR, `day-${key}.json`);
  try {
    await stat(file);
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    /* miss */
  }
  const res = await getJson(`${IDX_BASE}/TradingSummary/GetBrokerSummary?length=300&start=0&date=${key}`);
  const rows = res.data || [];
  const payload = {
    actual: rows.length ? isoDay(rows[0].Date) : null,
    brokers: rows.map((r) => ({
      id: r.IDFirm,
      name: (r.FirmName || '').trim(),
      volume: Number(r.Volume) || 0,
      value: Number(r.Value) || 0,
      frequency: Number(r.Frequency) || 0,
    })),
  };
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(payload));
  return payload;
}

const csv = (arr) => arr.map((x) => (x === null || x === undefined ? '' : x)).join(',');

async function main() {
  const calendar = tradingCalendar(new Date(), DAYS);
  log(`crawling broker summary for ${calendar.length} weekdays...`);

  let done = 0;
  let failed = 0;
  const raw = await mapPool(calendar, CONCURRENCY, async (d) => {
    try {
      const r = await fetchDay(d);
      if (++done % 40 === 0) log(`  ${done}/${calendar.length}`);
      return r;
    } catch {
      failed++;
      done++;
      return null;
    }
  });

  const byDate = new Map();
  for (const day of raw) {
    if (!day?.actual || !day.brokers.length) continue;
    if (!byDate.has(day.actual)) byDate.set(day.actual, day);
  }
  const sessions = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const dates = sessions.map(([d]) => d);
  log(`resolved ${dates.length} sessions (${failed} gagal): ${dates[0]} -> ${dates[dates.length - 1]}`);

  // Identity table, then one series per broker so the client can chart share.
  const names = new Map();
  for (const [, day] of sessions) for (const b of day.brokers) if (b.id) names.set(b.id, b.name);

  const ids = [...names.keys()].sort();
  const series = {};
  for (const id of ids) series[id] = { v: [], t: [], f: [] };

  for (const [, day] of sessions) {
    const seen = new Set();
    for (const b of day.brokers) {
      if (!series[b.id]) continue;
      seen.add(b.id);
      series[b.id].v.push(b.volume ? Math.round(b.volume / 1e3) : ''); // thousand shares
      series[b.id].t.push(b.value ? Math.round(b.value / 1e6) : ''); // IDR million
      series[b.id].f.push(b.frequency || '');
    }
    for (const id of ids) {
      if (!seen.has(id)) {
        series[id].v.push('');
        series[id].t.push('');
        series[id].f.push('');
      }
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    dates,
    latestSession: dates[dates.length - 1],
    brokerCount: ids.length,
    source: 'IDX /primary/TradingSummary/GetBrokerSummary',
    scope: 'market-wide per broker; IDX does not publish a per-stock broker breakdown publicly',
    brokers: ids.map((id) => ({ id, name: names.get(id) || id })),
    series: Object.fromEntries(ids.map((id) => [id, { v: csv(series[id].v), t: csv(series[id].t), f: csv(series[id].f) }])),
  };

  await mkdir(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, 'brokers.json');
  await writeFile(file, JSON.stringify(payload));
  const { size } = await stat(file);
  log(`wrote brokers.json — ${ids.length} anggota bursa, ${dates.length} sesi (${(size / 1024).toFixed(0)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
