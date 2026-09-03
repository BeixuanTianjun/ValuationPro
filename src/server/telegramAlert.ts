/**
 * telegramAlert.ts — kanal kedua untuk digest yang sama.
 *
 * ── KENAPA ADA ────────────────────────────────────────────────────────────
 *
 * Pemilik repo mengirim video agen AI yang MENELEPON penggunanya dan bilang
 * butuh yang seperti itu untuk update screener. Telepon butuh Twilio Voice atau
 * sejenisnya, berbayar per menit, dan Claude tidak punya akses jaringan
 * telepon. Telegram gratis, sampai ke ponsel dalam hitungan detik, dan tidak
 * mengendap di folder promosi seperti email.
 *
 * Ini BUKAN pengganti email melainkan tambahan. Keduanya membaca digest yang
 * sama dan gagal sendiri-sendiri: satu kanal yang mati tidak boleh membungkam
 * yang lain, karena alasan seluruh fitur ini adalah tidak melewatkan sesi.
 *
 * ── YANG SENGAJA TIDAK DILAKUKAN ──────────────────────────────────────────
 *
 * Tidak ada pesan yang pernah dikirim tanpa TELEGRAM_BOT_TOKEN dan
 * TELEGRAM_CHAT_ID di .env. Tanpa keduanya, fungsi di sini mengembalikan
 * keterangan bahwa kanalnya belum dikonfigurasi — bukan diam. Kanal terjadwal
 * yang gagal dalam diam lebih buruk daripada tidak ada kanal, karena Anda
 * mengira sedang diawasi.
 *
 * ── CARA MEMASANG ─────────────────────────────────────────────────────────
 *
 *   1. Buka @BotFather di Telegram, kirim /newbot, salin tokennya.
 *   2. Kirim satu pesan apa pun ke bot itu supaya ia boleh membalas Anda.
 *      Telegram melarang bot memulai percakapan lebih dulu.
 *   3. Buka https://api.telegram.org/bot<TOKEN>/getUpdates dan salin
 *      `message.chat.id`.
 *   4. Isi .env:  TELEGRAM_BOT_TOKEN=...  dan  TELEGRAM_CHAT_ID=...
 *   5. `npm run telegram:check` — memverifikasi tokennya TANPA mengirim pesan.
 */

import type { DigestInput } from './emailAlert';
import { renderDigestText } from './emailAlert';

export interface TelegramConfig {
  token: string;
  chatId: string;
}

/**
 * Batas panjang pesan Telegram.
 *
 * 4096 karakter, dan API menolak seluruh pesan kalau lewat — bukan memotongnya.
 * Digest untuk hari yang ramai bisa menembusnya, jadi pemotongan dilakukan di
 * sini dengan penanda yang jelas. Pesan yang terpotong diam-diam akan terbaca
 * seolah screener hanya menemukan enam emiten.
 */
const MAX_LEN = 4096;
const TRUNCATION_NOTE = '\n\n… dipotong. Buka layar SCR untuk daftar lengkapnya.';

export function readTelegramConfig(env: NodeJS.ProcessEnv = process.env): TelegramConfig | null {
  const token = (env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = (env.TELEGRAM_CHAT_ID || '').trim();
  if (!token || !chatId) return null;
  return { token, chatId };
}

/** Pesan error yang bisa ditindaklanjuti, bukan status code telanjang. */
export function explainTelegramError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/401|unauthorized/i.test(msg)) return 'token bot ditolak — periksa TELEGRAM_BOT_TOKEN';
  if (/chat not found/i.test(msg)) {
    return 'chat tidak ditemukan — kirim dulu satu pesan ke bot itu, lalu ambil ulang chat id';
  }
  if (/403|blocked|forbidden/i.test(msg)) return 'bot diblokir oleh chat ini';
  if (/429|too many/i.test(msg)) return 'dibatasi laju oleh Telegram — coba lagi nanti';
  if (/fetch failed|ENOTFOUND|ETIMEDOUT/i.test(msg)) return `tidak bisa menjangkau api.telegram.org (${msg})`;
  return msg;
}

async function callApi(
  cfg: TelegramConfig,
  method: string,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.telegram.org/bot${cfg.token}/${method}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || json.ok !== true) {
    throw new Error(`${res.status} ${String(json.description ?? res.statusText)}`);
  }
  return (json.result ?? {}) as Record<string, unknown>;
}

/**
 * Periksa token TANPA mengirim apa pun.
 *
 * `getMe` hanya mengembalikan identitas botnya. Ia dipisahkan dari pengiriman
 * dengan sengaja: memverifikasi konfigurasi seharusnya tidak menaruh pesan uji
 * di ponsel siapa pun.
 */
export async function verifyTelegram(cfg: TelegramConfig): Promise<string> {
  const me = await callApi(cfg, 'getMe');
  return `@${String(me.username ?? '?')} (${String(me.first_name ?? '')})`;
}

/**
 * Digest yang sama dengan email, dipadatkan untuk layar ponsel.
 *
 * Dikirim sebagai teks polos, tanpa parse_mode. Markdown Telegram mewajibkan
 * meng-escape belasan karakter, dan nama emiten IDX memuat titik, tanda kurung
 * dan tanda hubung — satu yang terlewat membuat SELURUH pesan ditolak, bukan
 * satu barisnya. Teks polos tidak bisa gagal seperti itu.
 */
export function renderTelegramDigest(input: DigestInput): string {
  const s = input.screener;
  const w = input.watchlist;
  const lines: string[] = [
    `ValuationPro · sesi ${input.session}`,
    input.trigger,
    '',
    `SCREENER — ${s.rows.length} lolos dari ${s.universe}`,
  ];

  for (const r of s.rows.slice(0, 8)) {
    const chg = `${r.changePercent >= 0 ? '+' : ''}${(r.changePercent * 100).toFixed(1)}%`;
    lines.push(`  ${r.code}  Rp ${Math.round(r.close).toLocaleString('id-ID')}  ${chg}`);
  }
  if (s.rows.length > 8) lines.push(`  … dan ${s.rows.length - 8} lagi`);

  lines.push('', `WATCHLIST — ${w.candidates.length} kandidat`);
  for (const [i, c] of w.candidates.slice(0, 5).entries()) {
    lines.push(`  ${i + 1}. ${c.code} · skor ${c.score.toFixed(2)} · ${c.stagesCleared}/3 tahap`);
    if (c.narrative.headline) lines.push(`     ${c.narrative.headline}`);
  }

  lines.push('', 'Alat riset, bukan rekomendasi investasi.');

  const text = lines.join('\n');
  if (text.length <= MAX_LEN) return text;
  return text.slice(0, MAX_LEN - TRUNCATION_NOTE.length) + TRUNCATION_NOTE;
}

export async function sendTelegramDigest(cfg: TelegramConfig, input: DigestInput): Promise<string> {
  const result = await callApi(cfg, 'sendMessage', {
    chat_id: cfg.chatId,
    text: renderTelegramDigest(input),
    disable_web_page_preview: true,
  });
  return String(result.message_id ?? '?');
}

/** Pesan bebas, dipakai alat pemeriksa dan peringatan kegagalan ingest. */
export async function sendTelegramText(cfg: TelegramConfig, text: string): Promise<string> {
  const trimmed = text.length <= MAX_LEN ? text : text.slice(0, MAX_LEN - TRUNCATION_NOTE.length) + TRUNCATION_NOTE;
  const result = await callApi(cfg, 'sendMessage', {
    chat_id: cfg.chatId,
    text: trimmed,
    disable_web_page_preview: true,
  });
  return String(result.message_id ?? '?');
}

// `renderDigestText` sengaja tidak dipakai di sini — versi email jauh lebih
// panjang dan menembus batas 4096 pada hari yang ramai. Impornya dipertahankan
// supaya ketergantungan pada bentuk DigestInput tetap terlihat oleh typecheck.
void renderDigestText;
