/**
 * ingest-macro.mjs — the world outside IDX, on the same daily grid.
 *
 *   node scripts/ingest-macro.mjs [--range 2y]
 *
 * WHY THIS EXISTS. Every screen in this app so far answers a question that ends
 * at the Jakarta border: which emiten moved, which group rotated, who is on the
 * register. But an Indonesian coal miner is a bet on the coal price, a USD
 * reporter is a bet on the rupiah, and foreign flow into IDX is a bet on the US
 * ten-year. Those drivers were never in the database, so the app could describe
 * a move without ever reaching its cause.
 *
 * This pulls them, on the SAME daily grid as the IDX history, so a correlation
 * between the two is arithmetic rather than assertion. src/models/macroLinkage.ts
 * does that measuring; this file only fetches and stores.
 *
 * TRANSPORT. Yahoo's chart endpoint, which needs no crumb — unlike the v7 quote
 * endpoint used by ingest-quotes and ingest-intraday. Yahoo does not fingerprint
 * TLS the way idx.co.id does, so plain curl is enough and no cookie jar is kept.
 *
 * WHAT IS DELIBERATELY MISSING, AND WHY IT MATTERS. The two commodities that
 * matter most to this exchange are not here: CPO (crude palm oil) and nickel.
 * Yahoo delisted both contracts (FCPO=F, NI=F answer "symbol may be delisted").
 * Indonesia is the world's largest producer of both. Substituting a lookalike —
 * a palm-adjacent equity, an aluminium contract — would produce a correlation
 * that reads as evidence and is not, so nothing is substituted. `absent` in the
 * output names them and the UI prints it.
 *
 * Writes public/data/idx/macro.json
 */
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { UA, mapPool } from './idx-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'data', 'idx');

const argv = process.argv.slice(2);
const argVal = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const RANGE = argVal('--range', '2y');
const CONCURRENCY = Number(argVal('--concurrency', 4));

const log = (...a) => console.log(`[macro ${new Date().toISOString().slice(11, 19)}]`, ...a);

/**
 * The instrument list.
 *
 * `linksTo` is the editorial half and is labelled as such everywhere it
 * surfaces: it says which IDX sectors this instrument is *expected* to drive,
 * written from how the businesses actually earn. It is a hypothesis, never the
 * finding — macroLinkage measures the real correlation and the UI shows the
 * measurement next to the expectation precisely so the two can disagree. A
 * driver that everyone "knows" matters and measures at 0.05 is worth more than
 * one nobody questioned.
 */
const INSTRUMENTS = [
  // --- currency ------------------------------------------------------------
  { id: 'usdidr', symbol: 'IDR=X', name: 'USD/IDR', klass: 'kurs', unit: 'Rp',
    why: 'Kurs rupiah. Emiten pelapor USD untung saat rupiah melemah; importir dan pemegang utang dolar rugi.',
    linksTo: ['Energy', 'Basic Materials', 'Consumer Non-Cyclicals'] , after: true },
  { id: 'dxy', symbol: 'DX-Y.NYB', name: 'Dollar Index (DXY)', klass: 'kurs', unit: 'idx',
    why: 'Kekuatan dolar terhadap sekeranjang mata uang. Naiknya DXY biasanya menarik dana keluar dari pasar berkembang.',
    linksTo: ['Financials'] , after: true },
  { id: 'usdcny', symbol: 'CNY=X', name: 'USD/CNY', klass: 'kurs', unit: 'CNY',
    why: 'Yuan. Tiongkok pembeli terbesar batu bara dan bijih nikel Indonesia.',
    linksTo: ['Basic Materials', 'Energy'] , after: true },
  { id: 'usdjpy', symbol: 'JPY=X', name: 'USD/JPY', klass: 'kurs', unit: 'JPY' ,
    why: 'Yen. Pendanaan carry trade global sering berpangkal di sini.',
    linksTo: [] , after: true },
  { id: 'eurusd', symbol: 'EURUSD=X', name: 'EUR/USD', klass: 'kurs', unit: 'USD',
    why: 'Euro terhadap dolar, sisi lain dari DXY.',
    linksTo: [] , after: true },
  { id: 'usdsgd', symbol: 'SGD=X', name: 'USD/SGD', klass: 'kurs', unit: 'SGD',
    why: 'Dolar Singapura. Banyak arus dana regional masuk IDX lewat Singapura.',
    linksTo: ['Financials'] , after: true },

  // --- energy --------------------------------------------------------------
  { id: 'coal_api2', symbol: 'MTF=F', name: 'Batu Bara API2 (ARA)', klass: 'energi', unit: 'USD/t',
    why: 'Acuan batu bara termal Eropa. Bukan acuan Newcastle yang dipakai kontrak Indonesia, tetapi arah keduanya bergerak bersama.',
    linksTo: ['Energy'] , after: true },
  { id: 'wti', symbol: 'CL=F', name: 'Minyak WTI', klass: 'energi', unit: 'USD/bbl',
    why: 'Minyak mentah Amerika.',
    linksTo: ['Energy'] , after: true },
  { id: 'brent', symbol: 'BZ=F', name: 'Minyak Brent', klass: 'energi', unit: 'USD/bbl',
    why: 'Acuan minyak yang lebih dekat ke harga ekspor Asia.',
    linksTo: ['Energy'] , after: true },
  { id: 'natgas', symbol: 'NG=F', name: 'Gas Alam', klass: 'energi', unit: 'USD/MMBtu',
    why: 'Gas alam Henry Hub.',
    linksTo: ['Energy'] , after: true },

  // --- metals --------------------------------------------------------------
  { id: 'gold', symbol: 'GC=F', name: 'Emas', klass: 'logam', unit: 'USD/oz',
    why: 'Emas. Penggerak langsung emiten tambang emas dan tempat parkir saat pasar takut.',
    linksTo: ['Basic Materials'] , after: true },
  { id: 'silver', symbol: 'SI=F', name: 'Perak', klass: 'logam', unit: 'USD/oz',
    why: 'Perak, separuh logam mulia separuh logam industri.',
    linksTo: ['Basic Materials'] , after: true },
  { id: 'copper', symbol: 'HG=F', name: 'Tembaga', klass: 'logam', unit: 'USD/lb',
    why: 'Tembaga, ukuran denyut industri global.',
    linksTo: ['Basic Materials', 'Industrials'] , after: true },
  { id: 'aluminium', symbol: 'ALI=F', name: 'Aluminium', klass: 'logam', unit: 'USD/t',
    why: 'Aluminium, terkait bauksit dan smelter.',
    linksTo: ['Basic Materials'] , after: true },
  { id: 'iron_ore', symbol: 'TIO=F', name: 'Bijih Besi 62% CFR', klass: 'logam', unit: 'USD/t',
    why: 'Bijih besi ke Tiongkok, pembacaan langsung permintaan baja.',
    linksTo: ['Basic Materials'] , after: true },

  // --- global equity -------------------------------------------------------
  { id: 'spx', symbol: '^GSPC', name: 'S&P 500', klass: 'indeks-global', unit: 'idx',
    why: 'Selera risiko global. IHSG jarang melawan arah S&P berhari-hari.',
    linksTo: [] , after: true },
  { id: 'ndx', symbol: '^IXIC', name: 'Nasdaq Composite', klass: 'indeks-global', unit: 'idx',
    why: 'Sisi teknologi dari selera risiko yang sama.',
    linksTo: ['Technology'] , after: true },
  { id: 'nikkei', symbol: '^N225', name: 'Nikkei 225', klass: 'indeks-global', unit: 'idx',
    why: 'Jepang, sesi perdagangan yang tumpang tindih dengan Jakarta.',
    linksTo: [] , after: false },
  { id: 'hsi', symbol: '^HSI', name: 'Hang Seng', klass: 'indeks-global', unit: 'idx',
    why: 'Hong Kong, pintu masuk sentimen Tiongkok.',
    linksTo: ['Basic Materials', 'Energy'] , after: false },
  { id: 'sti', symbol: '^STI', name: 'Straits Times (Singapura)', klass: 'indeks-global', unit: 'idx',
    why: 'Singapura, tetangga terdekat dan jalur dana regional.',
    linksTo: ['Financials'] , after: false },
  { id: 'klci', symbol: '^KLSE', name: 'FTSE KLCI (Malaysia)', klass: 'indeks-global', unit: 'idx',
    why: 'Malaysia, ekonomi paling mirip struktur ekspornya dengan Indonesia.',
    linksTo: [] , after: false },
  { id: 'kospi', symbol: '^KS11', name: 'KOSPI (Korea)', klass: 'indeks-global', unit: 'idx',
    why: 'Korea, pasar berkembang Asia yang dipegang investor asing yang sama.',
    linksTo: [] , after: false },
  { id: 'asx', symbol: '^AXJO', name: 'ASX 200 (Australia)', klass: 'indeks-global', unit: 'idx',
    why: 'Australia, sesama eksportir komoditas.',
    linksTo: ['Energy', 'Basic Materials'] , after: false },
  { id: 'sse', symbol: '000001.SS', name: 'Shanghai Composite', klass: 'indeks-global', unit: 'idx',
    why: 'Tiongkok daratan, tujuan akhir sebagian besar ekspor komoditas Indonesia.',
    linksTo: ['Basic Materials', 'Energy'] , after: false },

  // --- rates and fear ------------------------------------------------------
  { id: 'ust10y', symbol: '^TNX', name: 'US Treasury 10 Tahun', klass: 'suku-bunga', unit: '%',
    why: 'Imbal hasil bebas risiko dunia. Naiknya angka ini menaikkan diskonto tiap DCF dan menarik dana keluar dari pasar berkembang.',
    linksTo: ['Financials', 'Properties & Real Estate'] , after: true },
  { id: 'ust5y', symbol: '^FVX', name: 'US Treasury 5 Tahun', klass: 'suku-bunga', unit: '%',
    why: 'Tenor menengah, lebih dekat ke ekspektasi kebijakan.',
    linksTo: ['Financials'] , after: true },
  { id: 'vix', symbol: '^VIX', name: 'VIX', klass: 'suku-bunga', unit: 'idx',
    why: 'Ukuran ketakutan pasar Amerika. Lonjakannya biasanya bersamaan dengan asing net jual di Jakarta.',
    linksTo: [] , after: true },

  // --- crypto --------------------------------------------------------------
  { id: 'btc', symbol: 'BTC-USD', name: 'Bitcoin', klass: 'kripto', unit: 'USD',
    why: 'Aset risiko paling murni. Berguna sebagai pembanding selera risiko ritel.',
    linksTo: ['Technology'] , after: true },
  { id: 'eth', symbol: 'ETH-USD', name: 'Ethereum', klass: 'kripto', unit: 'USD',
    why: 'Kripto besar kedua, arahnya hampir selalu mengikuti Bitcoin.',
    linksTo: [] , after: true },
];

/** Commodities that drive this exchange but have no public daily series. */
const ABSENT = [
  { name: 'CPO / minyak sawit', why: 'Kontrak FCPO Bursa Malaysia tidak lagi punya seri harian publik di Yahoo (jawabannya "symbol may be delisted"). Padahal sawit adalah komoditas ekspor terbesar Indonesia.' },
  { name: 'Nikel', why: 'Kontrak nikel LME tidak tersedia publik di Yahoo. Indonesia produsen nikel terbesar dunia, jadi ini lubang yang nyata.' },
  { name: 'Batu bara Newcastle', why: 'Acuan yang benar-benar dipakai kontrak ekspor Indonesia. Yang tersedia hanya API2 (Eropa), yang arahnya searah tetapi bukan harga yang sama.' },
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
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=${encodeURIComponent(RANGE)}&interval=1d`;
  const text = await curl(['-s', '-m', '40', '-A', UA, url]);
  const result = JSON.parse(text).chart?.result?.[0];
  if (!result) return null;
  const ts = result.timestamp || [];
  const close = result.indicators?.quote?.[0]?.close || [];
  const byDate = new Map();
  ts.forEach((t, i) => {
    const v = close[i];
    if (!Number.isFinite(v)) return;
    // UTC date is the right key: every instrument is stamped the same way, and
    // the IDX history uses calendar dates too. A timezone shift here would
    // offset half the instruments by one session and quietly weaken every
    // correlation computed downstream.
    byDate.set(new Date(t * 1000).toISOString().slice(0, 10), v);
  });
  return { byDate, currency: result.meta?.currency || '', shortName: result.meta?.shortName || symbol };
}

async function main() {
  // The IDX session dates are the grid everything is aligned to. Without them a
  // macro series would carry its own weekends and holidays and every join
  // downstream would have to guess.
  const history = JSON.parse(await readFile(join(OUT_DIR, 'history.json'), 'utf8'));
  const sessions = history.dates;
  log(`grid IDX: ${sessions.length} sesi, ${sessions[0]} → ${sessions[sessions.length - 1]}`);

  const fetched = await mapPool(INSTRUMENTS, CONCURRENCY, async (inst) => {
    try {
      const s = await fetchSeries(inst.symbol);
      if (!s) return { inst, ok: false, why: 'tidak ada seri' };
      return { inst, ok: true, s };
    } catch (err) {
      return { inst, ok: false, why: err.message.slice(0, 80) };
    }
  });

  const series = [];
  const failed = [];
  for (const f of fetched) {
    if (!f.ok) {
      failed.push({ id: f.inst.id, symbol: f.inst.symbol, why: f.why });
      log(`  GAGAL ${f.inst.symbol}: ${f.why}`);
      continue;
    }
    // Forward-fill onto the IDX grid: a Jakarta session with a US holiday still
    // needs a value, and carrying the last print is what a trader would read.
    // `covered` counts the sessions with a genuine observation, so the UI can
    // say how thin a series really is instead of implying full coverage.
    const closes = [];
    let last = null;
    let covered = 0;
    for (const d of sessions) {
      const v = f.s.byDate.get(d);
      if (Number.isFinite(v)) {
        last = v;
        covered++;
      }
      closes.push(last);
    }
    const firstIdx = closes.findIndex((v) => v !== null);
    series.push({
      id: f.inst.id,
      symbol: f.inst.symbol,
      name: f.inst.name,
      klass: f.inst.klass,
      unit: f.inst.unit,
      why: f.inst.why,
      linksTo: f.inst.linksTo,
      after: f.inst.after,
      currency: f.s.currency,
      covered,
      coverage: sessions.length ? covered / sessions.length : 0,
      firstSession: firstIdx >= 0 ? sessions[firstIdx] : null,
      // Comma-joined like the IDX series files, for the same reason: it is a
      // third the size of a JSON number array and parses just as fast.
      c: closes.map((v) => (v === null ? '' : Number(v.toPrecision(8)))).join(','),
    });
    log(`  ${f.inst.symbol.padEnd(11)} ${String(covered).padStart(4)}/${sessions.length} sesi  ${f.inst.name}`);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    range: RANGE,
    sessions: sessions.length,
    // The grid this file was aligned to, stored so readers can re-align by DATE
    // instead of by position. history.json grows every session; a positional
    // join between two files that update on different schedules silently shifts
    // every series by one the moment they disagree on length, and the symptom is
    // a NaN in the last slot rather than an error.
    dates: sessions,
    from: sessions[0],
    to: sessions[sessions.length - 1],
    source: 'Yahoo Finance chart API (v8), disejajarkan ke tanggal sesi IDX',
    scope:
      'Harga penutupan harian aset di luar IDX, diselaraskan ke grid sesi bursa Indonesia supaya korelasinya bisa dihitung, bukan dikira-kira. Nilai pada hari libur pasar asal dibawa dari penutupan terakhir.',
    absent: ABSENT,
    failed,
    instruments: series,
  };

  await mkdir(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, 'macro.json');
  await writeFile(file, JSON.stringify(payload));
  const { size } = await stat(file);
  log(
    `wrote macro.json — ${series.length} instrumen dari ${INSTRUMENTS.length} (${failed.length} gagal), ${(size / 1024).toFixed(0)} KB`
  );

  // A macro file with half its instruments missing is worse than none: the
  // linkage screen would rank three survivors and look authoritative.
  if (series.length < INSTRUMENTS.length * 0.7) {
    throw new Error(`hanya ${series.length}/${INSTRUMENTS.length} instrumen terambil — terlalu banyak yang gagal untuk dipercaya`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
