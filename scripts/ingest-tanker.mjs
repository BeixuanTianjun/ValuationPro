/**
 * ingest-tanker.mjs — the tanker market, as far as free data honestly reaches.
 *
 *   node scripts/ingest-tanker.mjs [--range 2y]
 *
 * ── WHAT WAS ASKED FOR, AND WHAT IS ACTUALLY POSSIBLE ─────────────────────
 *
 * The request was to track a specific issuer's ships — where BULL's vessels
 * are sailing right now — and to report their charter rates. Neither is
 * obtainable from free public data, and pretending otherwise would be the
 * worst outcome, so this file states the wall plainly:
 *
 *   VESSEL POSITIONS. Live positions come from AIS. Every usable AIS feed
 *   (MarineTraffic, VesselFinder, Spire, aisstream) is a paid subscription or
 *   an API key behind a signup, and their terms forbid scraping the web view.
 *   There is no free endpoint that returns "the ships owned by issuer X and
 *   where they are". Nothing here invents one.
 *
 *   CHARTER RATES. What a specific ship earns on a specific voyage is
 *   commercially confidential. The market-level benchmarks — Baltic Dirty
 *   Tanker Index, Clarksons rates — are published by brokers and licensed;
 *   ^BDIY is not on any free quote API (checked: Yahoo returns Not Found).
 *
 * ── WHAT THIS BUILDS INSTEAD, AND WHY IT IS NOT A CONSOLATION PRIZE ───────
 *
 * Listed tanker owners are, in effect, a traded claim on charter rates. FRO,
 * DHT, TNK, INSW own crude and product tankers and re-charter them constantly;
 * when spot rates move, their equity moves, and it moves in public, daily, for
 * free. STNG is the product-tanker read and BDRY the dry-bulk contrast — if
 * BDRY moves and the tanker names do not, the story is dry bulk, not oil.
 *
 * So the panel measures the tanker-rate PROXY, and says it is a proxy. Then it
 * regresses the Indonesian shipping issuers against that basket, which answers
 * the question underneath the original one: when tanker economics improve, does
 * BULL actually follow — and by how much. That is a measurable claim. "BULL's
 * ship is near Singapore" is not, from here.
 *
 * WHY THE INDONESIAN NAMES ARE HAND-PICKED. IDX-IC files most of these under
 * "Distribusi Batu Bara" or "Logistik & Pengantaran", which lumps coal barges
 * in with oil tankers. A barge operator's economics track coal haulage, not
 * crude freight, so mixing them would blur the very correlation this file
 * exists to measure. The list below is curated by what the vessels actually
 * carry, and each entry says which.
 *
 * Writes public/data/idx/tanker.json
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'data', 'idx');

const argv = process.argv.slice(2);
const argVal = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const RANGE = argVal('--range', '2y');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const log = (...a) => console.log(`[tanker ${new Date().toISOString().slice(11, 19)}]`, ...a);

/** Listed proxies for tanker freight economics. */
const PROXIES = [
  { id: 'fro', symbol: 'FRO', name: 'Frontline', kind: 'crude', why: 'Armada VLCC/Suezmax terbesar yang tercatat — paling dekat ke tarif crude spot.' },
  { id: 'dht', symbol: 'DHT', name: 'DHT Holdings', kind: 'crude', why: 'Murni VLCC. Nyaris tanpa bisnis lain, jadi harganya hampir seluruhnya soal tarif.' },
  { id: 'tnk', symbol: 'TNK', name: 'Teekay Tankers', kind: 'crude', why: 'Aframax/Suezmax, eksposur spot tinggi.' },
  { id: 'insw', symbol: 'INSW', name: 'International Seaways', kind: 'campuran', why: 'Crude dan produk sekaligus.' },
  { id: 'stng', symbol: 'STNG', name: 'Scorpio Tankers', kind: 'produk', why: 'Tanker produk — BBM jadi, rute berbeda dari crude.' },
  { id: 'bdry', symbol: 'BDRY', name: 'Breakwave Dry Bulk ETF', kind: 'kontras', why: 'Freight kering, bukan tanker. Dipakai sebagai pembanding: kalau ini gerak sendirian, ceritanya batu bara/biji besi, bukan minyak.' },
];

/**
 * Indonesian listed shipping, grouped by what the vessels actually carry.
 * `cargo` decides which proxy the correlation should be read against.
 */
const IDX_SHIPPING = [
  { code: 'BULL', cargo: 'minyak', note: 'Tanker minyak & gas, armada terbesar di antara emiten pelayaran IDX.' },
  { code: 'HITS', cargo: 'minyak', note: 'Humpuss Intermoda — tanker minyak dan LNG.' },
  { code: 'HUMI', cargo: 'minyak', note: 'Humpuss Maritim — tanker dan jasa maritim.' },
  { code: 'SHIP', cargo: 'minyak', note: 'Sillo Maritime — tanker dan offshore migas.' },
  { code: 'SOCI', cargo: 'minyak', note: 'Soechi Lines — tanker minyak dan galangan.' },
  { code: 'BLTA', cargo: 'minyak', note: 'Berlian Laju Tanker.' },
  { code: 'TPMA', cargo: 'batu bara', note: 'Tongkang batu bara — ekonominya ikut angkutan batu bara, bukan tarif crude.' },
  { code: 'MBSS', cargo: 'batu bara', note: 'Tongkang dan floating crane batu bara.' },
  { code: 'TCPI', cargo: 'batu bara', note: 'Transcoal Pacific — angkutan batu bara.' },
  { code: 'BESS', cargo: 'batu bara', note: 'Batulicin — tongkang batu bara.' },
  { code: 'SMDR', cargo: 'peti kemas', note: 'Samudera Indonesia — kontainer dan logistik, bukan tanker.' },
  { code: 'WINS', cargo: 'offshore', note: 'Wintermar — kapal penunjang lepas pantai migas.' },
];

function curl(args) {
  return new Promise((resolve, reject) => {
    execFile('curl', args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

async function fetchSeries(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${RANGE}&interval=1d`;
  const text = await curl(['-s', '-m', '40', '-A', UA, url]);
  const j = JSON.parse(text);
  const r = j?.chart?.result?.[0];
  if (!r) throw new Error(j?.chart?.error?.description || 'tidak ada hasil');
  const stamps = r.timestamp || [];
  const closes = r.indicators?.quote?.[0]?.close || [];
  const out = [];
  for (let i = 0; i < stamps.length; i++) {
    const c = closes[i];
    if (c === null || c === undefined || !Number.isFinite(c)) continue;
    out.push({ date: new Date(stamps[i] * 1000).toISOString().slice(0, 10), close: c });
  }
  if (!out.length) throw new Error('deret kosong');
  return { out, currency: r.meta?.currency || 'USD' };
}

const pctBack = (rows, back) => {
  if (rows.length <= back) return null;
  const now = rows[rows.length - 1].close;
  const then = rows[rows.length - 1 - back].close;
  return then > 0 ? now / then - 1 : null;
};

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const failed = [];
  const instruments = [];

  for (const p of PROXIES) {
    try {
      const { out, currency } = await fetchSeries(p.symbol);
      instruments.push({
        ...p,
        currency,
        last: out[out.length - 1].close,
        asOf: out[out.length - 1].date,
        change1d: pctBack(out, 1),
        change1w: pctBack(out, 5),
        change1m: pctBack(out, 21),
        change3m: pctBack(out, 63),
        change12m: pctBack(out, 252),
        // Stored on the instrument's own trading calendar; the browser projects
        // it onto IDX sessions by date, the same way macroLinkage.ts does — an
        // index-position join would silently misalign every holiday.
        dates: out.map((r) => r.date).join(','),
        closes: out.map((r) => Number(r.close.toFixed(4))).join(','),
      });
      log(`${p.symbol}: ${out.length} sesi, terakhir ${out[out.length - 1].close}`);
    } catch (err) {
      log(`!! ${p.symbol} gagal: ${err.message}`);
      failed.push({ id: p.id, symbol: p.symbol, why: err.message.slice(0, 140) });
    }
  }

  if (!instruments.length) throw new Error('tidak ada satupun proksi tanker yang berhasil ditarik');

  const payload = {
    generatedAt: new Date().toISOString(),
    range: RANGE,
    source:
      'Yahoo Finance (harga penutupan harian) untuk pemilik tanker tercatat; volume transit tanker dari IMF PortWatch lewat worldmap.json.',
    scope:
      'Tarif charter sesungguhnya tidak ada di sini. Posisi kapal per unit (AIS) dan tarif charter per pelayaran adalah data berbayar — MarineTraffic/VesselFinder untuk posisi, Baltic Exchange/Clarksons untuk tarif — dan tidak boleh diambil otomatis. Yang diukur di sini adalah harga saham pemilik tanker tercatat sebagai PROKSI tarif, dan hubungannya ke emiten pelayaran IDX dihitung terbuka lengkap dengan ukuran sampelnya.',
    absent: [
      {
        name: 'Posisi kapal per unit (AIS)',
        why: 'Butuh langganan MarineTraffic/VesselFinder/Spire atau kunci API aisstream. Tidak ada endpoint gratis yang mengembalikan daftar kapal milik satu emiten beserta posisinya.',
      },
      {
        name: 'Baltic Dirty Tanker Index (BDTI)',
        why: 'Diterbitkan Baltic Exchange dengan lisensi berbayar. Tidak tersedia di API kuotasi gratis mana pun — ^BDIY mengembalikan Not Found.',
      },
      {
        name: 'Tarif charter per pelayaran',
        why: 'Rahasia dagang antara pemilik kapal dan penyewa; hanya broker yang menerbitkan agregatnya, di balik paywall.',
      },
    ],
    failed,
    instruments,
    idxShipping: IDX_SHIPPING,
  };

  await writeFile(join(OUT_DIR, 'tanker.json'), JSON.stringify(payload));
  log(`ditulis tanker.json — ${instruments.length} proksi, ${IDX_SHIPPING.length} emiten pelayaran dikurasi`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
