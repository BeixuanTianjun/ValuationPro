// Email delivery for the daily Screener + Watchlist digest.
//
// Credentials are read from the environment only — nothing is ever stored in
// the repository. See .env.example for the variables and how to obtain a Gmail
// app password.

import nodemailer, { Transporter } from 'nodemailer';
import { MarketBreadth } from '../types/market';
import { LiveStatus } from '../data/marketRepository';
import { ScreenerResult, ScreenerRow } from '../models/stockScreener';
import { WatchlistCandidate, WatchlistResult } from '../models/watchlist';
import type { RadarResult } from '../models/eventRadar';

export interface MailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  to: string[];
}

/**
 * @param adminEmail When an administrator account exists, their address is the
 *   alert recipient — the account owns the inbox, not the config file. Falls
 *   back to ALERT_EMAIL_TO when nobody has signed up yet.
 */
export function readMailConfig(
  env: NodeJS.ProcessEnv = process.env,
  adminEmail?: string | null
): MailConfig | null {
  const host = env.SMTP_HOST;
  const user = env.SMTP_USER;
  const pass = env.SMTP_PASS;
  const to = adminEmail
    ? [adminEmail]
    : (env.ALERT_EMAIL_TO || '').split(',').map((s) => s.trim()).filter(Boolean);

  if (!host || !user || !pass || !to.length) return null;

  const port = Number(env.SMTP_PORT || 465);
  return {
    host,
    port,
    // Port 465 is implicit TLS; 587 upgrades via STARTTLS.
    secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465,
    user,
    pass,
    from: env.ALERT_EMAIL_FROM || user,
    to,
  };
}

let transporter: Transporter | null = null;
let transporterKey = '';

function getTransporter(cfg: MailConfig): Transporter {
  // Keyed on the connection identity (never the password) so editing .env and
  // restarting a job picks up the new settings instead of reusing a stale pool.
  const key = `${cfg.host}:${cfg.port}:${cfg.secure}:${cfg.user}`;
  if (!transporter || transporterKey !== key) {
    transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
    });
    transporterKey = key;
  }
  return transporter;
}

/**
 * Turn nodemailer's raw SMTP failures into something actionable.
 * Gmail's 535 in particular almost always means "that is your account password,
 * not a 16-character App Password".
 */
export function explainMailError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: string })?.code || '';
  const response = (err as { response?: string })?.response || '';
  const combined = `${raw} ${response}`;

  if (/535|Username and Password not accepted|BadCredentials/i.test(combined)) {
    return (
      'SMTP menolak kredensialnya (535). Untuk Gmail, SMTP_PASS harus App Password 16 huruf ' +
      'yang dibuat di https://myaccount.google.com/apppasswords setelah 2-Step Verification aktif — ' +
      'bukan password akun Google Anda, dan bukan nilai contoh.'
    );
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(`${code} ${combined}`)) {
    return `Host SMTP tidak ditemukan. Periksa SMTP_HOST. (${raw})`;
  }
  if (/ETIMEDOUT|ECONNREFUSED|ESOCKET/i.test(`${code} ${combined}`)) {
    return `Tidak bisa terhubung ke server SMTP — port diblokir atau salah. Gmail memakai 465 (SSL) atau 587 (STARTTLS). (${raw})`;
  }
  return raw;
}

export async function verifyMail(cfg: MailConfig): Promise<void> {
  await getTransporter(cfg).verify();
}

// ---------------------------------------------------------------- rendering

const fmt = (v: number, d = 0) =>
  Number.isFinite(v) ? v.toLocaleString('id-ID', { maximumFractionDigits: d }) : '–';

export interface DigestInput {
  session: string;
  screener: ScreenerResult;
  watchlist: WatchlistResult;
  breadth: MarketBreadth;
  live: LiveStatus | null;
  trigger: string;
  /**
   * Opsional supaya pemanggil yang ditulis sebelum radar ada tetap sah, dan
   * supaya sebuah digest tidak batal terkirim hanya karena berkas pengumuman
   * belum dibangun.
   */
  radar?: RadarResult | null;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const bnRp = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '–');

function screenerRow(r: ScreenerRow): string {
  const chg = Number.isFinite(r.changePercent) ? r.changePercent * 100 : 0;
  return `
  <tr>
    <td style="padding:11px 12px;border-bottom:1px solid #e5e7eb;">
      <div style="font-weight:700;font-size:14px;color:#0f172a;">${escapeHtml(r.code)}</div>
      <div style="font-size:11px;color:#64748b;margin-top:2px;">${escapeHtml(r.name)}</div>
    </td>
    <td style="padding:11px 12px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#334155;">
      <strong>Rp ${fmt(r.close)}</strong>
      <div style="color:${chg >= 0 ? '#059669' : '#dc2626'};margin-top:2px;">${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%</div>
    </td>
    <td style="padding:11px 12px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#334155;">
      Rp ${bnRp(r.valueIdr / 1e9)} mdr
      <div style="color:#64748b;margin-top:2px;">${bnRp(r.volumeShares / 1e6)} jt lembar</div>
    </td>
    <td style="padding:11px 12px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#334155;">
      ${r.sessionsAboveMaLong} sesi di atas MA
      <div style="color:#64748b;margin-top:2px;">volume ${Number.isFinite(r.volumeSurge) ? r.volumeSurge.toFixed(2) : '–'}x</div>
    </td>
    <td style="padding:11px 12px;border-bottom:1px solid #e5e7eb;font-size:12px;color:${r.foreignNetIdrBn >= 0 ? '#059669' : '#dc2626'};">
      Rp ${bnRp(r.foreignNetIdrBn)} mdr
    </td>
  </tr>`;
}

function watchRow(c: WatchlistCandidate, rank: number): string {
  const reasons = c.reasons
    .slice(0, 2)
    .map((x) => `<div style="margin-top:3px;">• ${escapeHtml(x)}</div>`)
    .join('');
  const cautions = c.cautions
    .slice(0, 1)
    .map((x) => `<div style="margin-top:3px;color:#b45309;">⚠ ${escapeHtml(x)}</div>`)
    .join('');

  return `
  <tr>
    <td style="padding:13px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top;">
      <div style="font-weight:700;font-size:14px;color:#0f172a;">#${rank} ${escapeHtml(c.code)}</div>
      <div style="font-size:11px;color:#64748b;margin-top:2px;">${escapeHtml(c.name)}</div>
      <div style="font-size:11px;color:#1d4ed8;font-weight:600;margin-top:4px;">skor ${c.score.toFixed(2)} · ${c.stagesCleared}/3 tahap</div>
    </td>
    <td style="padding:13px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top;font-size:11px;color:#475569;line-height:1.55;">
      <div style="color:#0f172a;font-weight:600;">${escapeHtml(c.narrative.headline)}</div>
      ${reasons}
      ${cautions}
    </td>
  </tr>`;
}

export function renderDigestHtml(input: DigestInput): string {
  const { session, screener, watchlist, breadth, live, trigger, radar } = input;

  const staleFlowNotice = live?.applied
    ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px;margin:16px 0;font-size:12px;color:#92400e;">
        <strong>Catatan data.</strong> Harga bersifat live (${escapeHtml(live.marketState)}, ${escapeHtml(live.tradingDate)}),
        tetapi arus dana asing hanya diterbitkan IDX secara end-of-day — angka asing di bawah ini per sesi
        ${escapeHtml(live.foreignFlowAsOf)}, bukan hari ini.
      </div>`
    : '';

  const funnel = screener.funnel
    .map(
      (f) => `<td style="padding:9px 10px;background:#f8fafc;border-radius:8px;">
        <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.4px;">${escapeHtml(f.label)}</div>
        <div style="font-size:16px;font-weight:700;color:#0f172a;margin-top:2px;">${f.remaining}</div>
      </td>`
    )
    .join('');

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:760px;margin:0 auto;padding:24px 16px;">
    <div style="background:#0f172a;border-radius:14px 14px 0 0;padding:22px 24px;">
      <div style="color:#ffffff;font-size:19px;font-weight:800;letter-spacing:-0.3px;">
        Valuation<span style="color:#3b82f6;">Pro</span> · Screener &amp; Watchlist
      </div>
      <div style="color:#94a3b8;font-size:12px;margin-top:5px;">
        Sesi ${escapeHtml(session)} · ${escapeHtml(trigger)}
      </div>
    </div>

    <div style="background:#ffffff;padding:22px 24px;">
      <table style="width:100%;border-collapse:collapse;margin-bottom:6px;">
        <tr>
          ${statCell('Naik', String(breadth.advancers), '#059669')}
          ${statCell('Turun', String(breadth.decliners), '#dc2626')}
          ${statCell('Di atas MA200', `${(breadth.percentAboveSma200 * 100).toFixed(0)}%`, '#0f172a')}
          ${statCell('Net asing', `Rp ${fmt(breadth.netForeignIdrBn)} mdr`, breadth.netForeignIdrBn >= 0 ? '#059669' : '#dc2626')}
        </tr>
      </table>

      ${staleFlowNotice}

      <h2 style="font-size:14px;color:#0f172a;margin:22px 0 4px;">1 · Stock Screener</h2>
      <p style="font-size:12px;color:#64748b;margin:0 0 12px;line-height:1.6;">
        Tiga aturan keras: di atas MA${screener.settings.maShort} dan MA${screener.settings.maLong},
        volume di atas ${fmt(screener.settings.minVolumeShares / 1e6)} juta lembar, nilai transaksi di atas
        Rp ${fmt(screener.settings.minValueIdr / 1e9)} miliar. Lolos atau tidak — tidak ada skor di sini.
      </p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:12px;"><tr>${funnel}</tr></table>

      ${
        screener.rows.length
          ? `<table style="width:100%;border-collapse:collapse;">
        <thead><tr style="background:#f8fafc;">
          <th style="text-align:left;padding:8px 12px;font-size:10px;color:#64748b;text-transform:uppercase;">Emiten</th>
          <th style="text-align:left;padding:8px 12px;font-size:10px;color:#64748b;text-transform:uppercase;">Harga</th>
          <th style="text-align:left;padding:8px 12px;font-size:10px;color:#64748b;text-transform:uppercase;">Transaksi</th>
          <th style="text-align:left;padding:8px 12px;font-size:10px;color:#64748b;text-transform:uppercase;">Tren</th>
          <th style="text-align:left;padding:8px 12px;font-size:10px;color:#64748b;text-transform:uppercase;">Asing</th>
        </tr></thead>
        <tbody>${screener.rows.slice(0, 12).map(screenerRow).join('')}</tbody>
      </table>
      <p style="font-size:11px;color:#94a3b8;margin:8px 0 0;">
        Menampilkan 12 teratas menurut nilai transaksi dari ${screener.rows.length} yang lolos.
      </p>`
          : `<p style="font-size:12px;color:#b45309;margin:0;">Tidak ada emiten yang lolos ketiga aturan pada sesi ini. Pada pasar yang lemah, hasil kosong adalah jawaban yang benar.</p>`
      }

      <h2 style="font-size:14px;color:#0f172a;margin:26px 0 4px;">2 · Stock Watchlist (mingguan)</h2>
      <p style="font-size:12px;color:#64748b;margin:0 0 12px;line-height:1.6;">
        Corong empat tahap: narasi dari keterbukaan informasi IDX dan tema kebijakan terkurasi, lalu rotasi
        konglomerasi, lalu konfirmasi tape. Tahap chart tidak diskor — buka sendiri di terminal.
      </p>

      ${
        watchlist.candidates.length
          ? `<table style="width:100%;border-collapse:collapse;">
        <thead><tr style="background:#f8fafc;">
          <th style="text-align:left;padding:8px 12px;font-size:10px;color:#64748b;text-transform:uppercase;">Kandidat</th>
          <th style="text-align:left;padding:8px 12px;font-size:10px;color:#64748b;text-transform:uppercase;">Kenapa</th>
        </tr></thead>
        <tbody>${watchlist.candidates.map((c, i) => watchRow(c, i + 1)).join('')}</tbody>
      </table>`
          : `<p style="font-size:12px;color:#64748b;margin:0;">Tidak ada emiten dengan pemicu narasi pada jendela ini.</p>`
      }

      ${
        radar && radar.rows.length
          ? `<div style="margin:26px 0 0;padding:16px;border:1px solid #fde68a;border-radius:10px;background:#fffbeb;">
        <div style="font-size:13px;font-weight:800;color:#92400e;">RADAR PERISTIWA — ${radar.rows.length} dari ${radar.triggeredEmiten} emiten berpemicu</div>
        <p style="font-size:11px;color:#92400e;line-height:1.6;margin:6px 0 12px;">
          <strong>BELUM teruji.</strong> Arsip pengumuman baru menumpuk sejak 3 September 2026, jadi belum ada
          riwayat untuk mengujinya. Perlakukan tiap baris sebagai daftar bacaan, bukan sinyal beli.
        </p>
        ${radar.rows
          .slice(0, 6)
          .map(
            (r) => `<div style="padding:8px 0;border-top:1px solid #fde68a;">
            <div style="font-size:12px;font-weight:700;color:#0f172a;">${escapeHtml(r.code)} · ${escapeHtml(r.why.join(', '))}</div>
            ${r.filings[0] ? `<div style="font-size:11px;color:#78716c;margin-top:2px;">${escapeHtml(r.filings[0].title.slice(0, 120))}</div>` : ''}
          </div>`
          )
          .join('')}
      </div>`
          : ''
      }

      <p style="font-size:11px;color:#94a3b8;line-height:1.6;margin:22px 0 0;">
        Screener menyaring ${screener.universe} emiten tercatat dengan aturan yang bisa Anda periksa satu per satu.
        Watchlist masuk dari narasi, bukan dari harga — skornya bukan prediksi return. Arus asing diterbitkan IDX
        end-of-day. <strong>Ini alat riset, bukan rekomendasi investasi.</strong>
      </p>
    </div>

    <div style="background:#e2e8f0;border-radius:0 0 14px 14px;padding:14px 24px;font-size:11px;color:#64748b;">
      Dikirim otomatis oleh ValuationPro.
    </div>
  </div>
</body></html>`;
}

function statCell(label: string, value: string, color: string): string {
  return `<td style="padding:10px 12px;background:#f8fafc;border-radius:8px;">
    <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.4px;">${escapeHtml(label)}</div>
    <div style="font-size:16px;font-weight:700;color:${color};margin-top:2px;">${escapeHtml(value)}</div>
  </td>`;
}

export function renderDigestText(input: DigestInput): string {
  const lines = [
    'ValuationPro — Screener & Watchlist',
    `Sesi ${input.session} · ${input.trigger}`,
    '',
    `1) SCREENER — ${input.screener.rows.length} emiten lolos dari ${input.screener.universe} tercatat.`,
    `   Aturan: di atas MA${input.screener.settings.maShort} dan MA${input.screener.settings.maLong}, volume > ${fmt(input.screener.settings.minVolumeShares / 1e6)} juta lembar, nilai > Rp ${fmt(input.screener.settings.minValueIdr / 1e9)} miliar.`,
    '',
  ];
  for (const r of input.screener.rows.slice(0, 12)) {
    lines.push(
      `   ${r.code} — ${r.name}: Rp ${fmt(r.close)} (${r.changePercent >= 0 ? '+' : ''}${(r.changePercent * 100).toFixed(1)}%), nilai Rp ${bnRp(r.valueIdr / 1e9)} mdr, ${r.sessionsAboveMaLong} sesi di atas MA.`
    );
  }
  lines.push('', `2) WATCHLIST MINGGUAN — ${input.watchlist.candidates.length} kandidat bernarasi.`, '');
  for (const [i, c] of input.watchlist.candidates.entries()) {
    lines.push(`   #${i + 1} ${c.code} — ${c.name} [skor ${c.score.toFixed(2)}, ${c.stagesCleared}/3 tahap]`);
    lines.push(`      Pemicu: ${c.narrative.headline}`);
    for (const r of c.reasons.slice(0, 2)) lines.push(`      • ${r}`);
    for (const r of c.cautions.slice(0, 1)) lines.push(`      ! ${r}`);
    lines.push('');
  }
  if (input.radar && input.radar.rows.length) {
    lines.push('', `3) RADAR PERISTIWA — ${input.radar.rows.length} dari ${input.radar.triggeredEmiten} emiten berpemicu.`);
    lines.push('   BELUM teruji — daftar bacaan, bukan sinyal beli.', '');
    for (const r of input.radar.rows.slice(0, 6)) {
      lines.push(`   ${r.code} — ${r.name} [${r.why.join(', ')}]`);
      if (r.filings[0]) lines.push(`      ${r.filings[0].title}`);
    }
    lines.push('');
  }
  lines.push('Alat riset, bukan rekomendasi investasi.');
  return lines.join('\n');
}

export async function sendDigest(cfg: MailConfig, input: DigestInput): Promise<string> {
  const top = input.watchlist.candidates
    .slice(0, 3)
    .map((c) => c.code)
    .join(', ');
  const subject = `[ValuationPro] ${input.screener.rows.length} lolos screener · watchlist ${top || 'kosong'} · ${input.session}`;

  const info = await getTransporter(cfg).sendMail({
    from: cfg.from,
    to: cfg.to.join(', '),
    subject,
    text: renderDigestText(input),
    html: renderDigestHtml(input),
  });
  return info.messageId;
}
