// Kalibrasi laporan keuangan menjadi asumsi model.
// Jalankan dengan: npm run test
//
// KENAPA ADA. statementCalibrator.ts adalah pintu masuk dari laporan keuangan
// ke DCF dan LBO: apa pun yang keluar dari sini menjadi asumsi yang dipakai
// menghitung harga wajar. Ia 151 baris tanpa tes, dan kesalahannya berbentuk
// sama seperti sisa repo ini — sebuah CAGR yang dihitung atas jumlah periode
// yang salah tetap terlihat seperti persentase yang wajar.

import type { HistoricalYearData, ParsedFinancialReport } from '../../types/statements';
import { calibrateFinancialReport } from '../statementCalibrator';

const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') =>
  results.push({ name, ok, detail: ok ? '' : detail });
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;

const tahun = (over: Partial<HistoricalYearData>): HistoricalYearData =>
  ({
    year: '2024', revenue: 1000, grossProfit: 400, ebitda: 250, ebit: 180,
    netIncome: 120, capex: 40, da: 60, nwc: 80, cash: 150, totalDebt: 400,
    grossMargin: 0.4, ebitdaMargin: 0.25, ebitMargin: 0.18,
    capexPercent: 0.04, daPercent: 0.06, nwcPercent: 0.08,
    ...over,
  }) as HistoricalYearData;

const laporan = (data: HistoricalYearData[], over: Partial<ParsedFinancialReport> = {}): ParsedFinancialReport => ({
  companyName: 'Uji Tbk',
  currency: 'Rp ',
  units: 'billions',
  years: data.map((d) => d.year),
  historicalData: data,
  sharesOutstanding: 10,
  currentSharePrice: 1000,
  taxRate: 0.22,
  ...over,
});

// 1. CAGR dihitung atas n-1 PERIODE, bukan n tahun. Lima baris data adalah
//    empat periode pertumbuhan, dan membaginya dengan lima memberi angka yang
//    terlalu kecil secara konsisten — kesalahan yang tidak akan pernah tampak
//    ganjil karena hasilnya tetap persentase yang masuk akal.
{
  // 1000 -> 1464,1 dalam empat periode adalah tepat 10% per tahun.
  const data = [1000, 1100, 1210, 1331, 1464.1].map((revenue, i) =>
    tahun({ year: String(2020 + i), revenue }),
  );
  const c = calibrateFinancialReport(laporan(data));
  check('CAGR memakai n-1 periode', near(c.revenueCagr, 0.1, 1e-9), `${c.revenueCagr}`);
}

// 2. CAGR dijepit ke [-5%, +35%]. Batas ini yang sebenarnya ada di kode —
//    komentarnya sempat menyebut -10% sampai +40%, dan angka di komentar yang
//    tidak sama dengan angka di kode adalah cara sebuah asumsi diwarisi salah.
{
  const meledak = [100, 1000].map((revenue, i) => tahun({ year: String(2023 + i), revenue }));
  const c = calibrateFinancialReport(laporan(meledak));
  check('CAGR di atas batas dijepit ke 0,35', near(c.revenueCagr, 0.35), `${c.revenueCagr}`);

  const jatuh = [1000, 100].map((revenue, i) => tahun({ year: String(2023 + i), revenue }));
  const d = calibrateFinancialReport(laporan(jatuh));
  check('CAGR di bawah batas dijepit ke -0,05', near(d.revenueCagr, -0.05), `${d.revenueCagr}`);
}

// 3. Basis diambil dari tahun TERAKHIR, bukan tahun pertama. Memakai yang
//    pertama akan memproyeksikan pertumbuhan dari titik yang sudah dilewati.
{
  const data = [
    tahun({ year: '2023', revenue: 1000, ebitda: 200, cash: 50, totalDebt: 300 }),
    tahun({ year: '2024', revenue: 1500, ebitda: 400, cash: 90, totalDebt: 250 }),
  ];
  const c = calibrateFinancialReport(laporan(data));
  check('baseRevenue dari tahun terakhir', c.baseRevenue === 1500, `${c.baseRevenue}`);
  check('baseEbitda dari tahun terakhir', c.baseEbitda === 400, `${c.baseEbitda}`);
  check('baseCash dari tahun terakhir', c.baseCash === 90, `${c.baseCash}`);
  check('baseDebt dari tahun terakhir', c.baseDebt === 250, `${c.baseDebt}`);
}

// 4. Proyeksi pertumbuhan MELANDAI. Perusahaan yang tumbuh 30% tidak tumbuh 30%
//    selamanya, dan proyeksi datar adalah cara paling umum sebuah DCF
//    menghasilkan harga wajar yang tidak masuk akal.
{
  const data = [1000, 1300].map((revenue, i) => tahun({ year: String(2023 + i), revenue }));
  const c = calibrateFinancialReport(laporan(data));
  const g = c.forecastGrowthRates;
  check('proyeksi pertumbuhan lima tahun', g.length === 5, `${g.length}`);
  check('pertumbuhan menurun tiap tahun',
    g.every((v, i) => i === 0 || v <= g[i - 1] + 1e-12), g.map((v) => v.toFixed(4)).join(' > '));
  check('tahun pertama sama dengan CAGR', near(g[0], c.revenueCagr), `${g[0]} vs ${c.revenueCagr}`);
}

// 5. Marjin dijepit ke pita yang masuk akal. Marjin EBITDA 95% dari satu tahun
//    ganjil akan menghasilkan valuasi yang seluruhnya berdiri di atas kesalahan
//    ketik.
{
  const data = [tahun({ ebitdaMargin: 0.95, grossMargin: 0.99, capexPercent: 0.9 })];
  const c = calibrateFinancialReport(laporan(data));
  check('marjin EBITDA dijepit ke maksimum 0,8', c.forecastEbitdaMargins[0] <= 0.8,
    `${c.forecastEbitdaMargins[0]}`);
  check('marjin kotor dijepit ke maksimum 0,95', c.forecastGrossMargins[0] <= 0.95,
    `${c.forecastGrossMargins[0]}`);
  check('capex dijepit ke maksimum 0,25', c.forecastCapexPercents[0] <= 0.25,
    `${c.forecastCapexPercents[0]}`);
}

// 6. Laporan kosong memberi default, bukan lemparan atau NaN. Pengguna yang
//    mengunggah PDF yang gagal diurai harus melihat model default, bukan layar
//    penuh strip.
{
  let lempar = false;
  try {
    const c = calibrateFinancialReport(laporan([]));
    check('laporan kosong tetap memberi lima titik proyeksi',
      c.forecastGrowthRates.length === 5 && c.forecastEbitdaMargins.length === 5);
    check('laporan kosong tidak menghasilkan NaN',
      [c.revenueCagr, c.baseRevenue, c.baseEbitda, c.avgEbitdaMargin].every(Number.isFinite),
      `${c.revenueCagr} ${c.baseRevenue}`);
    check('nama dan mata uang tetap dibawa dari laporannya',
      c.companyName === 'Uji Tbk' && c.currency === 'Rp ');
  } catch {
    lempar = true;
  }
  check('laporan kosong tidak melempar', !lempar);
}

// 7. Tarif pajak nol jatuh ke 22%, bukan dipakai apa adanya. Pajak nol membuat
//    tiap arus kas bebas terlalu besar, dan hasilnya harga wajar yang terlalu
//    tinggi secara sistematis.
{
  const c = calibrateFinancialReport(laporan([tahun({})], { taxRate: 0 }));
  check('tarif pajak nol jatuh ke 0,22', near(c.taxRate, 0.22), `${c.taxRate}`);

  const d = calibrateFinancialReport(laporan([tahun({})], { taxRate: 0.11 }));
  check('tarif pajak yang diisi dipakai apa adanya', near(d.taxRate, 0.11), `${d.taxRate}`);
}

// 8. Marjin yang tidak ada di data memakai default, bukan nol. Nol akan
//    terbaca sebagai perusahaan tanpa laba sama sekali.
{
  const kosong = {
    year: '2024', revenue: 1000, grossProfit: 0, ebitda: 0, ebit: 0, netIncome: 0,
    capex: 0, da: 0, nwc: 0, cash: 0, totalDebt: 0,
  } as HistoricalYearData;
  const c = calibrateFinancialReport(laporan([kosong]));
  check('marjin EBITDA yang hilang memakai default, bukan nol', c.avgEbitdaMargin > 0,
    `${c.avgEbitdaMargin}`);
  check('marjin kotor yang hilang memakai default, bukan nol', c.avgGrossMargin > 0,
    `${c.avgGrossMargin}`);
}

// --- laporan
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) process.exit(1);
