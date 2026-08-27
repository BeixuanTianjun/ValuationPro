import React, { useEffect, useState } from 'react';
import { Activity, Clock, Lock, Mail, RefreshCw, Radio, Send, WifiOff } from 'lucide-react';
import { MarketDatabase } from '../../data/marketRepository';
import { ServiceStatus, fetchServiceStatus, triggerRefresh } from '../../data/chatClient';
import { sendTestAlert } from '../../data/authClient';

interface Props {
  db: MarketDatabase | null;
  onDataRefreshed: () => void;
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
export const LiveStatusBar: React.FC<Props> = ({ db, onDataRefreshed }) => {
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [checked, setChecked] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'ok' | 'error'>('ok');

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const s = await fetchServiceStatus();
      if (!alive) return;
      setStatus(s);
      setChecked(true);
    };
    void poll();
    const timer = setInterval(poll, 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

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
  const intradayAge = status?.files?.['intraday.json']?.ageMinutes ?? -1;
  // A signed-out caller gets only { accountsExist, locked }, so every detail
  // below has to tolerate its absence.
  const detail = status && !status.locked ? status : null;

  return (
    <div className="bg-slate-900/60 border-b border-slate-800/80 px-4 sm:px-6 py-2.5">
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
