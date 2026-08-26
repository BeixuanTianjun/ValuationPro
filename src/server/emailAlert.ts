// Email delivery for the daily stock-pick digest.
//
// Credentials are read from the environment only — nothing is ever stored in
// the repository. See .env.example for the variables and how to obtain a Gmail
// app password.

import nodemailer, { Transporter } from 'nodemailer';
import { MarketBreadth, ScreenResult, StockPick } from '../types/market';
import { LiveStatus } from '../data/marketRepository';

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
const pct = (v: number, d = 1) =>
  Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%` : '–';

const CONVICTION_TEXT: Record<StockPick['conviction'], string> = {
  high: 'Konviksi Tinggi',
  medium: 'Konviksi Sedang',
  speculative: 'Konviksi Rendah',
};
const CONVICTION_COLOR: Record<StockPick['conviction'], string> = {
  high: '#059669',
  medium: '#2563eb',
  speculative: '#d97706',
};

export interface DigestInput {
  result: ScreenResult;
  breadth: MarketBreadth;
  briefing: string;
  live: LiveStatus | null;
  trigger: string;
}

function pickRow(p: StockPick): string {
  const f = p.factors;
  const plan = p.plan;
  const stopPct = ((plan.stopLoss - plan.entry) / plan.entry) * 100;
  const t1Pct = ((plan.target1 - plan.entry) / plan.entry) * 100;

  return `
  <tr>
    <td style="padding:14px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top;">
      <div style="font-weight:700;font-size:15px;color:#0f172a;">#${p.rank} ${p.emiten.code}</div>
      <div style="font-size:12px;color:#64748b;margin-top:2px;">${escapeHtml(p.emiten.name)}</div>
      <div style="font-size:11px;color:${CONVICTION_COLOR[p.conviction]};font-weight:600;margin-top:4px;">
        ${CONVICTION_TEXT[p.conviction]} · skor ${p.compositeScore.toFixed(2)}
      </div>
      <div style="font-size:11px;color:#94a3b8;margin-top:2px;">${escapeHtml(p.emiten.sector)}</div>
    </td>
    <td style="padding:14px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top;font-size:12px;color:#334155;">
      <div><strong>Rp ${fmt(f.close)}</strong></div>
      <div style="color:#64748b;margin-top:3px;">3 bln ${pct(f.return3m)}</div>
      <div style="color:#64748b;">vs IHSG ${pct(f.relativeStrength3m)}</div>
      <div style="color:#64748b;">RSI ${Number.isFinite(f.rsi14) ? f.rsi14.toFixed(0) : '–'}</div>
    </td>
    <td style="padding:14px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top;font-size:12px;color:#334155;">
      <div>Entry <strong>Rp ${fmt(plan.entry)}</strong></div>
      <div style="color:#dc2626;">Stop Rp ${fmt(plan.stopLoss)} (${stopPct.toFixed(1)}%)</div>
      <div style="color:#059669;">Target Rp ${fmt(plan.target1)} (+${t1Pct.toFixed(1)}%)</div>
      <div style="color:#64748b;margin-top:3px;">${fmt(plan.suggestedLots)} lot · R:R 1:${plan.rewardRiskRatio.toFixed(2)}</div>
    </td>
    <td style="padding:14px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top;font-size:11px;color:#64748b;">
      ${p.flags.length ? p.flags.map((x) => `<div style="color:#b45309;">⚠ ${escapeHtml(x)}</div>`).join('') : '<div style="color:#059669;">Tidak ada peringatan</div>'}
    </td>
  </tr>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function renderDigestHtml(input: DigestInput): string {
  const { result, breadth, briefing, live, trigger } = input;

  const staleFlowNotice = live?.applied
    ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px;margin:16px 0;font-size:12px;color:#92400e;">
        <strong>Catatan data.</strong> Harga bersifat live (${escapeHtml(live.marketState)}, ${escapeHtml(live.tradingDate)}),
        tetapi arus dana asing hanya diterbitkan IDX secara end-of-day — angka asing di bawah ini per sesi
        ${escapeHtml(live.foreignFlowAsOf)}, bukan hari ini.
      </div>`
    : '';

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:760px;margin:0 auto;padding:24px 16px;">
    <div style="background:#0f172a;border-radius:14px 14px 0 0;padding:22px 24px;">
      <div style="color:#ffffff;font-size:19px;font-weight:800;letter-spacing:-0.3px;">
        Valuation<span style="color:#3b82f6;">Pro</span> · Stock Pick Harian
      </div>
      <div style="color:#94a3b8;font-size:12px;margin-top:5px;">
        ${escapeHtml(result.strategy.name)} · sesi ${escapeHtml(result.session)} · ${escapeHtml(trigger)}
      </div>
    </div>

    <div style="background:#ffffff;padding:22px 24px;">
      <p style="font-size:13px;line-height:1.65;color:#334155;margin:0 0 16px;">${escapeHtml(briefing)}</p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:6px;">
        <tr>
          ${statCell('Naik', String(breadth.advancers), '#059669')}
          ${statCell('Turun', String(breadth.decliners), '#dc2626')}
          ${statCell('Di atas MA200', `${(breadth.percentAboveSma200 * 100).toFixed(0)}%`, '#0f172a')}
          ${statCell('Net asing', `Rp ${fmt(breadth.netForeignIdrBn)} M`, breadth.netForeignIdrBn >= 0 ? '#059669' : '#dc2626')}
        </tr>
      </table>

      ${staleFlowNotice}

      <table style="width:100%;border-collapse:collapse;margin-top:8px;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="text-align:left;padding:9px 12px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.4px;">Emiten</th>
            <th style="text-align:left;padding:9px 12px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.4px;">Harga</th>
            <th style="text-align:left;padding:9px 12px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.4px;">Rencana</th>
            <th style="text-align:left;padding:9px 12px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.4px;">Peringatan</th>
          </tr>
        </thead>
        <tbody>${result.picks.map(pickRow).join('')}</tbody>
      </table>

      <p style="font-size:11px;color:#94a3b8;line-height:1.6;margin:20px 0 0;">
        Skor bersifat lintas-emiten terhadap ${result.eligibleSize} kandidat yang lolos filter dari
        ${result.universeSize} emiten tercatat — bukan prediksi return. Seluruh faktor dihitung dari harga,
        volume, nilai transaksi, dan arus dana asing yang dipublikasikan IDX; tidak ada faktor fundamental di
        dalam skor. Rencana perdagangan memakai ATR-14 dan sudah dibulatkan ke fraksi harga IDX.
        <strong>Ini alat riset, bukan rekomendasi investasi.</strong>
      </p>
    </div>

    <div style="background:#e2e8f0;border-radius:0 0 14px 14px;padding:14px 24px;font-size:11px;color:#64748b;">
      Dikirim otomatis oleh ValuationPro yang berjalan di komputer Anda.
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
    `ValuationPro — Stock Pick Harian (${input.result.strategy.name})`,
    `Sesi ${input.result.session} · ${input.trigger}`,
    '',
    input.briefing,
    '',
  ];
  for (const p of input.result.picks) {
    lines.push(
      `#${p.rank} ${p.emiten.code} — ${p.emiten.name} [${CONVICTION_TEXT[p.conviction]}, skor ${p.compositeScore.toFixed(2)}]`,
      `   Harga Rp ${fmt(p.factors.close)} · 3 bln ${pct(p.factors.return3m)} · vs IHSG ${pct(p.factors.relativeStrength3m)}`,
      `   Entry Rp ${fmt(p.plan.entry)} · Stop Rp ${fmt(p.plan.stopLoss)} · Target Rp ${fmt(p.plan.target1)} · ${fmt(p.plan.suggestedLots)} lot`,
      p.flags.length ? `   Peringatan: ${p.flags.join('; ')}` : '',
      ''
    );
  }
  lines.push('Alat riset, bukan rekomendasi investasi.');
  return lines.filter((l) => l !== undefined).join('\n');
}

export async function sendDigest(cfg: MailConfig, input: DigestInput): Promise<string> {
  const top = input.result.picks
    .slice(0, 3)
    .map((p) => p.emiten.code)
    .join(', ');
  const subject = `[ValuationPro] ${input.result.picks.length} pick · ${top || 'tidak ada kandidat'} · ${input.result.session}`;

  const info = await getTransporter(cfg).sendMail({
    from: cfg.from,
    to: cfg.to.join(', '),
    subject,
    text: renderDigestText(input),
    html: renderDigestHtml(input),
  });
  return info.messageId;
}
