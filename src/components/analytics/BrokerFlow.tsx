import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Building, Loader2, TrendingDown, TrendingUp, Users } from 'lucide-react';
import { BrokerFlowResult, BrokersFile, computeBrokerFlow } from '../../models/brokerFlow';

const num = (v: number, d = 0) => (Number.isFinite(v) ? v.toLocaleString('id-ID', { maximumFractionDigits: d }) : '–');
const pct = (v: number, d = 1) => (Number.isFinite(v) ? `${(v * 100).toFixed(d)}%` : '–');
const signedPct = (v: number, d = 2) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}pp` : '–');

const CLASS_COLORS: Record<string, string> = {
  institusi: 'bg-blue-500',
  campuran: 'bg-slate-500',
  ritel: 'bg-emerald-500',
};

const WINDOWS = [
  { sessions: 5, label: '1 minggu' },
  { sessions: 20, label: '1 bulan' },
  { sessions: 60, label: '3 bulan' },
];

export const BrokerFlow: React.FC = () => {
  const [file, setFile] = useState<BrokersFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [windowSessions, setWindowSessions] = useState(20);

  useEffect(() => {
    let alive = true;
    fetch(`${import.meta.env.BASE_URL || '/'}data/idx/brokers.json`.replace(/\/{2,}/g, '/'), { cache: 'no-cache' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j: BrokersFile) => alive && setFile(j))
      .catch(() => alive && setError('Data broker belum dibangun. Jalankan "npm run data:brokers".'));
    return () => {
      alive = false;
    };
  }, []);

  const result: BrokerFlowResult | null = useMemo(
    () => (file ? computeBrokerFlow(file, windowSessions) : null),
    [file, windowSessions]
  );

  if (error) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center">
        <AlertTriangle className="w-7 h-7 text-amber-400 mx-auto mb-3" aria-hidden="true" />
        <p className="text-sm text-slate-300">{error}</p>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex items-center justify-center gap-3 py-20 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
        <span className="text-sm">Memuat aktivitas anggota bursa…</span>
      </div>
    );
  }

  const maxShare = Math.max(...result.brokers.slice(0, 15).map((b) => b.marketShare), 0.01);

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-900/40 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-cyan-400" aria-hidden="true" />
              <h3 className="text-sm font-bold text-white">Broker Flow — struktur pelaku pasar</h3>
            </div>
            <p className="text-[11px] text-slate-500 mt-1.5">
              Sesi {result.session} · jendela {result.windowSessions} sesi · {result.brokers.length} anggota bursa
            </p>
          </div>
          <div className="flex gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800" role="group" aria-label="Jendela">
            {WINDOWS.map((w) => (
              <button
                key={w.sessions}
                onClick={() => setWindowSessions(w.sessions)}
                aria-pressed={windowSessions === w.sessions}
                className={`px-3 py-1.5 rounded text-[11px] font-bold transition-all cursor-pointer ${
                  windowSessions === w.sessions ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex gap-2 rounded-xl border border-amber-500/25 bg-amber-500/8 px-4 py-3">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" aria-hidden="true" />
          <p className="text-[11px] text-amber-200/90 leading-relaxed">
            <strong>IDX tidak menerbitkan rincian broker per saham ke publik.</strong> Yang tersedia hanya total
            volume, nilai, dan frekuensi tiap anggota bursa untuk seluruh pasar — jadi pertanyaan "broker mana yang
            mengakumulasi BBCA hari ini" tidak bisa dijawab dari sumber ini, dan alat mana pun yang mengklaim bisa
            memakai feed berbayar IDX Data Services. Yang bisa dibaca di sini adalah struktur pelakunya.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5 pt-5 border-t border-slate-800">
          <Stat label="Nilai transaksi" value={`Rp ${num(result.totalValueIdrBn / 1000, 1)} T`} hint="jendela terpilih" />
          <Stat label="Jumlah transaksi" value={num(result.totalTrades / 1e6, 1) + ' juta'} />
          <Stat label="Pangsa 10 besar" value={pct(result.top10Share)} hint="konsentrasi pasar" />
          <Stat label="Indeks HHI" value={result.concentration.toFixed(4)} hint="0 = tersebar, 1 = monopoli" />
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
        <h4 className="text-xs font-bold text-white">Ritel vs Institusi — dibaca dari ukuran tiket rata-rata</h4>
        <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed max-w-3xl">
          Nilai dibagi jumlah transaksi memberi ukuran tiket rata-rata tiap broker. Platform ritel mencetak ratusan
          ribu tiket kecil; rumah yang mengeksekusi order institusi dan asing mencetak jauh lebih sedikit tiket
          bernilai jauh lebih besar. Ini proksi, bukan klasifikasi resmi.
        </p>

        <div className="flex h-8 rounded-lg overflow-hidden mt-4 border border-slate-800">
          {result.participants
            .filter((p) => p.share > 0)
            .map((p) => (
              <div
                key={p.participant}
                className={`${CLASS_COLORS[p.participant]} flex items-center justify-center transition-all`}
                style={{ width: `${p.share * 100}%` }}
                title={`${p.label}: ${pct(p.share)}`}
              >
                {p.share > 0.08 && (
                  <span className="text-[10px] font-bold text-white/90">{pct(p.share, 0)}</span>
                )}
              </div>
            ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
          {result.participants.map((p) => (
            <div key={p.participant} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3.5">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${CLASS_COLORS[p.participant]}`} aria-hidden="true" />
                <span className="text-[11px] font-bold text-slate-200">{p.label}</span>
              </div>
              <div className="text-lg font-bold text-white tabular-nums mt-1.5">{pct(p.share)}</div>
              <div className="text-[10px] text-slate-500">
                {p.brokers} broker · tiket rata-rata Rp {num(p.averageTicketIdr / 1e6, 1)} juta
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-800">
            <Building className="w-4 h-4 text-cyan-400" aria-hidden="true" />
            <h4 className="text-xs font-bold text-white">Anggota Bursa Teraktif</h4>
          </div>
          <div className="divide-y divide-slate-800/60">
            {result.brokers.slice(0, 15).map((b, i) => (
              <div key={b.id} className="px-5 py-2.5">
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-slate-600 w-4 tabular-nums">{i + 1}</span>
                  <div className="w-10 shrink-0">
                    <span className="text-xs font-bold text-slate-100">{b.id}</span>
                  </div>
                  <div className="flex-1 h-2 bg-slate-950 rounded overflow-hidden">
                    <div
                      className={`h-full ${CLASS_COLORS[b.participant]}`}
                      style={{ width: `${(b.marketShare / maxShare) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs font-bold text-slate-100 tabular-nums w-12 text-right">
                    {pct(b.marketShare)}
                  </span>
                  <span
                    className={`text-[10px] font-semibold tabular-nums w-14 text-right ${
                      b.shareChange >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {signedPct(b.shareChange)}
                  </span>
                </div>
                <div className="text-[10px] text-slate-600 ml-[68px] truncate">
                  {b.name} · Rp {num(b.averageTicketIdr / 1e6, 1)} juta per transaksi
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <ShiftPanel
            title="Pangsa Naik"
            subtitle={`Dibanding ${result.windowSessions} sesi sebelumnya`}
            icon={<TrendingUp className="w-4 h-4 text-emerald-400" aria-hidden="true" />}
            rows={result.gainers}
          />
          <ShiftPanel
            title="Pangsa Turun"
            subtitle={`Dibanding ${result.windowSessions} sesi sebelumnya`}
            icon={<TrendingDown className="w-4 h-4 text-rose-400" aria-hidden="true" />}
            rows={result.losers}
          />
        </div>
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; hint?: string }> = ({ label, value, hint }) => (
  <div>
    <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">{label}</div>
    <div className="text-lg font-bold text-white tabular-nums">{value}</div>
    {hint && <div className="text-[10px] text-slate-500">{hint}</div>}
  </div>
);

const ShiftPanel: React.FC<{
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  rows: BrokerFlowResult['gainers'];
}> = ({ title, subtitle, icon, rows }) => (
  <div className="rounded-2xl border border-slate-800 bg-slate-900/50 overflow-hidden">
    <div className="px-5 py-3 border-b border-slate-800">
      <div className="flex items-center gap-2">
        {icon}
        <h4 className="text-xs font-bold text-white">{title}</h4>
      </div>
      <p className="text-[10px] text-slate-500 mt-0.5">{subtitle}</p>
    </div>
    <div className="divide-y divide-slate-800/60">
      {rows.map((b) => (
        <div key={b.id} className="flex items-center justify-between px-5 py-2">
          <div className="min-w-0">
            <span className="text-xs font-bold text-slate-100">{b.id}</span>
            <span className="text-[10px] text-slate-500 ml-2 truncate">{b.name}</span>
          </div>
          <div className="text-right shrink-0">
            <div
              className={`text-xs font-bold tabular-nums ${b.shareChange >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}
            >
              {signedPct(b.shareChange)}
            </div>
            <div className="text-[10px] text-slate-500 tabular-nums">{pct(b.marketShare)} pangsa</div>
          </div>
        </div>
      ))}
    </div>
  </div>
);
