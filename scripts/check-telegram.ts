/**
 * check-telegram.ts — memverifikasi kanal Telegram TANPA mengirim pesan.
 *
 * Dipisahkan dari pengiriman dengan sengaja. Memeriksa konfigurasi seharusnya
 * tidak menaruh pesan uji di ponsel siapa pun, dan sebuah alat pemeriksa yang
 * diam-diam mengirim adalah alat yang tidak akan dijalankan orang dua kali.
 *
 * `--kirim` mengirim SATU pesan uji, dan hanya kalau diminta secara eksplisit.
 *
 *   npm run telegram:check
 *   npm run telegram:check -- --kirim
 */

import { config } from 'dotenv';
import {
  explainTelegramError,
  readTelegramConfig,
  renderTelegramDigest,
  sendTelegramText,
  verifyTelegram,
} from '../src/server/telegramAlert';
import { computeDailyDigest } from '../src/server/marketFromDisk';
import { join } from 'node:path';

config();

const DATA_DIR = join(process.cwd(), 'public', 'data', 'idx');
const kirim = process.argv.includes('--kirim');

async function main() {
  console.log('=== Kanal Telegram ===');
  console.log('');

  const cfg = readTelegramConfig();
  if (!cfg) {
    console.log('BELUM DIKONFIGURASI.');
    console.log('');
    console.log('  TELEGRAM_BOT_TOKEN dan TELEGRAM_CHAT_ID belum ada di .env.');
    console.log('');
    console.log('  Cara memasang:');
    console.log('    1. Buka @BotFather di Telegram, kirim /newbot, salin tokennya.');
    console.log('    2. Kirim satu pesan apa pun ke bot itu. Telegram melarang bot');
    console.log('       memulai percakapan lebih dulu, jadi langkah ini wajib.');
    console.log('    3. Buka https://api.telegram.org/bot<TOKEN>/getUpdates');
    console.log('       lalu salin message.chat.id');
    console.log('    4. Isi keduanya di .env, jalankan lagi perintah ini.');
    process.exitCode = 1;
    return;
  }

  console.log(`  token   : ...${cfg.token.slice(-6)}`);
  console.log(`  chat id : ${cfg.chatId}`);
  console.log('');

  try {
    const who = await verifyTelegram(cfg);
    console.log(`  OK    token diterima Telegram — bot ${who}`);
  } catch (err) {
    console.log(`  GAGAL ${explainTelegramError(err)}`);
    process.exitCode = 1;
    return;
  }

  // Pratinjau isi pesannya, supaya bentuknya bisa dinilai sebelum satu pun
  // dikirim ke ponsel.
  try {
    const { screener, watchlist, breadth, db } = await computeDailyDigest(DATA_DIR);
    const teks = renderTelegramDigest({
      session: db.meta.latestSession,
      screener,
      watchlist,
      breadth,
      live: db.live,
      trigger: 'Pratinjau manual',
    });
    console.log('');
    console.log(`--- pratinjau (${teks.length} karakter, batas 4096) ---`);
    console.log(teks);
    console.log('--- akhir pratinjau ---');

    if (!kirim) {
      console.log('');
      console.log('TIDAK ADA yang dikirim. Tambahkan --kirim kalau memang mau mengirim pesan uji.');
      return;
    }

    const id = await sendTelegramText(cfg, teks);
    console.log('');
    console.log(`  OK    pesan uji terkirim (id ${id})`);
  } catch (err) {
    console.log('');
    console.log(`  GAGAL menyusun atau mengirim — ${explainTelegramError(err)}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
