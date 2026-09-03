// Isi workbook DCF + LBO.
// Jalankan dengan: npm run test
//
// KENAPA BARU BISA SEKARANG. Sama seperti pickReport: `saveAs` butuh DOM, jadi
// selama penyusunan dan penyimpanan menyatu, satu-satunya cara memeriksa berkas
// ini adalah mengunduhnya. `buildFinancialModelWorkbook` dipisahkan supaya
// isinya bisa dibaca di Node.
//
// Yang dijaga bukan tata letaknya melainkan hal-hal yang membuat angka di
// dalamnya bisa salah dibaca: satuan yang ikut tercetak, dan mata uang yang
// benar-benar diterapkan ke selnya.

import type { DcfAssumptions } from '../../types/dcf';
import type { LboAssumptions } from '../../types/lbo';
import { runDcfModel } from '../dcfEngine';
import { runLboModel } from '../lboEngine';
import { buildFinancialModelWorkbook, financialModelFilename } from '../excelExporter';

const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') =>
  results.push({ name, ok, detail: ok ? '' : detail });

const DCF: DcfAssumptions = {
  companyName: 'Contoh Sejahtera Tbk',
  currency: 'Rp ', units: 'billions',
  currentSharePrice: 1000, sharesOutstanding: 10,
  balanceSheetCash: 5000, balanceSheetDebt: 3000, minorityInterest: 0, equityInvestments: 0,
  baseRevenue: 100_000, forecastYears: 5,
  revenueGrowthRates: [0.06, 0.05, 0.05, 0.04, 0.04],
  grossMargins: [0.4, 0.4, 0.4, 0.4, 0.4],
  ebitdaMargins: [0.25, 0.25, 0.25, 0.25, 0.25],
  ebitMargins: [0.17, 0.17, 0.17, 0.17, 0.17],
  taxRate: 0.22,
  capexPercentOfRev: [0.06, 0.06, 0.06, 0.06, 0.06],
  nwcPercentOfRev: [0.08, 0.08, 0.08, 0.08, 0.08],
  daPercentOfRev: [0.08, 0.08, 0.08, 0.08, 0.08],
  useManualWacc: true, manualWacc: 0.12,
  riskFreeRate: 0.0675, beta: 1, equityRiskPremium: 0.0755, sizePremium: 0,
  preTaxCostOfDebt: 0.0875, targetDebtWeight: 0.3,
  perpetualGrowthRate: 0.04, exitMultiple: 6, discountConvention: 'mid-year',
};

const LBO: LboAssumptions = {
  dealName: 'Contoh', currency: 'Rp ',
  targetLtmRevenue: 10_000, targetLtmEbitda: 2_000,
  entryEvEbitdaMultiple: 8, holdPeriodYears: 5, exitEvEbitdaMultiple: 9,
  advisoryFeePercent: 0.015, financingFeePercent: 0.02,
  seniorDebtMultiple: 3, seniorDebtInterest: 0.09, seniorDebtAmort: 0.05,
  subDebtMultiple: 1, subDebtInterest: 0.13, subDebtAmort: 0,
  minCashBalance: 200,
  revenueGrowthRates: [0.08, 0.07, 0.06, 0.05, 0.05],
  ebitdaMargins: [0.2, 0.2, 0.21, 0.21, 0.22],
  capexPercentOfRev: [0.05, 0.05, 0.05, 0.05, 0.05],
  nwcPercentOfRev: [0.08, 0.08, 0.08, 0.08, 0.08],
  daPercentOfRev: [0.06, 0.06, 0.06, 0.06, 0.06],
  taxRate: 0.22, cashSweepPercent: 1,
};

/**
 * Seluruh teks satu lembar, huruf kecil.
 *
 * Header di berkas ini dicetak KAPITAL, jadi pencarian yang peka huruf
 * besar-kecil meleset pada teks yang sebenarnya ada — versi pertama tes ini
 * melaporkan tiga kegagalan yang seluruhnya salah alarm.
 */
function isiLembar(wb: Awaited<ReturnType<typeof buildFinancialModelWorkbook>>, nama: string): string {
  const s = wb.getWorksheet(nama);
  if (!s) return '';
  const teks: string[] = [];
  s.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (c) => {
    const v = c.value;
    teks.push(typeof v === 'object' && v !== null && 'richText' in v
      ? (v.richText as { text: string }[]).map((t) => t.text).join('')
      : String(v ?? ''));
  }));
  return teks.join(' | ').toLowerCase();
}

async function main() {
  const wb = await buildFinancialModelWorkbook(DCF, runDcfModel(DCF), LBO, runLboModel(LBO));

  // 1. Kedua model ada di satu berkas. Sebuah workbook "DCF + LBO" yang hanya
  //    memuat satunya adalah berkas yang salah dengan nama yang meyakinkan.
  {
    const nama = wb.worksheets.map((w) => w.name);
    check('lembar DCF Model ada', nama.includes('DCF Model'), nama.join(', '));
    check('lembar LBO Model ada', nama.includes('LBO Model'), nama.join(', '));
  }

  // 2. SATUAN IKUT TERCETAK. Ini yang paling menentukan apakah angka di dalam
  //    workbook bisa dibaca enam bulan lagi: "80.000" tanpa keterangan bisa
  //    berarti delapan puluh ribu rupiah atau delapan puluh triliun, dan
  //    keduanya sama masuk akalnya untuk emiten IDX.
  {
    // Yang diuji ADANYA keterangan satuan, bukan bentuk katanya. Versi pertama
    // tes ini mencari "(Rp bn)" karena itu bentuk UNIT_TAG di kodenya, padahal
    // lembar DCF menulisnya "Currency: Rp in billions" — sebuah tes yang gagal
    // pada berkas yang sebenarnya benar adalah tes yang akan dimatikan orang.
    const semua = isiLembar(wb, 'DCF Model');
    check('mata uang tercetak', semua.includes('rp'), semua.slice(0, 200));
    check('skala tercetak', semua.includes('billion'), semua.slice(0, 200));
  }

  // 3. Nama perusahaan sampai ke dalam berkasnya, bukan cuma ke nama berkas.
  {
    const semua = isiLembar(wb, 'DCF Model');
    check('nama perusahaan muncul di dalam workbook',
      semua.includes('contoh sejahtera'), semua.slice(0, 200));
  }

  // 4. Nama berkas aman dipakai sistem berkas. Spasi pada nama emiten IDX
  //    ("Contoh Sejahtera Tbk") menghasilkan nama unduhan yang berantakan di
  //    sebagian sistem, jadi ia diganti garis bawah.
  {
    const f = financialModelFilename('Contoh Sejahtera Tbk');
    check('spasi diganti garis bawah', !f.includes(' '), f);
    check('nama berkas memuat nama perusahaan', f.includes('Contoh_Sejahtera_Tbk'), f);
    check('berakhiran .xlsx', f.endsWith('.xlsx'), f);
  }

  // 5. Workbook terbentuk untuk model yang angkanya ekstrem. Pengguna bisa
  //    mengetik apa saja di layar asumsi, dan ekspor yang melempar di situ
  //    terbaca sebagai kerusakan aplikasi, bukan sebagai asumsi yang aneh.
  {
    let lempar = false;
    try {
      const aneh: DcfAssumptions = { ...DCF, perpetualGrowthRate: 0.5, manualWacc: 0.05 };
      await buildFinancialModelWorkbook(aneh, runDcfModel(aneh), LBO, runLboModel(LBO));
    } catch {
      lempar = true;
    }
    check('tidak melempar pada asumsi yang tidak masuk akal', !lempar);
  }

  // 6. Mata uang non-rupiah ikut terbawa. Seratus emiten IDX melaporkan dalam
  //    USD, dan workbook yang mencetak "Rp" di atas angka dolar adalah
  //    kesalahan yang tidak akan pernah terlihat sebagai error.
  {
    const usd: DcfAssumptions = { ...DCF, currency: 'US$ ', units: 'millions' };
    const w = await buildFinancialModelWorkbook(usd, runDcfModel(usd), LBO, runLboModel(LBO));
    const semua = isiLembar(w, 'DCF Model');
    check('mata uang non-rupiah tercetak', semua.includes('us$'), semua.slice(0, 200));
    check('skala juta tercetak, bukan miliar',
      semua.includes('million') && !semua.includes('billion'), semua.slice(0, 200));
  }

  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed++;
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
  }
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
