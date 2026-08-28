import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Bell,
  Building2,
  Calculator,
  Globe2,
  LineChart,
  LogIn,
  MessageSquare,
  Network,
  Scale,
  ShieldCheck,
  Target,
  Zap,
} from 'lucide-react';
import { MarketDatabase } from '../../data/marketRepository';
import { IndexQuote } from '../../types/market';
import { AccountUser } from '../../data/authClient';
import { CHART } from '../../theme/chart';

interface Props {
  db: MarketDatabase | null;
  indices: IndexQuote[];
  loading: boolean;
  account: AccountUser | null;
  /** False when the local service is not running; sign-in is then meaningless. */
  serviceUp: boolean;
  authChecked: boolean;
  onOpenAuth: () => void;
  onEnter: (destination: 'market' | 'screener' | 'watchlist' | 'emiten' | 'chat' | 'dcf' | 'analytics') => void;
}

const pct = (v: number, d = 2) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%` : '–');
const idr = (v: number, d = 0) => (Number.isFinite(v) ? v.toLocaleString('id-ID', { maximumFractionDigits: d }) : '–');

/**
 * The hero chart is drawn from the real IHSG series when the database has
 * loaded, and from a neutral placeholder before that — never from invented
 * numbers dressed up as market data.
 */
function useHeroSeries(indices: IndexQuote[]): { points: string; area: string; real: boolean } {
  return useMemo(() => {
    const composite = indices.find((i) => i.code === 'COMPOSITE');
    const W = 1000;
    const H = 260;

    let values: number[];
    let real = false;

    if (composite && composite.closes.length > 20) {
      const raw = Array.from(composite.closes).filter((v) => Number.isFinite(v) && v > 0);
      const step = Math.max(1, Math.floor(raw.length / 120));
      values = raw.filter((_, i) => i % step === 0);
      real = true;
    } else {
      values = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 6) * 8 + i * 0.35);
    }

    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const coords = values.map((v, i) => {
      const x = (i / (values.length - 1)) * W;
      const y = H - ((v - min) / span) * (H - 30) - 15;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    return {
      points: coords.join(' '),
      area: `0,${H} ${coords.join(' ')} ${W},${H}`,
      real,
    };
  }, [indices]);
}

const FEATURES = [
  {
    icon: Building2,
    title: '962 emiten tercatat',
    body: 'Seluruh papan IDX beserta sektor IDX-IC, sub-industri, kapitalisasi, dan likuiditas — bukan sekadar daftar blue chip.',
    accent: 'text-blue-400',
    ring: 'group-hover:border-blue-500/40',
  },
  {
    icon: Target,
    title: 'Stock pick harian',
    body: 'Enam profil strategi memeringkat semesta lewat momentum, tren, arus dana asing, dan likuiditas — lengkap dengan entry, stop, dan ukuran posisi.',
    accent: 'text-emerald-400',
    ring: 'group-hover:border-emerald-500/40',
  },
  {
    icon: Zap,
    title: 'Refresh otomatis',
    body: 'Harga diperbarui tiap 15 menit selama sesi, lalu disaring ulang begitu Sesi I ditutup dan setelah pasar tutup.',
    accent: 'text-amber-400',
    ring: 'group-hover:border-amber-500/40',
  },
  {
    icon: Bell,
    title: 'Alert ke email',
    body: 'Ringkasan pick dikirim otomatis pukul 12:05 dan 16:20 WIB, lengkap dengan rencana perdagangan dan peringatan risikonya.',
    accent: 'text-rose-400',
    ring: 'group-hover:border-rose-500/40',
  },
  {
    icon: MessageSquare,
    title: 'Chatbot pencari emiten',
    body: '"Saham batu bara P/E di bawah 10 yang likuid" — dijawab dengan menyaring database sungguhan, bukan dari ingatan model.',
    accent: 'text-indigo-400',
    ring: 'group-hover:border-indigo-500/40',
  },
  {
    icon: Scale,
    title: 'Leaders & Laggards',
    body: 'Berapa poin indeks yang benar-benar disumbang tiap emiten, dihitung dari bobot free-float resmi IDX — rekonsiliasi dengan IHSG sampai 0,01 poin.',
    accent: 'text-sky-400',
    ring: 'group-hover:border-sky-500/40',
  },
  {
    icon: Network,
    title: 'Rotasi konglomerasi',
    body: 'Mengukur apakah anggota satu grup memang bergerak bersama, lalu menunjukkan siapa yang paling tertinggal — dengan bukti korelasinya, bukan asumsi.',
    accent: 'text-violet-400',
    ring: 'group-hover:border-violet-500/40',
  },
  {
    icon: Calculator,
    title: 'Model DCF & LBO',
    body: 'Kalibrasi otomatis dari laporan keuangan riil, beta diregresikan ke IHSG, dan setiap asumsi yang rapuh ditandai terbuka.',
    accent: 'text-cyan-400',
    ring: 'group-hover:border-cyan-500/40',
  },
];

export const LandingPage: React.FC<Props> = ({
  db,
  indices,
  loading,
  account,
  serviceUp,
  authChecked,
  onOpenAuth,
  onEnter,
}) => {
  const hero = useHeroSeries(indices);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const composite = indices.find((i) => i.code === 'COMPOSITE');
  const ticker = useMemo(() => {
    if (!db) return [];
    return db.emiten
      .map((e) => ({ e, q: db.daily.get(e.code) }))
      .filter((r) => r.q && r.q.value > 0)
      .sort((a, b) => (b.q!.value || 0) - (a.q!.value || 0))
      .slice(0, 22)
      .map((r) => ({ code: r.e.code, price: r.q!.close, change: r.q!.change }));
  }, [db]);

  const stats = useMemo(
    () => [
      { label: 'Emiten tercatat', value: db ? idr(db.emiten.length) : '962' },
      { label: 'Indeks dipantau', value: db ? idr(db.indexSeries.size) : '45' },
      { label: 'Sesi riwayat', value: db ? idr(db.meta.sessions) : '282' },
      { label: 'Sektor IDX-IC', value: '11' },
    ],
    [db]
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 overflow-x-hidden">
      {/* ---------------------------------------------------------------- hero */}
      <section className="relative min-h-[92vh] flex flex-col">
        <div className="absolute inset-0 grid-glow opacity-40" aria-hidden="true" />
        <div
          className="absolute inset-x-0 top-0 h-[560px] bg-[radial-gradient(ellipse_at_top,rgba(59,130,246,0.16),transparent_62%)]"
          aria-hidden="true"
        />

        {/* Live IHSG line, drawn on entry */}
        <svg
          className="absolute bottom-0 left-0 w-full h-[42vh] min-h-[220px]"
          viewBox="0 0 1000 260"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="heroFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART.blue} stopOpacity="0.22" />
              <stop offset="100%" stopColor={CHART.blue} stopOpacity="0" />
            </linearGradient>
            <linearGradient id="heroStroke" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={CHART.violet} />
              <stop offset="55%" stopColor={CHART.blue} />
              <stop offset="100%" stopColor={CHART.green} />
            </linearGradient>
          </defs>
          {mounted && (
            <>
              <polygon points={hero.area} fill="url(#heroFill)" className="animate-fade" style={{ animationDelay: '900ms' }} />
              <polyline
                points={hero.points}
                fill="none"
                stroke="url(#heroStroke)"
                strokeWidth="2.2"
                strokeLinejoin="round"
                strokeLinecap="round"
                className="animate-draw"
                style={{ ['--dash' as string]: '2600' }}
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}
        </svg>

        <header className="relative z-10 max-w-7xl mx-auto w-full px-4 sm:px-6 py-4 sm:py-6 flex items-center justify-between">
          <div className="flex items-center gap-3 animate-rise">
            <div className="w-10 h-10 rounded-xl bg-amber-500 flex items-center justify-center shadow-lg shadow-blue-900/40">
              <LineChart className="w-5 h-5 text-white" aria-hidden="true" />
            </div>
            <div>
              <div className="text-lg font-extrabold tracking-tight">
                Valuation<span className="text-amber-500">Pro</span>
              </div>
              <div className="text-[11px] text-slate-500 -mt-0.5">Terminal Pasar Modal Indonesia</div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 animate-rise" style={{ animationDelay: '80ms' }}>
            {authChecked && serviceUp && (
              account ? (
                <div className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-900/80 border border-slate-800">
                  <ShieldCheck
                    className={`w-3.5 h-3.5 ${account.role === 'administrator' ? 'text-blue-400' : 'text-slate-500'}`}
                    aria-hidden="true"
                  />
                  <span className="text-xs font-semibold text-slate-300">{account.name}</span>
                </div>
              ) : (
                <button
                  onClick={onOpenAuth}
                  className="hidden sm:flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-sm font-semibold transition-all duration-200 cursor-pointer"
                >
                  <LogIn className="w-4 h-4" aria-hidden="true" />
                  Masuk
                </button>
              )
            )}

            <button
              onClick={() => onEnter('market')}
              className="hidden sm:flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-sm font-semibold transition-all duration-200 cursor-pointer"
            >
              Buka Terminal
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="relative z-10 flex-1 flex items-center">
          <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-8 sm:py-10">
            <div className="max-w-3xl">
              <div
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-xs font-semibold animate-rise"
                style={{ animationDelay: '120ms' }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-dot" aria-hidden="true" />
                {loading
                  ? 'Memuat basis data pasar…'
                  : db
                    ? `Data per sesi ${db.meta.latestSession}`
                    : 'Basis data belum dibangun'}
              </div>

              <h1
                className="mt-6 text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.06] text-balance animate-rise"
                style={{ animationDelay: '200ms' }}
              >
                Seluruh bursa Indonesia,
                <br />
                <span className="bg-gradient-to-r from-blue-400 via-indigo-400 to-emerald-400 bg-clip-text text-transparent">
                  dalam satu terminal.
                </span>
              </h1>

              <p
                className="mt-6 text-base sm:text-lg text-slate-400 leading-relaxed max-w-2xl animate-rise"
                style={{ animationDelay: '280ms' }}
              >
                962 emiten, 45 indeks, dan arus dana asing harian — disaring tiap hari menjadi ide yang bisa
                dieksekusi, lalu dimodelkan dengan DCF dan LBO tingkat institusional.
              </p>

              <div className="mt-9 flex flex-wrap gap-3 animate-rise" style={{ animationDelay: '360ms' }}>
                <button
                  onClick={() => onEnter('screener')}
                  className="group flex items-center justify-center gap-2 px-5 sm:px-6 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold shadow-lg shadow-blue-900/40 transition-all duration-200 cursor-pointer"
                >
                  <Target className="w-4 h-4" aria-hidden="true" />
                  Jalankan Screener Hari Ini
                  <ArrowRight
                    className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-1"
                    aria-hidden="true"
                  />
                </button>
                <button
                  onClick={() => onEnter('analytics')}
                  className="flex items-center justify-center gap-2 px-5 sm:px-6 py-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 font-bold transition-all duration-200 cursor-pointer"
                >
                  <Scale className="w-4 h-4 text-cyan-400" aria-hidden="true" />
                  Penggerak IHSG
                </button>
                <button
                  onClick={() => onEnter('chat')}
                  className="flex items-center justify-center gap-2 px-5 sm:px-6 py-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 font-bold transition-all duration-200 cursor-pointer"
                >
                  <MessageSquare className="w-4 h-4 text-indigo-400" aria-hidden="true" />
                  Tanya Emiten
                </button>
              </div>

              {composite && (
                <div className="mt-10 flex flex-wrap items-end gap-x-8 gap-y-4 animate-rise" style={{ animationDelay: '440ms' }}>
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">IHSG</div>
                    <div className="flex items-baseline gap-3">
                      <span className="text-3xl font-extrabold tabular-nums">{idr(composite.close, 2)}</span>
                      <span
                        className={`text-sm font-bold tabular-nums ${
                          composite.changePercent >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {pct(composite.changePercent)}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-6">
                    {(['1 Bln', '3 Bln', 'YTD'] as const).map((label, i) => {
                      const v = [composite.return1m, composite.return3m, composite.ytd][i];
                      return (
                        <div key={label}>
                          <div className="text-[10px] uppercase text-slate-500 font-semibold">{label}</div>
                          <div
                            className={`text-sm font-bold tabular-nums ${
                              v >= 0 ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {pct(v, 1)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Live tape */}
        {ticker.length > 0 && (
          <div className="relative z-10 border-y border-slate-800/70 bg-slate-950/80 backdrop-blur-sm overflow-hidden">
            <div className="flex animate-marquee w-max" aria-hidden="true">
              {[0, 1].map((copy) => (
                <div key={copy} className="flex">
                  {ticker.map((t) => (
                    <div key={`${copy}-${t.code}`} className="flex items-center gap-2 px-5 py-3 border-r border-slate-800/50">
                      <span className="text-xs font-bold text-slate-300">{t.code}</span>
                      <span className="text-xs text-slate-500 tabular-nums">{idr(t.price)}</span>
                      <span
                        className={`text-xs font-semibold tabular-nums ${
                          t.change >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {t.change >= 0 ? '+' : ''}
                        {t.change.toFixed(2)}%
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------- stats */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger">
          {stats.map((s, i) => (
            <div
              key={s.label}
              className="rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-6 animate-rise"
              style={{ ['--i' as string]: i }}
            >
              <div className="text-3xl font-extrabold tabular-nums bg-gradient-to-br from-white to-slate-400 bg-clip-text text-transparent">
                {s.value}
              </div>
              <div className="text-xs text-slate-500 font-semibold mt-1.5">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------- features */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-12 sm:pb-16">
        <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-balance">
          Dibangun untuk keputusan, bukan untuk pajangan
        </h2>
        <p className="mt-3 text-slate-400 max-w-2xl leading-relaxed">
          Setiap angka bisa ditelusuri ke sumbernya di IDX. Ketika data tidak memadai — bank yang tidak melaporkan
          EBITDA, emiten yang melapor dalam dolar, arus asing yang belum terbit — aplikasi mengatakannya, bukan
          menutupinya.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-10 stagger">
          {FEATURES.map((f, i) => (
            <div
              key={f.title}
              className={`group rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-6 transition-all duration-300 hover:bg-slate-900/80 ${f.ring} animate-rise`}
              style={{ ['--i' as string]: i }}
            >
              <div className="w-11 h-11 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center transition-transform duration-300 group-hover:scale-105">
                <f.icon className={`w-5 h-5 ${f.accent}`} aria-hidden="true" />
              </div>
              <h3 className="mt-4 font-bold text-[15px]">{f.title}</h3>
              <p className="mt-2 text-[13px] text-slate-400 leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* -------------------------------------------------------- provenance */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-14 sm:pb-20">
        <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900/80 to-slate-950 p-8 sm:p-10">
          <div className="flex items-start gap-4">
            <ShieldCheck className="w-6 h-6 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="flex-1">
              <h2 className="text-xl font-bold">Dari mana datanya</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-4 mt-5 text-[13px]">
                <div>
                  <div className="flex items-center gap-2 font-semibold text-slate-200">
                    <Globe2 className="w-3.5 h-3.5 text-blue-400" aria-hidden="true" />
                    API resmi IDX
                  </div>
                  <p className="mt-1.5 text-slate-400 leading-relaxed">
                    Universe emiten, profil perusahaan, OHLC harian, 45 indeks, dan volume beli/jual asing —
                    langsung dari <code className="text-blue-400">idx.co.id</code>, tanpa perantara.
                  </p>
                </div>
                <div>
                  <div className="flex items-center gap-2 font-semibold text-slate-200">
                    <LineChart className="w-3.5 h-3.5 text-indigo-400" aria-hidden="true" />
                    Laporan keuangan &amp; harga live
                  </div>
                  <p className="mt-1.5 text-slate-400 leading-relaxed">
                    Laporan tahunan 648 emiten dan rasio valuasi dari Yahoo Finance, karena IDX hanya menerbitkan
                    XBRL mentah. Harga intraday juga dari sana — feed IDX bersifat end-of-day.
                  </p>
                </div>
              </div>

              <div className="mt-6 pt-5 border-t border-slate-800 text-[12px] text-slate-500 leading-relaxed">
                Skor penyaring dihitung lintas-emiten dari harga, volume, nilai transaksi, dan arus dana asing —
                bukan prediksi return.{' '}
                <strong className="text-slate-400">Ini alat riset, bukan rekomendasi investasi.</strong>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-800 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-600">
          <span>ValuationPro · Terminal Pasar Modal Indonesia</span>
          <button
            onClick={() => onEnter('market')}
            className="flex items-center text-slate-400 hover:text-blue-400 font-semibold transition-colors cursor-pointer touch-target"
          >
            Buka terminal →
          </button>
        </div>
      </footer>
    </div>
  );
};
