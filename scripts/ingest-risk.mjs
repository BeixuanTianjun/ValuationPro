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
    // Only days with enough events to make a share meaningful. A day with four
    // events can read 100% conflict and mean nothing.
    const days = (g.days || []).filter((d) => d.events >= 30);
    const shares = days.map((d) => d.conflict / Math.max(1, d.conflict + d.cooperation));
    const tones = days.map((d) => d.avgTone).filter((x) => x !== null);
    if (shares.length >= 8) {
      components.push({
        id: 'gdelt_conflict_share',
        label: 'Pangsa peristiwa konflik (GDELT quad 3-4)',
        source: 'GDELT 2.0 Events via data.gdeltproject.org',
        latest: Number(shares[shares.length - 1].toFixed(4)),
        windowMean: Number(mean(shares).toFixed(4)),
        n: shares.length,
        z: zLatest(shares),
      });
    } else {
      unavailable.push({
        id: 'gdelt_conflict_share',
        reason: `hanya ${shares.length} hari dengan >=30 peristiwa; butuh 8 untuk z-score`,
      });
    }
    if (tones.length >= 8) {
      components.push({
        id: 'gdelt_tone',
        label: 'Nada rata-rata pemberitaan (negatif = memburuk)',
        source: 'GDELT 2.0 Events via data.gdeltproject.org',
        latest: tones[tones.length - 1],
        windowMean: Number(mean(tones).toFixed(3)),
        n: tones.length,
        // Tone is negative-is-worse, so the sign is flipped to keep every
        // component pointing the same way: higher z = more stress.
        z: (() => {
          const z = zLatest(tones);
          return z === null ? null : Number((-z).toFixed(3));
        })(),
      });
    } else {
      unavailable.push({ id: 'gdelt_tone', reason: `hanya ${tones.length} hari bernada terukur` });
    }
  } catch (err) {
    unavailable.push({
      id: 'gdelt',
      reason: `gdelt.json tidak terbaca (${String(err.message).slice(0, 60)}) — jalankan npm run data:gdelt dulu`,
    });
  }

  // ---- 2. Seismicity, USGS
  try {
    const end = new Date();
    const start = new Date(end.getTime() - DAYS * 86400000);
    const url =
      `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minmagnitude=4.5` +
      `&starttime=${iso(start)}&endtime=${iso(end)}` +
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
    const strongest = feats.reduce((m, f) => Math.max(m, f.properties.mag || 0), 0);
    components.push({
      id: 'seismic_m45',
      label: `Gempa M4.5+ di kotak Indonesia, ${DAYS} hari`,
      source: 'USGS FDSN event query',
      latest: series.slice(-7).reduce((s, x) => s + x, 0),
      windowMean: Number((mean(series) * 7).toFixed(2)),
      n: series.length,
      total: feats.length,
      strongestMag: strongest || null,
      z: (() => {
        // Rolling 7-day sums, so the latest reading is comparable to its history.
        const sums = [];
        for (let i = 6; i < series.length; i++) sums.push(series.slice(i - 6, i + 1).reduce((s, x) => s + x, 0));
        return zLatest(sums);
      })(),
    });
    log(`USGS: ${feats.length} gempa M4.5+ dalam ${DAYS} hari`);
  } catch (err) {
    unavailable.push({ id: 'seismic_m45', reason: `USGS: ${String(err.message).slice(0, 60)}` });
  }

  // ---- 3. Sanctions nexus, OFAC SDN
  try {
    const csv = await get('https://www.treasury.gov/ofac/downloads/sdn.csv', 'text');
    const lines = csv.split('\n').filter((l) => l.trim());
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

  const payload = {
    generatedAt: new Date().toISOString(),
    country: 'IDN',
    windowDays: DAYS,
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
