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
import { CONGLOMERATE_GROUPS, findDuplicateMembers } from '../../data/conglomerates';

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

  // With the live overlay the residual should still be small, and must always be
  // explained to the reader.
  //
  // ── WHY THIS IS NOT ONE RATIO ─────────────────────────────────────────────
  //
  // "Residual under 10% of the move" is the right question on a normal day and
  // a meaningless one thirty minutes into a flat session. The denominator is a
  // difference between two nearly-equal index levels: measured 2026-09-02 at
  // 09:22 WIB, IHSG had moved 2.92 points on a level of 6,602 — 0.04% — while
  // the residual was 3.19 points, or 109% of the move and 0.048% of the level.
  // The ratio does not describe an error there, it describes a denominator
  // approaching zero, and the old absolute escape hatch (< 1 point) was never
  // exercised because every earlier run had an overlay identical to the
  // committed close, which reconciles at exactly 0.00.
  //
  // BOTH ALTERNATIVE EXPLANATIONS WERE CHECKED AND RULED OUT before this test
  // was touched, because widening a tolerance to make a red test green is how
  // a real defect gets buried:
  //
  //   · the engine — published-vs-published reconciles to under 0.01 points
  //     (asserted above), so the weights, the divisor and the arithmetic are
  //     right;
  //   · the baseline — Yahoo's ^JKSE previousClose was 6599.943 against IDX's
  //     own published close of 6599.943, exact to the last digit, so the two
  //     feeds are not measuring from different starting points;
  //   · the constituents — two quotes WERE poisoning the overlay (SCPI priced
  //     at 0, FASW stamped nineteen months stale) and both were fixed in
  //     ingest-intraday.mjs. The residual did not move, which is what proved
  //     it is feed skew rather than bad data.
  //
  // So: on a real move the strict ratio still applies. Below that, the ratio is
  // not evaluated at all and the residual is held against the index LEVEL,
  // which does not collapse. That second bound is a FEED-NOISE bound, not a
  // correctness bound — correctness is proven by the published-only check.
  const MEANINGFUL_MOVE_POINTS = 20;
  const NOISE_FRACTION_OF_LEVEL = 0.001;
  const live = await loadMarketDatabaseFromDisk(DATA_DIR);
  const intraday = await readJson<IntradayFile>('intraday.json').catch(() => null);
  if (live.live?.applied && intraday) {
    const l = computeAttribution(live, '1d');
    const relative = l && l.indexPoints !== 0 ? Math.abs(l.reconciliation.residualPoints / l.indexPoints) : 0;
    const movedEnough = !!l && Math.abs(l.indexPoints) >= MEANINGFUL_MOVE_POINTS;
    const withinNoise = !!l && Math.abs(l.reconciliation.residualPoints) < l.indexNow * NOISE_FRACTION_OF_LEVEL;
    check(
      movedEnough
        ? 'live overlay residual stays under 10% of the move'
        : 'live overlay residual stays inside feed noise (gerak indeks terlalu kecil untuk rasio)',
      !!l && (movedEnough ? relative < 0.1 : withinNoise),
      l
        ? `residual=${l.reconciliation.residualPoints.toFixed(2)} dari ${l.indexPoints.toFixed(2)} poin ` +
          `(${((Math.abs(l.reconciliation.residualPoints) / l.indexNow) * 100).toFixed(3)}% dari level ${l.indexNow.toFixed(0)})`
        : 'null'
    );
    check(
      'live overlay residual is explained',
      !!l && (Math.abs(l.reconciliation.residualPoints) < 0.01 || l.reconciliation.note !== null)
    );
  } else {
    check('live overlay absent — skipped', true, 'tidak ada intraday.json aktif');
  }

  // ---------------------------------------------------------------- curation
  //
  // The conglomerate table is hand-edited — DATA_PIPELINE.md says so, because
  // IDX publishes no machine-readable controlling-owner map. Its one silent
  // failure mode is listing the same ticker under two groups: GROUP_BY_CODE
  // resolves to whichever was declared last and the member vanishes from the
  // other group's rotation, cohesion and dispersion without any error. The
  // guard for that already existed in conglomerates.ts and had never been
  // called by anything, which made it decoration rather than a guard.
  const dupes = findDuplicateMembers();
  check(
    'no emiten is listed in two conglomerate groups',
    dupes.length === 0,
    dupes.length
      ? dupes.map((d) => `${d.code} in ${d.groups.join(' + ')}`).join(', ')
      : `${CONGLOMERATE_GROUPS.length} grup, ${CONGLOMERATE_GROUPS.reduce((n, g) => n + g.members.length, 0)} anggota`
  );

  // A group of one cannot have a cohesion or a dispersion — computeGroupRotation
  // returns null below two present members, so a single-member row is a curation
  // slip that quietly drops out of the whole rotation screen.
  const tooSmall = CONGLOMERATE_GROUPS.filter((g) => g.members.length < 2);
  check(
    'every conglomerate group has at least two members',
    tooSmall.length === 0,
    tooSmall.length ? tooSmall.map((g) => g.id).join(', ') : 'semua grup punya >= 2 anggota'
  );
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
