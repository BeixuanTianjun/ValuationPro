/**
 * check-mail.ts — apakah alert email benar-benar bisa terkirim?
 *
 *   npm run mail:check
 *
 * Menguji KONEKSI dan LOGIN ke SMTP, tanpa mengirim satu email pun. Dipakai
 * sebelum menyalahkan SMTP saat digest tidak sampai — pada 2026-09-02 semua
 * pemeriksaan di sini hijau, dan penyebab sebenarnya adalah layanan lokal yang
 * mati pada pukul 12:05 WIB sehingga jendela job-nya terlewat. Lihat catatan
 * "Alert 12:05 tidak pernah gagal" di HANDOVER.
 *
 * Alamat dan sandi tidak pernah dicetak utuh: cukup untuk memastikan terisi,
 * tidak cukup untuk bocor ke terminal orang lain.
 */
import { join } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { readMailConfig, verifyMail } from '../src/server/emailAlert';

loadEnv({ path: join(process.cwd(), '.env') });

const cfg = readMailConfig(process.env, null);
if (!cfg) {
  console.log('KONFIG TIDAK LENGKAP — readMailConfig mengembalikan null');
  process.exit(0);
}
console.log(`host   : ${cfg.host}:${cfg.port} (secure=${cfg.secure})`);
console.log(`user   : ${cfg.user.replace(/(.{3}).*(@.*)/, '$1***$2')}`);
console.log(`dari   : ${cfg.from.replace(/(.{3}).*(@.*)/, '$1***$2')}`);
console.log(`ke     : ${cfg.to.map((t) => t.replace(/(.{3}).*(@.*)/, '$1***$2')).join(', ')}`);
console.log(`sandi  : ${cfg.pass ? `terisi (${cfg.pass.length} karakter)` : 'KOSONG'}`);
console.log('\nmenguji koneksi + login ke SMTP (tanpa mengirim apa pun)…');
try {
  await verifyMail(cfg);
  console.log('HASIL  : BERHASIL — SMTP menerima login.');
} catch (err) {
  console.log(`HASIL  : GAGAL — ${(err as Error).message}`);
}
