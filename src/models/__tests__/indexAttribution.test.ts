// Index attribution is only worth showing if it reconciles against the index
// IDX itself publishes. These checks run against the real bundled database, not
// fixtures, so a bad ingest or a changed feed shape fails the build rather than
// quietly producing plausible-looking nonsense.
//
// The core invariant is tested WITHOUT the live overlay. Comparing two published
// IDX sessions is a closed system: the contributions must add up exactly. Once a
// live quote is folded in, the constituent prices and the index level come from
// two independently-sampled feeds, so a small skew is expected and is a property
// of the data source rather than of the maths.

import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { assembleMarketDatabase } from '../../data/marketRepository';
import {
  DailyFile,
  HistoryFile,
  IndicesFile,
  IntradayFile,
  MarketMeta,
  UniverseFile,
} from '../../types/market';
import { loadMarketDatabaseFromDisk } from '../../server/marketFromDisk';
import { computeAttribution } from '../indexAttribution';

const DATA_DIR = join(process.cwd(), 'public', 'data', 'idx');

const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => results.push({ name, ok, detail });

const readJson = async <T,>(name: string): Promise<T> =>
  JSON.parse(await readFile(join(DATA_DIR, name), 'utf8')) as T;

/** The published-only database: no live overlay, so the maths must close exactly. */
async function loadPublishedOnly() {
  const [meta, universe, daily, history, indices] = await Promise.all([
    readJson<MarketMeta>('meta.json'),
    readJson<UniverseFile>('universe.json'),
    readJson<DailyFile>('daily.json'),
    readJson<HistoryFile>('history.json'),
    readJson<IndicesFile>('indices.json'),
  ]);
  return assembleMarketDatabase({ meta, universe, daily, history, indices, intraday: null });
}

async function main() {
  const published = await loadPublishedOnly();

  check('published-only database excludes the live overlay', published.live === null, `sesi ${published.meta.latestSession}`);

  const a = computeAttribution(published, '1d');
  if (!a) {
    check('attribution returns a result', false, 'null');
    return;
  }
  check('attribution returns a result', true, `${a.fromDate} -> ${a.toDate}`);

  check(
    'index shares are present for every contributor',
    a.leaders.concat(a.laggards).every((c) => c.indexShares > 0)
  );

  // The invariant: between two published sessions, contributions must sum to
  // the index move to within float noise.
  check(
    'contributions reconcile exactly between published sessions',
    Math.abs(a.reconciliation.residualPoints) < 0.01,
    `sum=${a.reconciliation.summedPoints.toFixed(4)} index=${a.indexPoints.toFixed(4)} residual=${a.reconciliation.residualPoints.toFixed(5)}`
  );

  check(
    'sector contributions sum to the total',
    Math.abs(a.sectors.reduce((s, x) => s + x.points, 0) - a.reconciliation.summedPoints) < 0.01,
    `${a.sectors.length} sektor`
  );

  check(
    'leaders rank above laggards',
    a.leaders[0].points >= a.laggards[0].points,
    `${a.leaders[0].emiten.code} ${a.leaders[0].points.toFixed(2)} vs ${a.laggards[0].emiten.code} ${a.laggards[0].points.toFixed(2)}`
  );

  // A weight is a share of the index and can never exceed 100%.
  const heaviest = Math.max(...a.leaders.concat(a.laggards).map((c) => c.indexWeight));
  check('no single weight exceeds 100%', heaviest > 0 && heaviest < 1, `terberat ${(heaviest * 100).toFixed(2)}%`);

  for (const period of ['1w', '1m', '3m'] as const) {
    const r = computeAttribution(published, period);
    check(
      `${period} reconciles within tolerance`,
      !!r && r.reconciliation.ok,
      r ? `residual=${r.reconciliation.residualPoints.toFixed(3)} index=${r.indexPoints.toFixed(2)}` : 'null'
    );
    check(
      `${period} residual is explained when non-trivial`,
      !!r && (Math.abs(r.reconciliation.residualPoints) < 0.01 || r.reconciliation.note !== null),
      r ? `${r.reconciliation.newListings} emiten baru` : 'null'
    );
  }

  const ytd = computeAttribution(published, 'ytd');
  check('ytd produces a window', !!ytd && ytd.fromDate < ytd.toDate, ytd ? `${ytd.fromDate} -> ${ytd.toDate}` : 'null');

  // With the live overlay the residual should still be small in relative terms,
  // and must always be explained to the reader.
  const live = await loadMarketDatabaseFromDisk(DATA_DIR);
  const intraday = await readJson<IntradayFile>('intraday.json').catch(() => null);
  if (live.live?.applied && intraday) {
    const l = computeAttribution(live, '1d');
    const relative = l && l.indexPoints !== 0 ? Math.abs(l.reconciliation.residualPoints / l.indexPoints) : 0;
    check(
      'live overlay residual stays under 10% of the move',
      !!l && (relative < 0.1 || Math.abs(l.reconciliation.residualPoints) < 1),
      l ? `residual=${l.reconciliation.residualPoints.toFixed(2)} dari ${l.indexPoints.toFixed(2)} poin` : 'null'
    );
    check(
      'live overlay residual is explained',
      !!l && (Math.abs(l.reconciliation.residualPoints) < 0.01 || l.reconciliation.note !== null)
    );
  } else {
    check('live overlay absent — skipped', true, 'tidak ada intraday.json aktif');
  }
}

main()
  .then(() => {
    let failed = 0;
    for (const r of results) {
      if (!r.ok) failed++;
      console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
    }
    console.log(`\n${results.length - failed}/${results.length} passed`);
    if (failed) process.exit(1);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
