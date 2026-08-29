/**
 * ingest-risk.mjs — Indonesia stress components, from named public sources only.
 *
 *   node scripts/ingest-risk.mjs [--days 90]
 *
 * WHAT THIS IS, AND WHY IT IS ALLOWED TO EXIST. WorldMonitor sells a Composite
 * Instability Index, computed on their server. This project's rule is not "never
 * build a composite" — it is never to patch a gap with a proxy and never to
 * publish a number whose method is hidden. So this builds the same KIND of thing
 * under the opposite constraint: every input is a named public endpoint, the
 * arithmetic is printed inside the output, and the components are published raw
 * beside the score so a reader can throw the score away and keep the inputs.
 *
 * WHAT IT IS NOT. It is not validated against anything. No one has shown that
 * this score leads, lags or explains any Indonesian market variable, and the
 * payload says so in its own `note`. It is a stress reading, not a signal.
 *
 * Writes public/data/idx/risk.json
 */
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'data', 'idx');

const argv = process.argv.slice(2);
const argVal = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const DAYS = Number(argVal('--days', 90));

const log = (...a) => console.log(`[risk ${new Date().toISOString().slice(11, 19)}]`, ...a);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';

// Indonesia's bounding box, used for the seismic query. Wide enough to include
// the whole archipelago from Aceh to Papua.
const BBOX = { minlat: -11, maxlat: 6, minlon: 95, maxlon: 141 };

const get = async (url, kind = 'json') => {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(90000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return kind === 'json' ? res.json() : res.text();
};

const iso = (d) => d.toISOString().slice(0, 10);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const sd = (a) => {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};
/** z of the latest reading against the rest of its own window. */
const zLatest = (series) => {
  if (series.length < 8) return null;
  const hist = series.slice(0, -1);
  const s = sd(hist);
  if (!s || !Number.isFinite(s) || s === 0) return null;
  return Number(((series[series.length - 1] - mean(hist)) / s).toFixed(3));
};

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const components = [];
  const unavailable = [];

  // ---- 1. GDELT conflict share, from the file ingest-gdelt.mjs already wrote
  try {
    const g = JSON.parse(await readFile(join(OUT_DIR, 'gdelt.json'), 'utf8'));
    // Two filters, both load-bearing. `covered` drops days represented only by
    // backfill arriving in later slices — they hold a fraction of a percent of
    // their real events and would draw a cliff at the edge of the ingest window.
    // The event floor drops days too thin for a share to mean anything: four
    // events can read 100% conflict and say nothing at all.
    const days = (g.days || []).filter((d) => d.covered !== false && d.events >= 30);

    // Built as one array so share, tone and date can never drift apart. Filtering
    // nulls out of a mapped tone list separately is how `tones[len-1]` quietly
    // becomes a different day from `shares[len-1]` the first time a tone is null.
    const rows = days
      .map((d) => {
        const denom = d.conflict + d.cooperation;
        return {
          date: d.date,
          // A day where every quad class failed to parse would divide by zero.
          // Clamping the denominator to 1 turns that into a 0.0000 conflict share
          // — a record-calm reading — where the honest answer is "no data".
          share: denom > 0 ? d.conflict / denom : null,
          tone: d.avgTone,
        };
      })
      .filter((r) => r.share !== null);

    const shares = rows.map((r) => r.share);
    const toneRows = rows.filter((r) => r.tone !== null);

    if (shares.length >= 8) {
      components.push({
        id: 'gdelt_conflict_share',
        label: 'Pangsa peristiwa konflik (GDELT quad 3-4)',
        source: 'GDELT 2.0 Events via data.gdeltproject.org',
        latest: Number(shares[shares.length - 1].toFixed(4)),
        latestDate: rows[rows.length - 1].date,
        // The mean the z was actually divided against — the history EXCLUDING the
        // latest point. Publishing the all-inclusive mean instead means anyone
        // recomputing (latest - mean)/sd gets a different number than the one
        // shipped: 0.2160 published against 0.2182 used. Small, and exactly the
        // "looks reasonable, is not what you think" shape this repo keeps paying for.
        baselineMean: Number(mean(shares.slice(0, -1)).toFixed(4)),
        windowDays: shares.length,
        n: shares.length,
        z: zLatest(shares),
      });
    } else {
      unavailable.push({
        id: 'gdelt_conflict_share',
        reason: `hanya ${shares.length} hari terliput dengan >=30 peristiwa; butuh 8 untuk z-score`,
      });
    }

    if (toneRows.length >= 8) {
      const tones = toneRows.map((r) => r.tone);
      const z = zLatest(tones);
      components.push({
        id: 'gdelt_tone',
        label: 'Nada rata-rata pemberitaan (negatif = memburuk)',
        source: 'GDELT 2.0 Events via data.gdeltproject.org',
        latest: tones[tones.length - 1],
        latestDate: toneRows[toneRows.length - 1].date,
        baselineMean: Number(mean(tones.slice(0, -1)).toFixed(3)),
        windowDays: tones.length,
        n: tones.length,
        // Tone is negative-is-worse, so the sign is flipped to keep every
        // component pointing the same way: higher z = more stress.
        z: z === null ? null : Number((-z).toFixed(3)),
      });
    } else {
      unavailable.push({ id: 'gdelt_tone', reason: `hanya ${toneRows.length} hari terliput bernada terukur` });
    }
  } catch (err) {
    unavailable.push({
      id: 'gdelt',
      reason: `gdelt.json tidak terbaca (${String(err.message).slice(0, 60)}) — jalankan npm run data:gdelt dulu`,
    });
  }

  // ---- 2. Seismicity, USGS
  try {
    // The series ends at the last COMPLETE UTC day, not at "now". Ending it at now
    // makes the newest bucket a partial day — a few hours of a 24-hour count —
    // which is then compared against a baseline of whole days and reads as a fall
    // in activity that is really just the clock. Fixing only the `endtime` bug
    // below would have swapped a guaranteed zero for a partial day and left the
    // same false calm; both halves have to move together.
    const todayStart = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    const end = new Date(todayStart.getTime() - 86400000);
    const start = new Date(end.getTime() - DAYS * 86400000);
    // FDSN reads a date-only `endtime` as T00:00:00, so `endtime=<today>` excludes
    // today entirely. The day grid below is built from `new Date()` — now — so the
    // newest bucket was structurally always zero, and the 7-day sum was six real
    // days plus a guaranteed 0 compared against a true 7-day mean. Measured: 27
    // published where 36 was correct, a 25% understatement that never errored
    // because zero is a legal count. A window named 7 that held 6.
    const url =
      `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minmagnitude=4.5` +
      `&starttime=${iso(start)}&endtime=${iso(end)}T23:59:59` +
      `&minlatitude=${BBOX.minlat}&maxlatitude=${BBOX.maxlat}` +
      `&minlongitude=${BBOX.minlon}&maxlongitude=${BBOX.maxlon}`;
    const geo = await get(url);
    const feats = geo.features || [];
    const byDay = new Map();
    for (const f of feats) {
      const d = iso(new Date(f.properties.time));
      byDay.set(d, (byDay.get(d) || 0) + 1);
    }
    const series = [];
    for (let i = DAYS - 1; i >= 0; i--) {
      series.push(byDay.get(iso(new Date(end.getTime() - i * 86400000))) || 0);
    }
    // Every bucket is now a finished UTC day, so a 7-day sum means the same thing
    // at the end of the series as it does anywhere in its history.

    const strongest = feats.reduce((m, f) => Math.max(m, f.properties.mag || 0), 0);
    // Rolling 7-day sums, so the latest reading is comparable to its own history.
    const sums = [];
    for (let i = 6; i < series.length; i++) sums.push(series.slice(i - 6, i + 1).reduce((s, x) => s + x, 0));
    components.push({
      id: 'seismic_m45',
      label: `Gempa M4.5+ di kotak Indonesia, 7 hari terakhir`,
      source: 'USGS FDSN event query',
      latest: sums[sums.length - 1] ?? null,
      latestDate: iso(end),
      // The sample the z was actually computed from. Publishing the 90 raw days
      // here instead would overstate the evidence by about sevenfold, because
      // these windows overlap: 84 rolling sums are roughly 13 independent ones.
      n: sums.length,
      nIndependent: Math.floor(series.length / 7),
      rawDays: series.length,
      windowDays: DAYS,
      total: feats.length,
      strongestMag: strongest || null,
      baselineMean: sums.length > 1 ? Number(mean(sums.slice(0, -1)).toFixed(3)) : null,
      z: zLatest(sums),
    });
    log(`USGS: ${feats.length} gempa M4.5+ dalam ${DAYS} hari`);
  } catch (err) {
    unavailable.push({ id: 'seismic_m45', reason: `USGS: ${String(err.message).slice(0, 60)}` });
  }

  // ---- 3. Sanctions nexus, OFAC SDN
  try {
    const csv = await get('https://www.treasury.gov/ofac/downloads/sdn.csv', 'text');
    // sdn.csv ends with a lone 0x1A (EOF marker) that survives `.trim()` and would
    // be counted as a record. Harmless while `totalListed` is only descriptive,
    // wrong the moment anybody turns it into a denominator.
    const lines = csv.split('\n').filter((l) => l.replace(/\x1a/g, '').trim());
    const hits = lines.filter((l) => /indonesia/i.test(l));
    components.push({
      id: 'ofac_indonesia_nexus',
      label: 'Entitas SDN OFAC yang menyebut Indonesia',
      source: 'US Treasury OFAC SDN list (sdn.csv)',
      latest: hits.length,
      totalListed: lines.length,
      // A one-shot count has nothing to be a z-score against until this has run
      // on several days. Saying so is better than inventing a baseline.
      z: null,
      note: 'hitungan sesaat; belum punya riwayat untuk z-score, jadi tidak masuk komposit',
    });
    log(`OFAC: ${hits.length} baris menyebut Indonesia dari ${lines.length} entitas`);
  } catch (err) {
    unavailable.push({ id: 'ofac_indonesia_nexus', reason: `OFAC: ${String(err.message).slice(0, 60)}` });
  }

  // ---- inputs that were tried and could not be used. Named, not silently dropped.
  unavailable.push(
    { id: 'ucdp_ged', reason: 'UCDP kini mewajibkan header x-ucdp-access-token; token gratis tapi harus didaftarkan pemilik repo' },
    { id: 'imf_weo', reason: 'www.imf.org/external/datamapper menjawab 403 Access Denied dari host ini' },
    { id: 'worldbank', reason: 'api.worldbank.org menjawab 400 dengan halaman HTML dari host ini' },
    { id: 'reliefweb', reason: 'butuh appname yang disetujui ReliefWeb; permintaan tanpa itu dijawab 403' },
    { id: 'unhcr', reason: 'api.unhcr.org menjawab 200 tapi nol baris untuk coo=IDN maupun coa=IDN' }
  );

  const scored = components.filter((c) => c.z !== null);
  const composite = scored.length ? Number((mean(scored.map((c) => c.z)) * 10 + 50).toFixed(1)) : null;

  // How much of the score rides on one upstream. Two of three scored components
  // are GDELT-derived, so if that ingest dies the composite quietly becomes
  // seismic-only — and the `scored.length === 0` guard never fires, because the
  // survivor keeps its z. A number that changed meaning without changing shape is
  // this repo's whole failure catalogue, so the concentration is published rather
  // than left for a reader to work out.
  const bySource = {};
  for (const c of scored) bySource[c.source] = (bySource[c.source] || 0) + 1;
  const dominant = Object.entries(bySource).sort((a, b) => b[1] - a[1])[0] || null;

  const payload = {
    generatedAt: new Date().toISOString(),
    country: 'IDN',
    timezone: 'UTC — komponen GDELT memakai tanggal UTC, komponen seismik memakai hari UTC. Bukan WIB.',
    // Was a single top-level `windowDays: 90`, which described only the seismic
    // component: the two GDELT components carry twelve days, capped by what
    // gdelt.json has accumulated. One field answering two different questions is
    // exactly the shape that once killed chat in production, so the window now
    // lives per component and this field says what it actually governs.
    seismicWindowDays: DAYS,
    note:
      'Bacaan tekanan, BUKAN sinyal. Belum ada satu pun uji yang menunjukkan angka ' +
      'ini mendahului, mengikuti, atau menerangkan variabel pasar Indonesia mana pun. ' +
      'Komponen mentahnya diterbitkan di sebelah skornya supaya skornya bisa dibuang ' +
      'dan komponennya tetap terpakai.',
    method:
      'Tiap komponen di-z-score terhadap riwayatnya sendiri di jendela ini (arah ' +
      'diseragamkan: z lebih tinggi = tekanan lebih besar). Komposit = rata-rata z ' +
      'komponen yang punya z, dikali 10 lalu digeser 50, sehingga 50 = setara ' +
      'rata-rata jendela dan tiap 10 poin = satu simpangan baku. Komponen tanpa ' +
      'riwayat tidak ikut dihitung dan disebutkan sebagai tidak ikut.',
    componentsUsed: scored.length,
    componentsTotal: components.length,
    sourceConcentration: bySource,
    dominantSource: dominant ? dominant[0] : null,
    dominantSourceShare: dominant && scored.length ? Number((dominant[1] / scored.length).toFixed(2)) : null,
    composite,
    components,
    unavailable,
  };

  const file = join(OUT_DIR, 'risk.json');
  await writeFile(file, JSON.stringify(payload));
  const { size } = await stat(file);
  log(
    `wrote risk.json (${(size / 1024).toFixed(1)} KB) — komposit ${composite ?? 'n/a'} dari ${scored.length}/${components.length} komponen, ${unavailable.length} input tidak tersedia`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
