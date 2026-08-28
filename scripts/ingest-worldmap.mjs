/**
 * ingest-worldmap.mjs — tanker traffic through the world's chokepoints, the
 * disruptions hitting them, and enough coastline to draw a globe.
 *
 *   node scripts/ingest-worldmap.mjs [--days 120]
 *
 * WHY THIS BELONGS IN AN IDX TERMINAL. Five of the world's twenty-eight
 * shipping chokepoints are Indonesian — Malacca, Sunda, Lombok, Makassar and
 * Ombai — and Malacca is the busiest tanker passage on earth. Every tonne of
 * Indonesian coal and CPO leaves through one of them. A terminal that can tell
 * you PTBA moved 2% but cannot tell you that tanker transits through Malacca
 * collapsed is missing the part that happens upstream of the price.
 *
 * WHAT THE ALERTS ARE, AND WHAT THEY ARE NOT. IMF PortWatch tracks disruptions
 * to TRADE: earthquakes, cyclones, floods, wildfires, and the ports they close.
 * It is not a conflict feed. This app has no armed-conflict data because the
 * obvious free source (GDELT) is unreachable from the ingest host — every
 * request returns HTTP 000. Rather than dress natural hazards up as
 * "geopolitics", the screen says exactly which kind of alert it is showing.
 *
 * SOURCES, all free and unauthenticated:
 *   IMF PortWatch, ArcGIS FeatureServer
 *     Daily_Chokepoints_Data          daily vessel counts by type per chokepoint
 *     PortWatch_chokepoints_database  chokepoint names and coordinates
 *     portwatch_disruptions_database  disruption events with alert level
 *   world-atlas land-110m (Natural Earth, public domain) for the coastline
 *
 * THE COASTLINE IS DECODED HERE, NOT IN THE BROWSER. land-110m ships as
 * TopoJSON, which needs an arc-stitching pass to become drawable rings. Doing
 * that at ingest and storing plain coordinate rings keeps the browser free of a
 * topojson dependency — this app has exactly one third-party runtime dependency
 * (the TradingView widget) and that is worth protecting.
 *
 * Writes public/data/idx/worldmap.json
 */
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'data', 'idx');

const argv = process.argv.slice(2);
const argVal = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const DAYS = Number(argVal('--days', 120));

const log = (...a) => console.log(`[worldmap ${new Date().toISOString().slice(11, 19)}]`, ...a);

const PW = 'https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Chokepoints that are Indonesian water, flagged for the IDX linkage. */
const INDONESIAN = new Set(['Malacca Strait', 'Sunda Strait', 'Lombok Strait', 'Makassar Strait', 'Ombai Strait']);

function curl(args) {
  return new Promise((resolve, reject) => {
    execFile('curl', args, { maxBuffer: 128 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

async function getJson(url) {
  const text = await curl(['-s', '-m', '90', '-A', UA, url]);
  return JSON.parse(text);
}

const q = (service, params) =>
  `${PW}/${service}/FeatureServer/0/query?${new URLSearchParams({ f: 'json', ...params }).toString()}`;

/**
 * Page through a FeatureServer until it stops handing back rows.
 *
 * ArcGIS caps every response at the service's own `maxRecordCount` — 1000 here —
 * and asking for more does not raise an error, it just returns 1000 and sets
 * `exceededTransferLimit`. The first version of this file requested 32,000 rows,
 * got exactly 1000, and computed a "last 7 days versus prior 30" trend from a
 * window that was silently a third of the length it claimed. A round number in a
 * row count is worth distrusting.
 */
async function queryAll(service, params, pageSize = 1000) {
  const out = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await getJson(
      q(service, { ...params, resultOffset: String(offset), resultRecordCount: String(pageSize) })
    );
    const feats = page.features || [];
    out.push(...feats.map((f) => f.attributes));
    if (feats.length < pageSize || !page.exceededTransferLimit) break;
    if (offset > 200000) throw new Error(`paginasi ${service} tidak berhenti`);
  }
  return out;
}

/**
 * TopoJSON -> arrays of [lon, lat] rings.
 *
 * TopoJSON stores shared borders once as "arcs" of delta-encoded integers and
 * has geometries reference them by index; a negative index means traverse that
 * arc backwards. Decoding is: undo the quantisation transform, accumulate the
 * deltas, then stitch the referenced arcs in order. Forty lines here saves a
 * runtime dependency in every browser that loads the app.
 */
function topoToRings(topo, objectName) {
  const { scale, translate } = topo.transform;
  const arcs = topo.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
    });
  });

  const stitch = (indexes) => {
    const out = [];
    for (const idx of indexes) {
      const arc = idx < 0 ? arcs[~idx].slice().reverse() : arcs[idx];
      // The last point of one arc is the first of the next; dropping the
      // duplicate keeps the ring from doubling back on itself.
      out.push(...(out.length ? arc.slice(1) : arc));
    }
    return out;
  };

  const rings = [];
  const walk = (geom) => {
    if (geom.type === 'GeometryCollection') return geom.geometries.forEach(walk);
    if (geom.type === 'Polygon') return geom.arcs.forEach((r) => rings.push(stitch(r)));
    if (geom.type === 'MultiPolygon') {
      return geom.arcs.forEach((poly) => poly.forEach((r) => rings.push(stitch(r))));
    }
  };
  walk(topo.objects[objectName]);
  return rings;
}

/**
 * Drop points that add no visible shape at globe scale, then round.
 *
 * The globe is drawn a few hundred pixels wide, where a tenth of a degree is
 * well under a pixel. Keeping full precision would triple the file for detail
 * nobody can see. Rings that fall below four points after thinning are dropped
 * entirely: they are islands smaller than the dot used to mark a chokepoint.
 */
function simplifyRings(rings, minPoints = 4, round = 1) {
  const out = [];
  for (const ring of rings) {
    const step = ring.length > 400 ? 3 : ring.length > 150 ? 2 : 1;
    const thinned = ring.filter((_, i) => i % step === 0 || i === ring.length - 1);
    if (thinned.length < minPoints) continue;
    out.push(thinned.map(([x, y]) => [Number(x.toFixed(round)), Number(y.toFixed(round))]));
  }
  return out;
}

async function main() {
  // ---- chokepoint coordinates -------------------------------------------
  log('menarik daftar chokepoint...');
  const cpMeta = await getJson(
    q('PortWatch_chokepoints_database', {
      where: '1=1',
      outFields: 'portid,portname,fullname,lat,lon',
      returnGeometry: 'false',
      resultRecordCount: '200',
    })
  );
  const coords = new Map();
  for (const f of cpMeta.features || []) {
    const a = f.attributes;
    if (Number.isFinite(a.lat) && Number.isFinite(a.lon)) {
      coords.set(a.portid, { name: a.portname, fullname: a.fullname || a.portname, lat: a.lat, lon: a.lon });
    }
  }
  log(`  ${coords.size} chokepoint punya koordinat`);

  // ---- daily traffic ------------------------------------------------------
  const since = new Date(Date.now() - DAYS * 86400000).toISOString().slice(0, 10);
  log(`menarik lalu lintas harian sejak ${since}...`);
  const rows = await queryAll('Daily_Chokepoints_Data', {
    where: `date>='${since}'`,
    outFields: 'date,portid,portname,n_tanker,n_cargo,n_total,capacity_tanker,capacity',
    returnGeometry: 'false',
    orderByFields: 'date ASC',
  });
  log(`  ${rows.length} baris harian`);

  const byPort = new Map();
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  for (const r of rows) {
    const list = byPort.get(r.portid) ?? [];
    list.push(r);
    byPort.set(r.portid, list);
  }

  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

  const chokepoints = [];
  for (const [portid, list] of byPort) {
    const meta = coords.get(portid);
    if (!meta) continue;
    list.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const tankers = list.map((r) => r.n_tanker ?? 0);
    const latest = list[list.length - 1];
    // A single day of traffic is noise — weekends and weather move it by half.
    // Comparing the last week against the previous month is the shortest window
    // where a real change in transits separates from ordinary variation.
    const last7 = mean(tankers.slice(-7));
    const prior30 = mean(tankers.slice(-37, -7));
    chokepoints.push({
      id: portid,
      name: meta.name,
      fullname: meta.fullname,
      lat: meta.lat,
      lon: meta.lon,
      indonesian: INDONESIAN.has(meta.name),
      latestDate: latest.date,
      tankersLatest: latest.n_tanker ?? 0,
      totalLatest: latest.n_total ?? 0,
      tankers7d: Number(last7.toFixed(1)),
      tankersPrior30d: Number(prior30.toFixed(1)),
      tankerTrend: Number.isFinite(last7) && Number.isFinite(prior30) && prior30 > 0
        ? Number((last7 / prior30 - 1).toFixed(4))
        : null,
      capacityTankerLatest: latest.capacity_tanker ?? 0,
      series: tankers.join(','),
    });
  }
  chokepoints.sort((a, b) => b.tankers7d - a.tankers7d);
  log(`  ${chokepoints.length} chokepoint terangkai, ${chokepoints.filter((c) => c.indonesian).length} di perairan Indonesia`);

  // ---- disruptions --------------------------------------------------------
  log('menarik kejadian disrupsi...');
  const disrRows = await queryAll('portwatch_disruptions_database', {
    where: 'year>=2024',
    outFields: 'eventid,eventtype,eventname,alertlevel,country,fromdate,todate,severitytext,n_affectedports,lat,long',
    returnGeometry: 'false',
    orderByFields: 'fromdate DESC',
  });
  const TYPE_LABEL = {
    EQ: 'Gempa',
    TC: 'Siklon tropis',
    FL: 'Banjir',
    WF: 'Kebakaran hutan',
    VO: 'Erupsi gunung api',
    DR: 'Kekeringan',
  };
  const events = disrRows
    .filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.long))
    .map((a) => ({
      id: a.eventid,
      type: a.eventtype,
      typeLabel: TYPE_LABEL[a.eventtype] || a.eventtype,
      name: a.eventname,
      alert: a.alertlevel,
      country: a.country,
      from: a.fromdate ? new Date(a.fromdate).toISOString().slice(0, 10) : null,
      to: a.todate ? new Date(a.todate).toISOString().slice(0, 10) : null,
      severity: a.severitytext || null,
      affectedPorts: a.n_affectedports ?? 0,
      lat: a.lat,
      lon: a.long,
    }));
  log(`  ${events.length} kejadian sejak 2024`);

  // ---- coastline ----------------------------------------------------------
  log('menarik garis pantai (Natural Earth land-110m)...');
  const topo = await getJson('https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json');
  const rings = simplifyRings(topoToRings(topo, 'land'));
  const points = rings.reduce((n, r) => n + r.length, 0);
  log(`  ${rings.length} poligon, ${points} titik`);

  const payload = {
    generatedAt: new Date().toISOString(),
    windowDays: DAYS,
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
    source:
      'IMF PortWatch (Daily_Chokepoints_Data, PortWatch_chokepoints_database, portwatch_disruptions_database) + Natural Earth land-110m',
    scope:
      'Jumlah kapal per hari yang melintas 28 selat kunci dunia, dipecah per jenis kapal, plus kejadian yang mengganggu perdagangan beserta pelabuhan yang terdampak. Kejadian di sini adalah BENCANA ALAM dan gangguan pelabuhan, BUKAN konflik bersenjata.',
    limits: [
      'Bukan feed konflik. IMF PortWatch melacak gangguan terhadap perdagangan — gempa, siklon, banjir, kebakaran — bukan perang atau sanksi.',
      'Bukan posisi kapal real-time. Yang ada jumlah transit harian per selat, bukan koordinat tiap kapal. Data AIS per kapal itu berbayar dan tidak ada endpoint publiknya.',
      'Garis pantai resolusi 110m dan disederhanakan lagi untuk ukuran layar. Cukup untuk mengenali benua, tidak untuk mengukur apa pun.',
    ],
    dates,
    chokepoints,
    events,
    land: rings,
  };

  await mkdir(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, 'worldmap.json');
  await writeFile(file, JSON.stringify(payload));
  const { size } = await stat(file);
  log(
    `wrote worldmap.json — ${chokepoints.length} selat, ${events.length} kejadian, ${rings.length} poligon, ${(size / 1024).toFixed(0)} KB`
  );

  if (!chokepoints.length) throw new Error('tidak ada chokepoint terangkai — feed PortWatch berubah?');
  // 28 chokepoints x DAYS is the shape this file expects. Landing far short of
  // it means a transfer cap bit again, and every trend above would be computed
  // on a shorter window than it claims.
  const expected = chokepoints.length * DAYS * 0.6;
  if (rows.length < expected) {
    throw new Error(
      `hanya ${rows.length} baris harian untuk ${chokepoints.length} selat x ${DAYS} hari — paginasi terpotong`
    );
  }
  if (!rings.length) throw new Error('garis pantai kosong — sumber land-110m berubah?');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
