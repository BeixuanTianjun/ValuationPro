import React, { useEffect, useState } from 'react';
import { Activity, AlertTriangle, Clock, Lock, Mail, RefreshCw, Radio, Send, WifiOff } from 'lucide-react';
import { MarketDatabase } from '../../data/marketRepository';
import { ServiceStatus, fetchServiceStatus, isStatusEndpointAbsent, triggerRefresh } from '../../data/chatClient';
import { sendTestAlert } from '../../data/authClient';

interface Props {
  db: MarketDatabase | null;
  onDataRefreshed: () => void;
  /** Epoch ms of the last successful quote load. */
  loadedAt: number;
  autoRefresh: boolean;
  setAutoRefresh: (on: boolean) => void;
  /** True while a background re-quote is in flight. */
  refreshing: boolean;
}

const PHASE_LABELS: Record<string, string> = {
  holiday: 'Hari libur bursa',
  'pre-open': 'Pra-pembukaan',
  'sesi-1': 'Sesi I',
  break: 'Istirahat',
  'sesi-2': 'Sesi II',
  closed: 'Pasar tutup',
  weekend: 'Akhir pekan',
};

const PHASE_TONE: Record<string, string> = {
  holiday: 'text-amber-400',
  'sesi-1': 'text-emerald-400',
  'sesi-2': 'text-emerald-400',
  break: 'text-amber-400',
  'pre-open': 'text-slate-400',
  closed: 'text-slate-400',
  weekend: 'text-slate-500',
};

/**
 * How many IDX sessions the official series is behind.
 *
 * WHY THIS IS NOT VISIBLE WITHOUT IT. The live overlay quotes Yahoo when the
 * page opens, so the price and the date beside it stay today's even when the
 * scheduled crawl has been dead for a week — and everything computed from the
 * official series (foreign flow, index attribution, every factor) quietly keeps
 * answering from the last session that did land. That is exactly the failure
 * that reads as "the deployment stopped updating" while the deployment is fine.
 *
 * IDX publishes end-of-day one to two sessions late by design, so being two
 * behind is normal and only three or more is worth an amber line.
 */
function sessionsBehind(official: string, asOf: string, holidays: string[]): number {
  if (!official || !asOf || official >= asOf) return 0;
  const skip = new Set(holidays);
  let n = 0;
  const d = new Date(`${official}T00:00:00Z`);
  const end = new Date(`${asOf}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || Number.isNaN(end.getTime())) return 0;
  // A guard, not a limit: a malformed date must not spin here.
  for (let i = 0; i < 400 && d < end; i++) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day === 0 || day === 6) continue;
    if (skip.has(d.toISOString().slice(0, 10))) continue;
    n++;
  }
  return n;
}

/** Today in Jakarta, as an ISO date — the browser may be anywhere. */
function todayWib(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

function ageLabel(minutes: number): string {
  if (minutes < 0) return 'belum ada';
  if (minutes < 1) return 'baru saja';
  if (minutes < 60) return `${minutes} mnt lalu`;
  const h = Math.floor(minutes / 60);
  if (h < 24) return `${h} jam lalu`;
  return `${Math.floor(h / 24)} hari lalu`;
}

/**
 * A single honest line about how fresh what you are looking at actually is.
 *
 * The distinction that matters on IDX: prices can be live while foreign-flow
 * factors are one or two sessions old, because IDX publishes buy/sell volume
 * only end-of-day. Collapsing those into one "live" badge would be a lie.
 */
/**
 * Seconds since a timestamp, ticking once a second.
 *
 * The point of this component is telling the truth about staleness, and a
 * static "diperbarui 12 detik lalu" that never moves is a worse lie than no
 * number at all.
 */
function useAge(since: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return since > 0 ? Math.max(0, Math.round((now - since) / 1000)) : -1;
}

export const LiveStatusBar: React.FC<Props> = ({
  db,
  onDataRefreshed,
  loadedAt,
  autoRefresh,
  setAutoRefresh,
  refreshing: autoRefreshing,
}) => {
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [checked, setChecked] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'ok' | 'error'>('ok');

  useEffect(() => {
    let alive = true;
    // The interval stops itself once the route turns out not to exist. On a
    // static deploy /api/status is never coming, and re-asking every minute only
    // produced a console error a minute — noise that hides real failures.
    let timer: ReturnType<typeof setInterval> | undefined;
    const poll = async () => {
      const s = await fetchServiceStatus();
      if (!alive) return;
      setStatus(s);
      setChecked(true);
      if (isStatusEndpointAbsent() && timer) {
        clearInterval(timer);
        timer = undefined;
      }
    };
    void poll();
    timer = setInterval(poll, 60_000);
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, []);

  const ageSeconds = useAge(loadedAt);

  const report = (text: string, tone: 'ok' | 'error') => {
    setMessage(text);
    setMessageTone(tone);
    // Failures stay on screen long enough to actually be read.
    setTimeout(() => setMessage(null), tone === 'error' ? 20000 : 6000);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setMessage(null);
    try {
      const detail = await triggerRefresh('intraday');
      report(detail, 'ok');
      onDataRefreshed();
    } catch (err) {
      report((err as Error).message, 'error');
    } finally {
      setRefreshing(false);
    }
  };

  const handleTestAlert = async () => {
    setTesting(true);
    setMessage(null);
    try {
      const detail = await sendTestAlert();
      report(detail, detail.includes('GAGAL') ? 'error' : 'ok');
    } catch (err) {
      report((err as Error).message, 'error');
    } finally {
      setTesting(false);
    }
  };

  const live = db?.live;
  const phase = status?.now?.phase || live?.sessionPhase || '';
  const behind = db
    ? sessionsBehind(db.meta.officialSession || db.meta.latestSession, todayWib(), db.meta.holidays || [])
    : 0;
  const intradayAge = status?.files?.['intraday.json']?.ageMinutes ?? -1;
  // A signed-out caller gets only { accountsExist, locked }, so every detail
  // below has to tolerate its absence.
  const detail = status && !status.locked ? status : null;

  return (
    <div className="bg-slate-900 border-b border-slate-800/80 px-4 sm:px-6 py-2.5">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] sm:gap-x-5">
        <div className="flex items-center gap-2">
          {phase === 'sesi-1' || phase === 'sesi-2' ? (
            <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse-dot" aria-hidden="true" />
          ) : (
            <Activity className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
          )}
          <span className={`font-bold ${PHASE_TONE[phase] || 'text-slate-400'}`}>
            {PHASE_LABELS[phase] || 'Status pasar tidak diketahui'}
          </span>
        </div>

        {loadedAt > 0 && (
          <span
            className="flex items-center gap-1.5 text-slate-500"
            title="Umur kuotasi yang sedang tampil di layar, dihitung sejak terakhir kali aplikasi menariknya."
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                autoRefreshing ? 'bg-cyan-400 animate-pulse-dot' : ageSeconds < 90 ? 'bg-emerald-400' : 'bg-amber-400'
              }`}
              aria-hidden="true"
            />
            {autoRefreshing ? 'mengutip ulang…' : ageSeconds < 2 ? 'baru saja' : `dikutip ${ageSeconds} dtk lalu`}
          </span>
        )}

        {db && (
          <span className="text-slate-500">
            Harga per <strong className="text-slate-300">{db.meta.latestSession}</strong>
            {live?.onDemand ? (
              <span
                className="text-emerald-400/90"
                title="Harga dikutip saat halaman dibuka, bukan dibaca dari snapshot"
              >
                {' '}
                · dikutip langsung
              </span>
            ) : (
              live?.applied && intradayAge >= 0 && <span className="text-slate-600"> · {ageLabel(intradayAge)}</span>
            )}
          </span>
        )}

        {live?.applied && (
          <span className="text-amber-400/80" title="IDX hanya menerbitkan volume beli/jual asing di akhir sesi">
            Arus asing per {live.foreignFlowAsOf}
          </span>
        )}

        {behind >= 3 && (
          <span
            className="flex items-center gap-1.5 font-semibold text-amber-300"
            title={`Seri resmi IDX berhenti di ${db?.meta.officialSession}. Harga di layar tetap dikutip langsung, tapi arus asing, atribusi indeks, dan seluruh faktor dihitung dari sesi resmi terakhir. Penyebab paling umum: ingest terjadwal (GitHub Actions) tidak jalan.`}
          >
            <AlertTriangle className="w-3 h-3" aria-hidden="true" />
            Seri resmi tertinggal {behind} sesi
          </span>
        )}

        {detail?.next && (
          <span className="flex items-center gap-1.5 text-slate-500">
            <Clock className="w-3 h-3" aria-hidden="true" />
            {detail.next.label} · {detail.next.atWib} WIB
          </span>
        )}

        {detail?.alerts && (
          <span className="flex items-center gap-1.5 text-slate-500">
            <Mail className="w-3 h-3" aria-hidden="true" />
            {detail.alerts.configured ? (
              <span className="text-emerald-400/90">
                Alert → {detail.alerts.to.join(', ')}
                {detail.alerts.recipientSource && (
                  <span className="text-slate-600"> ({detail.alerts.recipientSource})</span>
                )}
              </span>
            ) : (
              <span title={detail.alerts.note || ''}>Alert email belum diatur</span>
            )}
          </span>
        )}

        {status?.locked && (
          <span className="flex items-center gap-1.5 text-amber-400/90">
            <Lock className="w-3 h-3" aria-hidden="true" />
            Masuk untuk memakai refresh dan chatbot
          </span>
        )}

        <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:gap-3">
          {message && (
            <span
              className={`min-w-0 max-w-full sm:max-w-lg ${messageTone === 'ok' ? 'text-emerald-400' : 'text-rose-400'}`}
              role={messageTone === 'error' ? 'alert' : undefined}
            >
              {message}
            </span>
          )}

          <button
            type="button"
            onClick={() => setAutoRefresh(!autoRefresh)}
            aria-pressed={autoRefresh}
            title={
              autoRefresh
                ? 'Kutip ulang otomatis tiap 45 detik selama bursa buka. Matikan kalau Anda ingin angkanya diam.'
                : 'Kutip ulang otomatis dimatikan — angka di layar akan terus menua sampai Anda menekan Perbarui.'
            }
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-semibold transition-colors cursor-pointer touch-target ${
              autoRefresh
                ? 'bg-cyan-600/15 text-cyan-300 border border-cyan-600/40'
                : 'bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700'
            }`}
          >
            <Radio className="w-3 h-3" aria-hidden="true" />
            {autoRefresh ? 'Auto 45d' : 'Auto mati'}
          </button>

          {checked && !status ? (
            <span
              className="flex items-center gap-1.5 text-slate-500"
              title="Jalankan `npm run auto` untuk mengaktifkan refresh otomatis dan alert email"
            >
              <WifiOff className="w-3 h-3" aria-hidden="true" />
              Layanan otomatis mati
            </span>
          ) : (
            detail && (
              <>
                {detail.alerts?.configured && (
                  <button
                    onClick={() => void handleTestAlert()}
                    disabled={testing}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-300 font-semibold transition-colors cursor-pointer touch-target"
                    title="Kirim satu email digest sekarang untuk menguji SMTP"
                  >
                    <Send className={`w-3 h-3 ${testing ? 'animate-pulse' : ''}`} aria-hidden="true" />
                    {testing ? 'Mengirim…' : 'Uji alert'}
                  </button>
                )}
                <button
                  onClick={() => void handleRefresh()}
                  disabled={refreshing || !!detail.running}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-300 font-semibold transition-colors cursor-pointer touch-target"
                >
                  <RefreshCw className={`w-3 h-3 ${refreshing || detail.running ? 'animate-spin' : ''}`} aria-hidden="true" />
                  {refreshing || detail.running ? 'Memperbarui…' : 'Perbarui sekarang'}
                </button>
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
};
