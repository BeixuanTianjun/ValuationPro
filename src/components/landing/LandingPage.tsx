import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Bell,
  Briefcase,
  Building2,
  Calculator,
  CalendarDays,
  Check,
  ClipboardList,
  FlaskConical,
  Globe,
  Globe2,
  LineChart,
  LogIn,
  MessageSquare,
  Network,
  Newspaper,
  Radar,
  Scale,
  Search,
  ShieldCheck,
  Ship,
  Target,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { MarketDatabase } from '../../data/marketRepository';
import { IndexQuote } from '../../types/market';
import { AccountUser } from '../../data/authClient';
import { TERMINAL_FUNCTIONS, isRecentlyAdded } from '../../data/functions';
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

/**
 * The strategy board header, fetched for the proof band.
 *
 * 36 KB, and it carries the single most checkable claim on this page: how many
 * rule sets were tested and how few survived an out-of-sample split. Worth one
 * request. `announcements.json` is deliberately NOT fetched here — it is 712 KB
 * and the only thing this page would want from it is one count, which is not a
 * trade anybody should make on a first paint.
 */
function useStrategyFacts(): { tested: number; survivors: number; sessions: number } | null {
  const [facts, setFacts] = useState<{ tested: number; survivors: number; sessions: number } | null>(null);
  useEffect(() => {
    let alive = true;
    const url = `${import.meta.env.BASE_URL || '/'}data/idx/strategies.json`.replace(/\/{2,}/g, '/');
    void fetch(url, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('no file'))))
      .then((f: { ruleSetsTested?: number; survivors?: number; sessions?: number }) => {
        if (!alive) return;
        if (Number.isFinite(f.ruleSetsTested) && Number.isFinite(f.survivors)) {
          setFacts({ tested: f.ruleSetsTested!, survivors: f.survivors!, sessions: f.sessions ?? 0 });
        }
      })
      .catch(() => {
        /* the band renders without it rather than printing a made-up number */
      });
    return () => {
      alive = false;
    };
  }, []);
  return facts;
}

/*
 * The front page is where a returning visitor decides whether anything changed.
 * A screen that ships without a card here is invisible to anyone who does not
 * already know to open the launcher and read eighteen rows — which is how the
 * macro layer and the chokepoint map spent a day being "missing from the
 * deploy" while sitting on the deploy the whole time.
 *
 * GROUPED BY THE JOB, NOT LISTED FLAT. The previous version put eleven cards in
 * one grid, which gave every screen identical weight and therefore gave none of
 * them any: a spec sheet, not a page. It had also drifted out of date in the
 * way a flat list always does — it still advertised RISK, a screen that was
 * deleted, and said nothing at all about six screens that shipped after it.
 *
 * `code` ties a card to its function in the registry, so the BARU chip lights
 * up and expires from the same date the launcher uses.
 */
const GROUPS: {
  key: string;
  eyebrow: string;
  title: string;
  blurb: string;
  items: { icon: React.ElementType; code: string; title: string; body: string; accent: string }[];
}[] = [
  {
    key: 'saring',
    eyebrow: '01 · Menyaring',
    title: 'Dari 962 emiten jadi segelintir',
    blurb: 'Aturan keras, bukan skor gabungan. Lolos atau nggak, dan kelihatan gagalnya di kolom mana.',
    items: [
      {
        icon: Target,
        code: 'SCR',
        title: 'Screener tiga setup',
        body: 'Momentum, antre beli pas lagi diskon, atau yang ketinggalan dari indeksnya. Ada kotak "kenapa saham gue nggak lolos".',
        accent: 'text-emerald-400',
      },
      {
        icon: Radar,
        code: 'RDR',
        title: 'Radar peristiwa',
        body: 'Yang belum gerak, tapi filing-nya sudah bilang sesuatu. Ganti pemilik, ganti nama, transaksi material — sebelum tapenya ikut bicara. Belum teruji, dan layarnya bilang begitu.',
        accent: 'text-amber-400',
      },
      {
        icon: CalendarDays,
        code: 'WL',
        title: 'Watchlist bernarasi',
        body: 'Harus ada pemicunya dulu — pengajuan ke bursa atau tema kebijakan. Yang cuma naik doang itu urusan screener.',
        accent: 'text-indigo-400',
      },
      {
        icon: ClipboardList,
        code: 'JRN',
        title: 'Jurnal winrate',
        body: 'Tiap pick dicatat sebelum hasilnya ketahuan, dinilai maju 1–3 bulan. Ada laporan Excel. Lokal aja.',
        accent: 'text-violet-300',
      },
      {
        icon: Briefcase,
        code: 'PORT',
        title: 'Portofolio sendiri',
        body: 'Posisi lo dihargai live, dibaca pakai aturan yang sama. Nggak pernah nyuruh jual.',
        accent: 'text-blue-400',
      },
    ],
  },
  {
    key: 'jelaskan',
    eyebrow: '02 · Menjelaskan',
    title: 'Kenapa harganya gerak, bukan cuma berapa',
    blurb: 'Siapa yang narik indeks, grup mana yang duitnya pindah, dan apa yang sebenernya diajuin emiten ke bursa.',
    items: [
      {
        icon: Scale,
        code: 'MOST',
        title: 'Leaders & Laggards',
        body: 'IHSG turun 24 poin, gara-gara siapa? Dihitung dari bobot free float resmi IDX.',
        accent: 'text-sky-400',
      },
      {
        icon: Network,
        code: 'CNG',
        title: 'Rotasi konglomerasi',
        body: 'Dicek dulu anggotanya emang gerak bareng apa nggak, baru ditunjuk siapa yang ketinggalan.',
        accent: 'text-violet-400',
      },
      {
        icon: Newspaper,
        code: 'CN',
        title: 'Keterbukaan informasi',
        body: '4.002 pengajuan resmi, PDF asli satu klik. Klik detailnya, AI-nya baca isi PDF-nya — bukan judulnya.',
        accent: 'text-amber-400',
      },
      {
        icon: LineChart,
        code: 'MKT',
        title: 'Ringkasan pasar',
        body: 'IHSG, 45 indeks, breadth, penggerak poin hari ini. Tempat mampir sebelum nyaring apa-apa.',
        accent: 'text-emerald-300',
      },
      {
        icon: MessageSquare,
        code: 'CHAT',
        title: 'Tanya emiten',
        body: 'Ketik "kupas PTBA" atau "batu bara P/E di bawah 10 yang likuid". Nyaring database beneran, bukan ngarang.',
        accent: 'text-indigo-400',
      },
    ],
  },
  {
    key: 'luar',
    eyebrow: '03 · Konteks dari luar',
    title: 'Yang narik pasar kita dari seberang',
    blurb: 'Empat lapisan di luar IDX. Hasilnya lemah buat hampir semua sektor — dan layarnya bilang lemah, emang itu jawabannya.',
    items: [
      {
        icon: Globe,
        code: 'MACRO',
        title: 'Penggerak global',
        body: '29 aset luar — kurs, minyak, batu bara, bunga, kripto. Diukur seberapa nempel ke tiap sektor sini.',
        accent: 'text-amber-400',
      },
      {
        icon: Ship,
        code: 'MAP',
        title: 'Peta selat dunia',
        body: '28 selat kunci, lima di antaranya perairan kita, plus alert pelabuhan tutup. Konteks, bukan klaim.',
        accent: 'text-cyan-400',
      },
      {
        icon: Zap,
        code: 'TNKR',
        title: 'Tanker & freight',
        body: 'Enam proksi tarif charter. Korelasinya ke emiten pelayaran kita 0,02 — praktis nggak nyambung.',
        accent: 'text-teal-300',
      },
      {
        icon: Bell,
        code: 'NEWS',
        title: 'Berita & kalender',
        body: 'Lima kantor berita plus kalender ekonomi. Penautan ke kode emiten sengaja ketat.',
        accent: 'text-rose-400',
      },
    ],
  },
  {
    key: 'nilai',
    eyebrow: '04 · Menilai',
    title: 'Model yang berani nolak ngitung',
    blurb: 'Dari laporan keuangan asli, bukan rasio siap saji. Emiten yang nggak cocok dimodelin gini ditolak, bukan dipaksain.',
    items: [
      {
        icon: Calculator,
        code: 'DCF',
        title: 'Model DCF',
        body: 'Arus kas bebas dari laporan asli. Bank sama asuransi ditolak, emang nggak cocok dimodelin gini.',
        accent: 'text-cyan-400',
      },
      {
        icon: Scale,
        code: 'LBO',
        title: 'Model LBO',
        body: 'Struktur utang, jadwal amortisasi, jembatan IRR. Asumsi yang rapuh dikasih tanda.',
        accent: 'text-blue-300',
      },
      {
        icon: Search,
        code: 'AVAL',
        title: 'Valuasi otomatis',
        body: 'DCF massal seluruh emiten. Ini penyaring, bukan valuasi — properti sama komoditas sering keluar aneh.',
        accent: 'text-blue-400',
      },
      {
        icon: Users,
        code: 'FUND',
        title: 'Register KSEI',
        body: 'Kepemilikan bulanan per emiten, dipecah sembilan jenis investor. Reksa dana nambah apa ngurangin.',
        accent: 'text-emerald-400',
      },
      {
        icon: Building2,
        code: 'DES',
        title: 'Basis data emiten',
        body: 'Profil, harga, faktor, laporan keuangan 962 emiten. Buat pas lo cuma mau ngecek satu nama.',
        accent: 'text-slate-300',
      },
    ],
  },
];

/** Is the screen behind this card still flagged new in the function registry? */
function isNewFeature(code: string): boolean {
  const fn = TERMINAL_FUNCTIONS.find((f) => f.code === code);
  return !!fn && isRecentlyAdded(fn);
}

/**
 * The comparison band.
 *
 * This is the page's argument, and it is about METHOD, not about people. The
 * reference layout that inspired this section sorted its readers into two types
 * and flattered one of them; that device sells a course and would be a lie
 * here. What can be said honestly is how the two ways of building this kind of
 * tool differ — and every line on the right is something in the app that can be
 * opened and checked, which is exactly why the left column is not a strawman.
 */
const CONTRAST: { biasa: string; sini: string }[] = [
  {
    biasa: 'Satu skor sakti. Kenapa nomor satu di atas? Ya percaya aja.',
    sini: 'Lolos atau nggak, per aturan. Ada kotak yang bilang gagalnya di mana.',
  },
  {
    biasa: 'Daftar "saham potensial" tanpa harga masuk, tanpa batas rugi.',
    sini: 'Entry, stop, target — dihitung dari ATR saham itu sendiri.',
  },
  {
    biasa: 'Backtest yang cuma nunjukin strategi yang menang.',
    sini: 'Yang gagal ikut dipajang, lengkap sama matinya di gerbang mana.',
  },
  {
    biasa: 'Ngaku winrate 80% tanpa catatan yang bisa dicek.',
    sini: 'Tiap pick dicatat sebelum hasilnya ketahuan. Angkanya ditahan sampai sampelnya cukup.',
  },
  {
    biasa: 'Data kosong ditambal proksi biar tabelnya penuh.',
    sini: 'Kosong ya ditulis kosong. CPO sama nikel sampai sekarang masih bolong.',
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
  const strategy = useStrategyFacts();
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

  /**
   * COUNTS ARE READ FROM THE DATABASE, NEVER TYPED INTO THE PROSE.
   *
   * The first draft of this page hardcoded "716 sesi riwayat" in the hero and
   * "45 indeks" in the provenance box while the tiles below computed 715 and 46
   * from the same `db` — two numbers on one page disagreeing about one fact,
   * which in this repo is not a typo but a traceability failure. Anything
   * countable comes from `db` here; prose that cannot take a live number says
   * the thing qualitatively instead ("seluruh indeks resmi").
   */
  const stats = useMemo(
    () => [
      { value: db ? idr(db.emiten.length) : '962', label: 'Emiten', sub: 'satu papan IDX, nggak cuma blue chip' },
      // The fallbacks are what shows before the database loads, so they have to
      // match what the live values will say a second later — 716 here against
      // 715 in the hero was the same two-numbers-one-fact bug in miniature.
      { value: db ? idr(db.meta.sessions) : '715', label: 'Sesi riwayat', sub: 'udah disesuaikan aksi korporasi' },
      { value: db ? idr(db.indexSeries.size) : '46', label: 'Indeks', sub: 'IHSG, LQ45, 11 sektor' },
      { value: String(TERMINAL_FUNCTIONS.length), label: 'Layar', sub: 'ketik kodenya, Enter' },
    ],
    // The backtest count deliberately does NOT appear here. It already carries
    // its own band further down with the context that makes it mean something
    // — the train/test split and the win-rate haircut — and a number that large
    // reduced to one tile invites exactly the reading that band exists to
    // prevent. Four tiles also divide evenly at every breakpoint; five left an
    // orphan on the second row at anything under 1024px.
    [db]
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 overflow-x-hidden">
      {/* ---------------------------------------------------------------- hero */}
      <section className="relative min-h-[94vh] flex flex-col">
        <div className="absolute inset-0 grid-glow opacity-40" aria-hidden="true" />
        <div
          className="absolute inset-x-0 top-0 h-[620px] bg-[radial-gradient(ellipse_at_top,rgba(255,167,51,0.07),transparent_62%)]"
          aria-hidden="true"
        />

        <svg
          className="absolute bottom-0 left-0 w-full h-[42vh] min-h-[220px]"
          viewBox="0 0 1000 260"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            {/* SATU warna, bukan tiga.
                Palet ini Bloomberg: hitam murni sebagai lantai, amber sebagai
                satu-satunya tanda tangan. Gradasi violet-biru-hijau di sini
                melawannya — tiga warna yang berebut perhatian pada satu garis
                membuat halaman terbaca seperti template, bukan seperti alat.
                Garisnya sekarang meredup dari amber ke transparan, jadi ia
                membingkai teks alih-alih bersaing dengannya. */}
            <linearGradient id="heroFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART.amber} stopOpacity="0.10" />
              <stop offset="100%" stopColor={CHART.amber} stopOpacity="0" />
            </linearGradient>
            <linearGradient id="heroStroke" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={CHART.amber} stopOpacity="0.15" />
              <stop offset="50%" stopColor={CHART.amber} stopOpacity="0.85" />
              <stop offset="100%" stopColor={CHART.amber} stopOpacity="0.25" />
            </linearGradient>
          </defs>
          {mounted && (
            <>
              <polygon points={hero.area} fill="url(#heroFill)" className="animate-fade" style={{ animationDelay: '900ms' }} />
              <polyline
                points={hero.points}
                fill="none"
                stroke="url(#heroStroke)"
                strokeWidth="1.4"
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
            {/* Bayangannya dulu biru di bawah kotak amber — dua warna yang
                tidak pernah bertemu di palet ini. Diganti hairline. */}
            <div className="w-10 h-10 rounded-lg bg-amber-400 flex items-center justify-center">
              <LineChart className="w-5 h-5 text-slate-950" aria-hidden="true" />
            </div>
            <div>
              <div className="text-lg font-semibold tracking-[-0.02em] text-slate-50">
                Valuation<span className="text-amber-500">Pro</span>
              </div>
              <div className="text-[11px] text-slate-500 -mt-0.5">Terminal Pasar Modal Indonesia</div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 animate-rise" style={{ animationDelay: '80ms' }}>
            {authChecked && serviceUp && (
              account ? (
                <div className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/80 border border-slate-800">
                  <ShieldCheck
                    className={`w-3.5 h-3.5 ${account.role === 'administrator' ? 'text-blue-400' : 'text-slate-500'}`}
                    aria-hidden="true"
                  />
                  <span className="text-xs font-semibold text-slate-300">{account.name}</span>
                </div>
              ) : (
                <button
                  onClick={onOpenAuth}
                  className="hidden sm:flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900/80 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-sm font-semibold transition-all duration-200 cursor-pointer"
                >
                  <LogIn className="w-4 h-4" aria-hidden="true" />
                  Masuk
                </button>
              )
            )}

            <button
              onClick={() => onEnter('market')}
              // `whitespace-nowrap` because at 375px the two words wrapped and
              // the header button became two lines tall, which reads as a
              // layout accident rather than a control.
              // Hairline, bukan amber pekat. Tombol ini dan tombol utama di hero
              // sama-sama amber sebelumnya, dan dua elemen paling keras di satu
              // layar berarti tidak ada yang paling keras. Yang di header cukup
              // terbaca; yang di hero yang boleh berteriak.
              className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-amber-400/40 bg-transparent px-4 py-2.5 text-sm font-semibold text-amber-400 transition-colors duration-200 hover:border-amber-400 hover:bg-amber-400/10 cursor-pointer"
            >
              Buka Terminal
              <ArrowRight className="w-4 h-4 shrink-0" aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="relative z-10 flex-1 flex items-center">
          <div className="max-w-5xl mx-auto w-full px-4 sm:px-6 py-14 sm:py-20 text-center">
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

            {/* Bobot TURUN, bukan naik.
                font-extrabold pada ukuran 7xl membuat huruf saling menempel dan
                terbaca murah; tipografi yang mahal justru melonggarkan bobot
                saat ukurannya membesar dan merapatkan jaraknya. Gradasi tiga
                warna diganti satu aksen amber pada baris kedua — halaman ini
                punya satu hal untuk dikatakan, jadi ia butuh satu penekanan. */}
            <h1
              className="mt-8 text-4xl sm:text-6xl lg:text-[4.5rem] font-semibold tracking-[-0.03em] leading-[1.03] text-balance text-slate-50 animate-rise"
              style={{ animationDelay: '200ms' }}
            >
              Semua saham Indonesia,
              <br />
              <span className="text-amber-400">plus alasannya.</span>
            </h1>

            <p
              className="mx-auto mt-7 max-w-2xl text-base sm:text-lg text-slate-400 leading-relaxed animate-rise"
              style={{ animationDelay: '280ms' }}
            >
              {db ? idr(db.emiten.length) : '962'} emiten, {db ? idr(db.meta.sessions) : '715'} sesi, arus asing,
              pengajuan ke bursa, register KSEI. Angkanya bisa dilacak ke sumbernya —{' '}
              <strong className="text-slate-200">dan kalau datanya nggak ada, ditulis nggak ada.</strong>
            </p>

            <div
              className="mt-9 flex flex-wrap items-center justify-center gap-3 animate-rise"
              style={{ animationDelay: '360ms' }}
            >
              {/* Amber, bukan biru, dan tanpa bayangan berwarna.
                  Amber adalah warna "keadaan aktif" di palet ini; tombol biru
                  dengan cahaya biru di bawahnya adalah bahasa tombol SaaS, dan
                  ia satu-satunya elemen paling cepat membuat halaman terbaca
                  murah. Teks gelap di atas amber juga memberi kontras tertinggi
                  di seluruh halaman, yang memang pantas untuk satu tindakan
                  utama. */}
              <button
                onClick={() => onEnter('screener')}
                className="group flex items-center justify-center gap-2 px-6 py-3.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold tracking-tight transition-colors duration-200 cursor-pointer"
              >
                <Target className="w-4 h-4" aria-hidden="true" />
                Jalankan Screener Hari Ini
                <ArrowRight
                  className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-1"
                  aria-hidden="true"
                />
              </button>
              <button
                onClick={() => onEnter('chat')}
                className="flex items-center justify-center gap-2 px-6 py-3.5 rounded-lg bg-transparent hover:bg-slate-900 border border-slate-700 hover:border-slate-600 text-slate-200 font-semibold tracking-tight transition-colors duration-200 cursor-pointer"
              >
                <MessageSquare className="w-4 h-4 text-slate-400" aria-hidden="true" />
                Tanya Emiten
              </button>
            </div>

            {composite && (
              // The live IHSG line is drawn BEHIND this block, and at the width
              // where the hero is tallest the two collide: white tabular
              // numerals land directly on a bright polyline and stop being
              // readable. A backdrop panel keeps the chart visible through it
              // while giving the digits a surface to sit on — cheaper than
              // shortening the chart, which is the one piece of real market
              // data on this page.
              <div
                className="mx-auto mt-11 inline-flex flex-wrap items-end justify-center gap-x-10 gap-y-4 rounded-lg border border-slate-800/80 bg-slate-950/70 px-6 py-4 backdrop-blur-md animate-rise"
                style={{ animationDelay: '440ms' }}
              >
                <div className="text-left">
                  <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">IHSG</div>
                  <div className="flex items-baseline gap-3">
                    <span className="text-3xl font-semibold tabular-nums tracking-[-0.02em]">{idr(composite.close, 2)}</span>
                    <span
                      className={`text-sm font-bold tabular-nums ${
                        composite.changePercent >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {pct(composite.changePercent)}
                    </span>
                  </div>
                </div>
                <div className="flex gap-7 text-left">
                  {(['1 Bln', '3 Bln', 'YTD'] as const).map((label, i) => {
                    const v = [composite.return1m, composite.return3m, composite.ytd][i];
                    return (
                      <div key={label}>
                        <div className="text-[10px] uppercase text-slate-500 font-semibold">{label}</div>
                        <div className={`text-sm font-bold tabular-nums ${v >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
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

      {/* ------------------------------------------------------------- angka */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 stagger">
          {stats.map((s, i) => (
            // Angka putih pekat, bukan gradasi.
            // Gradasi pada angka membuatnya memudar di bagian bawah, dan angka
            // yang memudar adalah angka yang terlihat dekoratif. Di terminal,
            // angka adalah isinya. Labelnya turun jadi huruf kapital kecil
            // berjarak lebar supaya hierarkinya datang dari bentuk, bukan dari
            // menebalkan semuanya.
            <div
              key={s.label}
              className="rounded-lg border border-slate-800/80 bg-slate-900/60 p-5 animate-rise"
              style={{ ['--i' as string]: i }}
            >
              <div className="text-3xl sm:text-4xl font-semibold tabular-nums tracking-[-0.02em] text-slate-50">
                {s.value}
              </div>
              <div className="mt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                {s.label}
              </div>
              <div className="text-[11px] text-slate-600 mt-1 leading-snug">{s.sub}</div>
            </div>
          ))}
        </div>
      </section>

      {/* -------------------------------------------------------------- sikap */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-400">Kenapa dibikin</p>
        <h2 className="mt-5 text-3xl sm:text-5xl font-semibold tracking-[-0.03em] leading-[1.06] text-balance text-slate-50">
          Kebanyakan alat saham sok tahu.
          <br className="hidden sm:block" />
          <span className="text-slate-500"> Yang ini nggak.</span>
        </h2>

        <div className="mt-12 space-y-10 sm:space-y-14">
          {[
            {
              n: '01',
              h: 'Tiap angka ada sumbernya',
              p: 'Bisa ditelusuri sampai ke endpoint IDX-nya. Kalau satu angka nggak bisa dipertanggungjawabkan, ya nggak ditampilin.',
            },
            {
              n: '02',
              h: 'Yang nggak tahu, ditulis nggak tahu',
              p: 'CPO sama nikel nggak punya harga harian publik, padahal kita produsen terbesarnya. Kolomnya dibiarin kosong. Nggak saya gantiin pakai yang mirip-mirip cuma biar tabelnya penuh.',
            },
            {
              n: '03',
              h: 'Semua diperiksa ulang tiap hari',
              p: '237 ribu pemeriksaan nyapu 962 emiten tiap kali data ditarik. Yang dicari bukan yang bikin error — tapi angka yang keliatan wajar padahal salah.',
            },
          ].map((b) => (
            <div key={b.n} className="grid grid-cols-[auto_1fr] gap-5 sm:gap-8">
              <div className="text-3xl sm:text-5xl font-semibold tabular-nums tracking-[-0.02em] text-slate-800">{b.n}</div>
              <div className="min-w-0">
                <h3 className="text-lg sm:text-2xl font-bold tracking-tight text-slate-100">{b.h}</h3>
                <p className="mt-2.5 text-sm sm:text-base text-slate-400 leading-relaxed max-w-2xl">{b.p}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* --------------------------------------------------------- perbedaan */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
        <div className="text-center">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-400">Bedanya di mana</p>
          <h2 className="mt-5 text-3xl sm:text-4xl font-semibold tracking-[-0.03em] text-balance text-slate-50">
            Dua cara bikin alat kayak gini
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-sm sm:text-base text-slate-400 leading-relaxed">
            Yang kanan bisa langsung dibuka dan dibantah hari ini juga.
          </p>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-6 sm:p-7">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-500/10 text-rose-400">
                <X className="h-4 w-4" aria-hidden="true" />
              </span>
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">Yang biasa</h3>
            </div>
            <ul className="mt-5 space-y-4">
              {CONTRAST.map((c) => (
                <li key={c.biasa} className="text-[13px] leading-relaxed text-slate-500">
                  {c.biasa}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg border border-emerald-800/50 bg-gradient-to-br from-emerald-950/25 to-slate-900/50 p-6 sm:p-7">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
                <Check className="h-4 w-4" aria-hidden="true" />
              </span>
              <h3 className="text-sm font-bold uppercase tracking-wider text-emerald-300">Yang ini</h3>
            </div>
            <ul className="mt-5 space-y-4">
              {CONTRAST.map((c) => (
                <li key={c.sini} className="text-[13px] leading-relaxed text-slate-200">
                  {c.sini}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ papan strategi */}
      {strategy && (
        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
          <div className="rounded-lg border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-7 sm:p-10">
            <div className="flex items-center gap-2.5">
              <FlaskConical className="h-5 w-5 text-rose-300" aria-hidden="true" />
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-rose-300">Papan strategi</p>
            </div>
            <div className="mt-5 grid gap-8 lg:grid-cols-[auto_1fr] lg:items-center">
              <div className="flex gap-8 sm:gap-12">
                <div>
                  <div className="text-4xl sm:text-5xl font-semibold tabular-nums tracking-[-0.02em] text-slate-50">
                    {idr(strategy.tested)}
                  </div>
                  <div className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    rule set diuji
                  </div>
                </div>
                <div>
                  <div className="text-4xl sm:text-5xl font-semibold tabular-nums tracking-[-0.02em] text-emerald-400">
                    {idr(strategy.survivors)}
                  </div>
                  <div className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    lolos semua gerbang
                  </div>
                </div>
              </div>
              <p className="text-sm text-slate-400 leading-relaxed max-w-2xl">
                Dicari di 70% sesi pertama, dinilai di 30% sisanya yang belum pernah dilihat. Winrate tinggi gampang
                dipalsukan, jadi tiap kandidat dites ulang dengan winrate dipotong 10 poin — yang jadi rugi, dibuang.{' '}
                <strong className="text-slate-200">Yang gagal ikut dipajang di sini,</strong> soalnya papan yang cuma
                muat pemenang bikin "udah dicoba, nggak jalan" nggak kebedain sama "nggak pernah dicoba".
              </p>
            </div>
          </div>
        </section>
      )}

      {/* ---------------------------------------------------------- fitur */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-6">
        <div className="text-center">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-400">Isinya apa aja</p>
          {/* Counted from the registry, never typed. The previous front page
              hardcoded its screen list and drifted until it was advertising a
              deleted screen and hiding six live ones; a number written by hand
              here would drift the same way the first time a nineteenth ships. */}
          <h2 className="mt-5 text-3xl sm:text-4xl font-semibold tracking-[-0.03em] text-balance text-slate-50">
            {TERMINAL_FUNCTIONS.length} layar, empat pekerjaan
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-sm sm:text-base text-slate-400 leading-relaxed">
            Ctrl+K, ketik kodenya, Enter. Dari HP, tombol paling kanan di bawah.
          </p>
        </div>

        <div className="mt-12 space-y-14 sm:space-y-20">
          {GROUPS.map((g) => (
            <div key={g.key}>
              <div className="max-w-3xl">
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-600">{g.eyebrow}</p>
                <h3 className="mt-3 text-2xl sm:text-3xl font-semibold tracking-[-0.025em] text-balance text-slate-100">{g.title}</h3>
                <p className="mt-3 text-sm text-slate-400 leading-relaxed">{g.blurb}</p>
              </div>

              <div className="mt-7 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 stagger">
                {g.items.map((f, i) => (
                  <div
                    key={f.code}
                    className="group rounded-lg border border-slate-800 bg-slate-900 p-5 transition-all duration-300 hover:border-slate-700 hover:bg-slate-900/70 animate-rise"
                    style={{ ['--i' as string]: i }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="w-10 h-10 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-center transition-transform duration-300 group-hover:scale-105">
                        <f.icon className={`w-4.5 h-4.5 ${f.accent}`} aria-hidden="true" />
                      </div>
                      <span className="rounded border border-slate-800 bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-500">
                        {f.code}
                      </span>
                    </div>
                    <h4 className="mt-4 flex flex-wrap items-center gap-2 font-bold text-[15px]">
                      {f.title}
                      {isNewFeature(f.code) && (
                        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300">
                          baru
                        </span>
                      )}
                    </h4>
                    <p className="mt-2 text-[13px] text-slate-400 leading-relaxed">{f.body}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* -------------------------------------------------------- provenance */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
        <div className="rounded-lg border border-slate-800 bg-gradient-to-br from-slate-900/80 to-slate-950 p-8 sm:p-10">
          <div className="flex items-start gap-4">
            <ShieldCheck className="w-6 h-6 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="flex-1">
              <h2 className="text-xl font-bold">Datanya dari mana</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-4 mt-5 text-[13px]">
                <div>
                  <div className="flex items-center gap-2 font-semibold text-slate-200">
                    <Globe2 className="w-3.5 h-3.5 text-blue-400" aria-hidden="true" />
                    API resmi IDX
                  </div>
                  <p className="mt-1.5 text-slate-400 leading-relaxed">
                    Emiten, harga harian, indeks, arus asing, pengajuan keterbukaan informasi. Langsung dari{' '}
                    <code className="text-blue-400">idx.co.id</code>, nggak lewat agregator.
                  </p>
                </div>
                <div>
                  <div className="flex items-center gap-2 font-semibold text-slate-200">
                    <LineChart className="w-3.5 h-3.5 text-indigo-400" aria-hidden="true" />
                    Laporan keuangan &amp; harga live
                  </div>
                  <p className="mt-1.5 text-slate-400 leading-relaxed">
                    Dari Yahoo, soalnya IDX cuma nerbitin XBRL mentah dan feed harganya end-of-day. Register
                    kepemilikan dari KSEI, plus 29 harga luar negeri.
                  </p>
                </div>
              </div>

              <div className="mt-6 pt-5 border-t border-slate-800 text-[12px] text-slate-500 leading-relaxed">
                Screener baca harga, volume, nilai transaksi, arus asing. Itu bukan ramalan, dan nggak ada satu
                angka pun di sini yang bilang sesuatu bakal naik.{' '}
                <strong className="text-slate-400">Ini alat riset, bukan ajakan beli.</strong>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ penutup */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 pb-16 sm:pb-24 text-center">
        <h2 className="text-3xl sm:text-4xl font-semibold tracking-[-0.03em] text-balance text-slate-50">
          Buka screener-nya, terus bantah angkanya.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-sm sm:text-base text-slate-400 leading-relaxed">
          Nggak perlu daftar buat lihat. Datanya udah kemuat semua di halaman ini.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={() => onEnter('screener')}
            className="group flex items-center gap-2 px-6 py-3.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold tracking-tight transition-colors duration-200 cursor-pointer"
          >
            <Target className="w-4 h-4" aria-hidden="true" />
            Jalankan Screener Hari Ini
            <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-1" aria-hidden="true" />
          </button>
          <button
            onClick={() => onEnter('analytics')}
            className="flex items-center gap-2 px-6 py-3.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 font-bold transition-all duration-200 cursor-pointer"
          >
            <Scale className="w-4 h-4 text-cyan-400" aria-hidden="true" />
            Lihat Penggerak IHSG
          </button>
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
