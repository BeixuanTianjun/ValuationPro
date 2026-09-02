// Identitas aritmetika mesin LBO.
// Jalankan dengan: npm run test
//
// KENAPA BARU SEKARANG. lboEngine 263 baris dan sampai commit ini tidak
// disentuh satu pun tes maupun invarian backtest — ia salah satu dari sembilan
// model yang berdiri tanpa jaring. Sebuah mesin valuasi adalah tempat terburuk
// untuk itu: keluarannya angka yang masuk akal apa pun yang terjadi di
// dalamnya, jadi kesalahan di sini tidak pernah muncul sebagai error. Ia muncul
// sebagai IRR 23% yang salah.
//
// Yang diuji di sini bukan "apakah angkanya bagus" melainkan identitas yang
// HARUS berlaku berapa pun asumsinya: neraca sumber-penggunaan yang seimbang,
// MoIC yang konsisten dengan IRR, dan jembatan atribusi yang benar-benar
// menjumlah ke perubahan nilainya.

import { LboAssumptions } from '../../types/lbo';
import { calculateSourcesAndUses, runLboModel } from '../lboEngine';

const BASE: LboAssumptions = {
  dealName: 'Uji',
  currency: 'Rp ',
  targetLtmRevenue: 10_000,
  targetLtmEbitda: 2_000,
  entryEvEbitdaMultiple: 8,
  holdPeriodYears: 5,
  exitEvEbitdaMultiple: 8,

  advisoryFeePercent: 0.015,
  financingFeePercent: 0.02,

  seniorDebtMultiple: 3,
  seniorDebtInterest: 0.09,
  seniorDebtAmort: 0.05,

  subDebtMultiple: 1,
  subDebtInterest: 0.13,
  subDebtAmort: 0,

  minCashBalance: 200,

  revenueGrowthRates: [0.08, 0.07, 0.06, 0.05, 0.05, 0.05, 0.05],
  ebitdaMargins: [0.2, 0.2, 0.21, 0.21, 0.22, 0.22, 0.22],
  capexPercentOfRev: [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05],
  nwcPercentOfRev: [0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08],
  daPercentOfRev: [0.06, 0.06, 0.06, 0.06, 0.06, 0.06, 0.06],
  taxRate: 0.22,
  cashSweepPercent: 1,
};

const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => results.push({ name, ok, detail });

/** Toleransi relatif — angka di sini berskala ribuan, jadi absolut tidak cocok. */
const near = (a: number, b: number, rel = 1e-9) =>
  Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b), 1) * rel;

// 1. Neraca transaksi harus seimbang. Kalau sumber tidak sama dengan
//    penggunaan, seluruh model membiayai sesuatu dari udara.
{
  const su = calculateSourcesAndUses(BASE);
  check('sumber sama dengan penggunaan', near(su.totalSources, su.totalUses),
    `sumber=${su.totalSources.toFixed(2)} penggunaan=${su.totalUses.toFixed(2)}`);
  check('ekuitas sponsor tidak negatif', su.sponsorEquity >= 0, `${su.sponsorEquity.toFixed(2)}`);
  check('nilai perusahaan = EBITDA x kelipatan masuk',
    near(su.enterpriseValue, BASE.targetLtmEbitda * BASE.entryEvEbitdaMultiple));
  check('kelipatan utang total = utang / EBITDA',
    near(su.totalDebtMultiple, su.totalDebtRaised / BASE.targetLtmEbitda));
}

// 2. MoIC adalah rasio, bukan angka terpisah. Kalau ia tidak sama dengan
//    nilai ekuitas keluar dibagi ekuitas masuk, salah satunya dihitung dari
//    jalur yang berbeda dan keduanya tidak bisa dipercaya.
{
  const r = runLboModel(BASE);
  check('MoIC = ekuitas keluar / ekuitas masuk',
    near(r.sponsorMoIC, r.exitEquityValue / r.initialSponsorEquity),
    `moic=${r.sponsorMoIC.toFixed(4)}`);
  check('ekuitas masuk sama dengan yang dihitung sumber-penggunaan',
    near(r.initialSponsorEquity, r.sourcesAndUses.sponsorEquity));
}

// 3. IRR dan MoIC harus setuju. Untuk satu arus keluar di awal dan satu arus
//    masuk di akhir, (1+IRR)^tahun HARUS sama dengan MoIC — tidak ada ruang
//    tafsir. Ini pemeriksaan yang menangkap IRR yang dihitung atas jumlah
//    tahun yang salah, yang tampak wajar sampai dibandingkan begini.
{
  const r = runLboModel(BASE);
  const implied = Math.pow(1 + r.sponsorIRR, r.exitYear);
  check('(1+IRR)^tahun setara MoIC', near(implied, r.sponsorMoIC, 1e-6),
    `implied=${implied.toFixed(4)} moic=${r.sponsorMoIC.toFixed(4)} tahun=${r.exitYear}`);
}

// 4. Jembatan atribusi. Pertumbuhan EBITDA, ekspansi kelipatan dan pelunasan
//    utang adalah tiga sumber perubahan nilai ekuitas, dan menurut definisinya
//    ketiganya menjumlah ke selisih antara ekuitas keluar dan ekuitas masuk.
//    Kalau tidak, salah satu komponen menghitung ganda.
{
  const r = runLboModel(BASE);
  const total =
    r.ebitdaGrowthImpact + r.multipleExpansionImpact + r.debtPaydownImpact + r.transactionFeeImpact;
  const actual = r.exitEquityValue - r.initialSponsorEquity;
  check('empat komponen atribusi menjumlah ke perubahan nilai ekuitas',
    near(total, actual, 1e-6),
    `jumlah=${total.toFixed(2)} sebenarnya=${actual.toFixed(2)} selisih=${(total - actual).toFixed(2)}`);

  // Komponen biaya harus benar-benar sebesar fee-nya, bukan sekadar angka yang
  // kebetulan menutup selisih. Kalau ia dihitung sebagai sisa, ia akan menyerap
  // kesalahan apa pun di ketiga komponen lain dan jembatannya menutup terus
  // meski isinya salah.
  const fee = r.sourcesAndUses.advisoryFees + r.sourcesAndUses.financingFees;
  check('komponen biaya sama dengan biaya transaksi yang sesungguhnya',
    near(r.transactionFeeImpact, -fee),
    `komponen=${r.transactionFeeImpact.toFixed(2)} fee=${(-fee).toFixed(2)}`);
  check('komponen biaya tidak pernah positif', r.transactionFeeImpact <= 0);
}

// 5. Kelipatan keluar SAMA dengan kelipatan masuk berarti nol ekspansi.
//    Kalau angka ini bukan nol, komponennya mengukur sesuatu yang lain.
{
  const r = runLboModel({ ...BASE, exitEvEbitdaMultiple: BASE.entryEvEbitdaMultiple });
  check('kelipatan keluar = masuk memberi ekspansi nol',
    Math.abs(r.multipleExpansionImpact) < 1e-6,
    `${r.multipleExpansionImpact.toFixed(6)}`);
}

// 6. Monotonisitas: keluar lebih mahal tidak boleh menghasilkan MoIC lebih
//    rendah. Arah yang terbalik di sini adalah tanda kesalahan tanda.
{
  const lo = runLboModel({ ...BASE, exitEvEbitdaMultiple: 7 });
  const hi = runLboModel({ ...BASE, exitEvEbitdaMultiple: 10 });
  check('kelipatan keluar lebih tinggi memberi MoIC lebih tinggi',
    hi.sponsorMoIC > lo.sponsorMoIC,
    `7x=${lo.sponsorMoIC.toFixed(3)} 10x=${hi.sponsorMoIC.toFixed(3)}`);
}

// 7. Utang tidak boleh menjadi negatif. Sapuan kas yang melunasi lebih banyak
//    daripada yang tersisa akan menciptakan "utang negatif" yang diam-diam
//    menambah nilai ekuitas.
{
  const r = runLboModel({ ...BASE, cashSweepPercent: 1, seniorDebtMultiple: 0.5, subDebtMultiple: 0 });
  const negatif = r.schedules.filter(
    (s) => s.seniorDebt.endingBalance < -1e-9 || s.subDebt.endingBalance < -1e-9,
  );
  check('saldo utang tidak pernah negatif', negatif.length === 0,
    negatif.length ? `tahun ${negatif.map((s) => s.year).join(',')}` : '');
}

// 8. Periode tahan dijepit ke panjang larik proyeksi. Meminta sepuluh tahun
//    dengan tujuh baris asumsi harus memberi tujuh, bukan tiga tahun kosong
//    yang diperlakukan sebagai nol pertumbuhan.
{
  const r = runLboModel({ ...BASE, holdPeriodYears: 10 });
  check('periode tahan dijepit ke panjang asumsi',
    r.schedules.length === BASE.revenueGrowthRates.length && r.exitYear === BASE.revenueGrowthRates.length,
    `jadwal=${r.schedules.length} exitYear=${r.exitYear}`);

  const satu = runLboModel({ ...BASE, holdPeriodYears: 0 });
  check('periode tahan minimum satu tahun', satu.schedules.length === 1, `${satu.schedules.length}`);
}

// 9. EBITDA keluar harus datang dari tahun terakhir jadwalnya, bukan dari LTM.
{
  const r = runLboModel(BASE);
  const akhir = r.schedules[r.schedules.length - 1];
  check('EBITDA keluar = EBITDA tahun terakhir', near(r.exitEbitda, akhir.ebitda),
    `keluar=${r.exitEbitda.toFixed(2)} tahunAkhir=${akhir.ebitda.toFixed(2)}`);
  check('nilai perusahaan keluar = EBITDA keluar x kelipatan keluar',
    near(r.exitEnterpriseValue, r.exitEbitda * r.exitMultiple));
  check('ekuitas keluar = nilai perusahaan keluar - utang bersih akhir',
    near(r.exitEquityValue, r.exitEnterpriseValue - r.endingNetDebt),
    `ekuitas=${r.exitEquityValue.toFixed(2)}`);
}

// 10. Tidak ada angka yang boleh NaN. Sebuah NaN di sini menyebar ke seluruh
//     layar dan tampil sebagai strip, yang terbaca seperti "belum dihitung"
//     alih-alih "dihitung salah".
{
  const r = runLboModel(BASE);
  const angka: Record<string, number> = {
    sponsorMoIC: r.sponsorMoIC,
    sponsorIRR: r.sponsorIRR,
    exitEquityValue: r.exitEquityValue,
    endingNetDebt: r.endingNetDebt,
    initialSponsorEquity: r.initialSponsorEquity,
  };
  const buruk = Object.entries(angka).filter(([, v]) => !Number.isFinite(v));
  check('tidak ada keluaran utama yang NaN', buruk.length === 0,
    buruk.map(([k]) => k).join(', '));
}

// --- laporan
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) process.exit(1);
