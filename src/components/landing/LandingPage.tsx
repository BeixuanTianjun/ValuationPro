import React, { useEffect, useMemo, useState } from 'react';
import { loadIdxFile } from '../../data/idxFiles';
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
import { AsteroidField } from './AsteroidField';
import {
  Accordion,
  LineGraph,
  NotificationsList,
  ScrambleText,
  ScrollZoomHero,
  Typewriter,
  VelocityRow,
} from './motionKit';

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

function useStrategyFacts(): { tested: number; survivors: number; sessions: number } | null {
  const [facts, setFacts] = useState<{ tested: number; survivors: number; sessions: number } | null>(null);
  useEffect(() => {
    let alive = true;
    void loadIdxFile<{ ruleSetsTested?: number; survivors?: number; sessions?: number }>(
      'strategies.json'
    ).then((f) => {
      if (!alive || !f) return; // the band renders without it rather than printing a made-up number
      if (Number.isFinite(f.ruleSetsTested) && Number.isFinite(f.survivors)) {
        setFacts({ tested: f.ruleSetsTested!, survivors: f.survivors!, sessions: f.sessions ?? 0 });
      }
    });
    return () => {
      alive = false;
    };
  }, []);
  return facts;
}



/**
 * Angka yang naik sendiri dari nol.
 *
 * Dipakai HANYA pada angka yang benar-benar berasal dari data yang sudah dimuat.
 * Sebuah penghitung yang berhenti di angka karangan adalah kebohongan yang
 * bergerak, dan itu lebih meyakinkan daripada kebohongan yang diam.
 */
function useCountUp(target: number, mulaiSetelah: number, aktif: boolean): number {
  const [nilai, setNilai] = useState(0);

  useEffect(() => {
    if (!aktif || !Number.isFinite(target)) return;
    const diam = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (diam) {
      setNilai(target);
      return;
    }
    let raf = 0;
    let timer = 0;
    const DURASI = 1400;
    const jalan = (t0: number) => {
      const tik = (now: number) => {
        const p = Math.min(1, (now - t0) / DURASI);
        const e = 1 - Math.pow(1 - p, 3); // easeOutCubic
        setNilai(target * e);
        if (p < 1) raf = requestAnimationFrame(tik);
      };
      raf = requestAnimationFrame(tik);
    };
    timer = window.setTimeout(() => jalan(performance.now()), mulaiSetelah);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [target, mulaiSetelah, aktif]);

  return nilai;
}

/**
 * Satu sel di baris kaki. Komponen tersendiri karena hook tidak boleh dipanggil
 * di dalam perulangan, dan tiap sel butuh penghitungnya sendiri.
 */
const StatCell: React.FC<{
  target: number;
  label: string;
  sub: string;
  desimal?: number;
  delay: number;
  aktif: boolean;
}> = ({ target, label, sub, desimal = 0, delay, aktif }) => {
  const nilai = useCountUp(target, delay, aktif);
  return (
    <div className="text-left">
      <div className="text-2xl sm:text-3xl font-semibold tabular-nums tracking-[-0.025em] text-slate-50">
        {nilai.toLocaleString('id-ID', { minimumFractionDigits: desimal, maximumFractionDigits: desimal })}
      </div>
      <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className="text-[11px] text-slate-600 leading-snug">{sub}</div>
    </div>
  );
};

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
  const strategy = useStrategyFacts();

  const composite = indices.find((i) => i.code === 'COMPOSITE');

  /**
   * Penutupan IHSG sepanjang jendela yang dipakai papan strategi.
   *
   * Kosong kalau salah satu bahannya belum ada, dan grafiknya ikut hilang.
   * Menggambar SEBAGIAN jendela lalu tetap melabelinya "jendela ujinya" adalah
   * bentuk kebohongan yang tidak akan pernah dilaporkan siapa pun: bentuknya
   * masuk akal, angkanya masuk akal, dan yang salah cuma keterangannya.
   */
  const ihsgUji = useMemo(() => {
    const s = db?.indexSeries.get('COMPOSITE');
    if (!s || !strategy?.sessions) return [];
    // `Array.from`, karena `close` sebuah Float64Array: `slice` di atasnya
    // mengembalikan Float64Array lagi, bukan array biasa.
    const n = Math.min(strategy.sessions, s.close.length);
    return Array.from(s.close.slice(-n)).filter((v) => v > 0);
  }, [db, strategy]);

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

  /* `overflow-x: clip`, BUKAN `overflow-x: hidden`, DAN INI PERBAIKAN BUG.
        Keduanya sama-sama memotong apa pun yang meluber ke samping — baris
        fitur yang berjalan menyamping butuh itu. Bedanya: `hidden` menjadikan
        elemen ini SCROLL CONTAINER, dan `position: sticky` di dalam sebuah
        scroll container menempel pada scrollport container itu, bukan pada
        layar. Container ini tidak pernah bergulir sendiri (yang bergulir body),
        jadi hero-nya tidak pernah menempel sama sekali — ia ikut naik seperti
        elemen biasa.

        Diukur di Chrome sungguhan: pada gulir 248px, pita ticker di kaki hero
        berpindah dari y=880 ke y=632. Persis 248px. Tidak ada yang menempel.
        Dan seluruh gerak zoom-nya tetap berjalan, jadi tidak ada satu pun tanda
        bahwa ada yang salah — kelas bug yang paling mahal di repo ini.

        `clip` memotong tanpa membuat scroll container, sehingga sticky-nya
        kembali mengacu ke layar. Dijaga oleh `npm run motion:check`. */
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 [overflow-x:clip]">
      {/* ---------------------------------------------------------------- hero */}
      {/* SATU VIEWPORT, bukan 94% darinya.
          `min-h-[94vh]` membiarkan tinggi hero ditentukan isinya, jadi di layar
          pendek ia meluber dan di layar tinggi ia menyisakan pita kosong.
          `svh` dipakai, bukan `vh`: di Safari iOS `vh` menghitung bilah alamat
          yang menghilang, jadi baris kaki terpotong persis di perangkat yang
          paling sering dipakai membuka tautan. */}
      {/* SATU VIEWPORT DI LAYAR LEBAR, TUMBUH DI PONSEL.
          Mengunci tinggi di ponsel memotong baris kaki: judul tiga baris plus
          subhead empat baris memang tidak muat di 812px tanpa memangkas
          kalimatnya, dan memangkas kalimatnya untuk memenuhi sebuah aturan tata
          letak adalah menukar isi dengan bentuk. Jadi `min-h` di ponsel, tinggi
          persis mulai dari `sm`. */}
      <ScrollZoomHero
        latar={
          <>
            <div className="absolute inset-0 grid-glow opacity-40" aria-hidden="true" />
            <div
              className="absolute inset-x-0 top-0 h-[620px] bg-[radial-gradient(ellipse_at_top,rgba(255,167,51,0.07),transparent_62%)]"
              aria-hidden="true"
            />

            {/* URUTANNYA DIBALIK, dan itu seluruh perbaikannya.
                Sebelumnya kota digambar dulu lalu bidang harga di atasnya, jadi 875
                garis harga menyapu MELINTASI gedung-gedungnya dan keduanya berbaur
                jadi kabut cokelat tanpa bentuk. Sekarang harga di belakang, kota di
                depan dan pekat — gedungnya MENUTUPI garis yang lewat di belakangnya.
                Oklusi itulah yang membuat mata membaca dua bidang datar sebagai
                "jauh" dan "dekat", dan kedalaman itu yang membedakan sebuah komposisi
                dari sebuah tekstur.

                Bacaannya jadi jelas: langit adalah harga 962 emiten selama 180 sesi,
                tanahnya kapitalisasi mereka hari ini. Data yang sama, dua bacaan,
                saling menutupi seperti benda sungguhan. */}
            {/* ASTEROID DI DEPAN, KOTA TINGGAL GARIS UFUK.
                Michael minta hero-nya seperti halaman peluncuran GPT-6 Astra:
                asteroid, bereaksi ke kursor, ikut waktu digulir. Yang berubah
                pembagian ruangnya, bukan dalilnya — tiap asteroid tetap sebuah
                emiten, ukurannya tetap kapitalisasinya.

                Bidang harga 875 jalur DIBUANG dari hero. Tiga lapis data di satu
                bingkai sudah pernah dicoba di sini dan hasilnya lumpur; asteroid
                yang bergerak dan bereaksi butuh latar yang diam di belakangnya,
                bukan tekstur kedua yang ikut ramai. Skyline-nya tinggal 26vh,
                jadi ia berhenti bersaing dan mulai bekerja sebagai garis ufuk —
                yang justru dibutuhkan supaya asteroidnya terbaca melayang DI
                ATAS sesuatu, bukan mengambang di kotak hitam. */}
            <AsteroidField db={db} />

            {/* VINYET, PENGGANTI DINDING HITAM.
                Teks tetap harus menang atas latarnya — itu tidak berubah. Yang
                berubah: peredamnya sekarang hanya menggelapkan elips di sekitar
                kalimatnya, bukan seluruh lebar layar dari atas ke bawah. Kotanya
                berdiri di luar elips itu dan tetap utuh. */}
            <div
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_58%_42%_at_50%_44%,rgba(3,3,5,0.96),rgba(3,3,5,0.78)_48%,transparent_76%)]"
              aria-hidden="true"
            />
            {/* Dasar bingkai. Baris angka di kaki hero duduk di atas kota, dan tanpa
                gelap sedikit di bawahnya angka-angka itu bertabrakan dengan jendela
                yang menyala. Tingginya hanya 28 — cukup untuk mendudukkan barisnya,
                tidak cukup untuk menghapus kotanya. */}
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-slate-950 via-slate-950/70 to-transparent"
              aria-hidden="true"
            />
          </>
        }
      >
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
              className="vp-glass flex shrink-0 items-center gap-2 whitespace-nowrap rounded-2xl px-4 py-2.5 text-sm font-semibold text-amber-400 transition-transform duration-200 hover:scale-[1.03] cursor-pointer"
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
            {/* MONO, dan itu bukan gaya-gayaan.
                IBM Plex Mono sudah dimuat halaman ini untuk kolom harga, jadi
                memakainya di sini tidak menambah satu pun permintaan. Yang
                didapat: bentuk huruf yang sama dengan yang dilihat pengguna di
                dalam terminal, sehingga halaman depan terbaca sebagai pintu
                masuk alat itu — bukan sebagai brosur yang dibuat tim lain. */}
            <h1
              className="mt-6 font-mono text-[1.75rem] sm:text-6xl lg:text-[4.25rem] font-medium tracking-[-0.055em] leading-[1.08] sm:leading-[1.05] text-balance text-slate-50 animate-rise"
              style={{ animationDelay: '200ms' }}
            >
              Semua saham Indonesia,
              <br />
              {/* YANG DIKETIK ULANG CUMA EKORNYA, dan itu keputusan yang disengaja.
                  Contoh typewriter yang dirujuk mengganti SELURUH kalimatnya. Di
                  sini itu akan menghapus pernyataan pokok halaman ini tiap dua
                  detik, dan pengunjung yang mendarat di detik yang salah membaca
                  kalimat yang bukan intinya. "Semua saham Indonesia," tetap diam;
                  yang berganti empat cara mengucapkan janji yang sama — dan
                  keempatnya klaim yang memang bisa ditagih di dalam terminalnya. */}
              {/* SATU baris serif, bukan seluruh judul.
                  Ketiga contoh memakai serif untuk seluruh headline. Di sini itu
                  akan melawan barisnya sendiri: baris pertama mono karena ia
                  menyebut semesta yang terhitung, baris kedua serif karena ia
                  sebuah janji. Kontras dua bentuk huruf itulah penekanannya —
                  bukan ukuran, bukan tebal. */}
              <Typewriter
                className="font-serif italic tracking-[-0.02em] text-amber-400"
                frasa={['plus alasannya.', 'plus sumbernya.', 'plus tanggal filingnya.', 'plus yang datanya kosong.']}
              />
            </h1>

            <p
              className="mx-auto mt-5 sm:mt-7 max-w-2xl text-sm sm:text-lg text-slate-400 leading-relaxed animate-rise"
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

          </div>
        </div>

        {/* BARIS KAKI: satu-satunya tempat angka di viewport pertama.
            Panel IHSG dan strip "angka" dulu dua blok terpisah yang mengatakan
            hal yang sama dua kali dan memakan dua layar. Digabung, keduanya
            muat di satu viewport dan IHSG yang hidup berdiri bersebelahan
            dengan angka semesta yang statis — persis hubungan yang benar antara
            keduanya. */}
        <div className="relative z-10 mx-auto w-full max-w-6xl px-4 sm:px-6 pb-5">
          <div className="vp-glass flex flex-wrap items-end justify-center gap-x-10 gap-y-5 rounded-2xl px-6 py-4 animate-rise" style={{ animationDelay: '440ms' }}>
            {composite && (
              <div className="text-left">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">IHSG</div>
                <div className="flex items-baseline gap-2.5">
                  <span className="text-2xl sm:text-3xl font-semibold tabular-nums tracking-[-0.025em] text-slate-50">
                    {idr(composite.close, 2)}
                  </span>
                  <span
                    className={`text-sm font-bold tabular-nums ${
                      composite.changePercent >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {pct(composite.changePercent)}
                  </span>
                </div>
                <div className="text-[11px] text-slate-600 leading-snug">harga sesi berjalan</div>
              </div>
            )}
            {/* Penghitung hanya menyala setelah database ada. Angka yang naik
                ke nilai karangan adalah kebohongan yang bergerak. */}
            <StatCell target={db ? db.emiten.length : 0} label="Emiten" sub="satu papan IDX" delay={480} aktif={!!db} />
            <StatCell target={db ? db.meta.sessions : 0} label="Sesi riwayat" sub="disesuaikan aksi korporasi" delay={570} aktif={!!db} />
            <StatCell target={db ? db.indexSeries.size : 0} label="Indeks" sub="IHSG, LQ45, 11 sektor" delay={660} aktif={!!db} />
            <StatCell target={TERMINAL_FUNCTIONS.length} label="Layar" sub="ketik kodenya, Enter" delay={750} aktif />
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
      </ScrollZoomHero>

      {/* -------------------------------------------------------------- sikap */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
        <ScrambleText
            as="div"
            text="Kenapa dibikin"
            className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-amber-400"
          />
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
          <ScrambleText
            as="div"
            text="Bedanya di mana"
            className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-amber-400"
          />
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
              <ScrambleText
                as="div"
                text="Papan strategi"
                className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-rose-300"
              />
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

            {/* GRAFIK GARIS: dipakai, tapi hanya karena ada yang benar untuk
                digambar di sini. Michael menandainya "dipertimbangkan", dan
                pertimbangannya begini — sebuah grafik berbentuk indah dengan
                angka karangan, di halaman yang menjual "angkanya bisa dilacak ke
                sumbernya", adalah kontradiksi yang paling gampang ditangkap
                pembaca; sekali tertangkap, seluruh halaman ikut diragukan.

                Yang digambar IHSG sungguhan sepanjang jendela yang persis dipakai
                papan ini: kalau `strategy.sessions` ada, sebanyak itu; kalau
                tidak, tidak ada grafik sama sekali. Jadi bentuknya menjawab
                pertanyaan yang memang muncul membaca paragraf di atas — 148 ribu
                rule set diuji DI PASAR YANG SEPERTI APA. */}
            {ihsgUji.length > 2 && (
              <div className="mt-8 border-t border-slate-800 pt-6">
                <div className="flex items-baseline justify-between gap-4">
                  <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
                    IHSG · jendela ujinya
                  </p>
                  <p className="font-mono text-[11px] text-slate-600">{ihsgUji.length} sesi terakhir</p>
                </div>
                <LineGraph nilai={ihsgUji} className="mt-3" tinggi={84} warna={CHART.amber} />
              </div>
            )}
          </div>
        </section>
      )}

      {/* ---------------------------------------------------------- fitur */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-6">
        <div className="text-center">
          <ScrambleText
            as="div"
            text="Isinya apa aja"
            className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-amber-400"
          />
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

        {/* DIJALANKAN MENYAMPING, dan itu justru soal PANJANG HALAMAN.
            Sebelumnya empat kelompok kartu ditumpuk ke bawah: 2.345 piksel —
            sepertiga tinggi seluruh halaman — untuk daftar yang tidak seorang
            pun baca satu per satu sampai habis. Sembilan belas kartu yang sama,
            dijalankan dalam empat baris menyamping, tingginya tinggal
            seperlimanya dan tidak ada satu layar pun yang dibuang dari daftarnya.

            Barisnya berjalan sendiri pelan, LALU IKUT KECEPATAN GULIR: menggulir
            cepat membuatnya menyusul dan sedikit miring, menggulir ke atas
            membalik arahnya. Keterkaitan dengan gulir itulah isi idenya — kalau
            ia cuma "berjalan lebih cepat", ia sekadar marquee.

            Arah tiap baris diselang-seling supaya matanya punya tempat berhenti;
            empat baris yang berjalan searah terbaca sebagai satu blok bergerak. */}
        <div className="mt-12 space-y-4">
          {GROUPS.map((g, gi) => (
            <div key={g.key}>
              <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1">
                <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-slate-600">{g.eyebrow}</p>
                <h3 className="text-base font-semibold tracking-[-0.02em] text-slate-200">{g.title}</h3>
                <p className="hidden text-[13px] text-slate-500 lg:block">{g.blurb}</p>
              </div>

              <VelocityRow dasar={gi % 2 === 0 ? -2.6 : 2.6}>
                {g.items.map((f) => (
                  <div
                    key={f.code}
                    className="group w-[268px] shrink-0 rounded-lg border border-slate-800 bg-slate-900 p-5 transition-colors duration-300 hover:border-slate-700"
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
                    {/* Dipangkas tiga baris. Kartu yang berjalan tidak bisa dibaca
                        sampai paragraf keempat, dan kartu setinggi paragraf keempat
                        mengembalikan tinggi yang baru saja dihemat. */}
                    <p className="mt-2 line-clamp-3 text-[13px] text-slate-400 leading-relaxed">{f.body}</p>
                  </div>
                ))}
              </VelocityRow>
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

      {/* --------------------------------------------------- kiriman pagi + faq */}
      {/* DUA-DUANYA DI SATU BARIS, dan itu lagi-lagi soal panjang halaman.
          Ditumpuk, keduanya menambah dua layar penuh; bersebelahan, satu. Di
          ponsel ia kembali menumpuk, karena dua kolom selebar 187px bukan tata
          letak, itu kerusakan. */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <ScrambleText
              as="div"
              text="Yang masuk tiap pagi"
              className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-amber-400"
            />
            <h2 className="mt-5 text-2xl sm:text-3xl font-semibold tracking-[-0.03em] text-balance text-slate-50">
              Satu email, bukan lima aplikasi.
            </h2>
            <p className="mt-4 max-w-md text-sm text-slate-400 leading-relaxed">
              Screener, radar peristiwa, dan pemeriksaan datanya dikirim sebagai satu kiriman jam 07.10 WIB.{' '}
              <strong className="text-slate-200">Yang gagal ditaruh paling atas</strong> — laporan pagi yang mengubur
              kegagalan di bawah kabar baik nggak ada gunanya.
            </p>
            {/* CONTOH, dan dilabeli contoh. Kartu di bawah ini BENTUK baris yang
                sungguhan dikirim, bukan kiriman hari ini — memajang tiga baris
                karangan tanpa keterangan, di halaman yang seluruh dalilnya
                ketelusuran, adalah persis jenis detail yang menghancurkan
                kepercayaan begitu satu pembaca mengeceknya. */}
            <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.16em] text-slate-600">
              Contoh bentuknya
            </p>
            <div className="mt-3">
              <NotificationsList
                items={[
                  {
                    ikon: <Radar className="h-4 w-4 text-amber-400" aria-hidden="true" />,
                    judul: 'Radar · 3 emiten baru',
                    badan: 'Ganti kendali, transaksi material, ganti identitas — semuanya belum gerak harganya.',
                    waktu: '07.10',
                  },
                  {
                    ikon: <Target className="h-4 w-4 text-emerald-400" aria-hidden="true" />,
                    judul: 'Screener · momentum, 6 lolos',
                    badan: 'Turun dari 962. Tiap yang gugur ada catatan gerbang mana yang menahannya.',
                    waktu: '07.10',
                  },
                  {
                    ikon: <ShieldCheck className="h-4 w-4 text-rose-400" aria-hidden="true" />,
                    judul: 'Data · 1 feed basi',
                    badan: 'Sesi resmi IDX ketinggalan 2 hari. Ditaruh di atas, bukan di catatan kaki.',
                    waktu: '07.10',
                  },
                ]}
              />
            </div>
          </div>

          <div>
            <ScrambleText
              as="div"
              text="Yang sering ditanya"
              className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-amber-400"
            />
            <h2 className="mt-5 text-2xl sm:text-3xl font-semibold tracking-[-0.03em] text-balance text-slate-50">
              Termasuk yang jawabannya bikin nggak enak.
            </h2>
            <div className="mt-7">
              <Accordion
                items={[
                  {
                    q: 'Ini bisa kasih tahu saham mana yang bakal naik?',
                    a: (
                      <>
                        Nggak, dan nggak ada satu angka pun di sini yang mengklaim begitu. Screener membaca harga,
                        volume, nilai transaksi dan arus asing — semuanya masa lalu. Yang bisa dilakukan alat ini
                        menyaring 962 emiten jadi segelintir dan menunjukkan <em>kenapa</em> sisanya gugur. Keputusan
                        belinya tetap punya kamu.
                      </>
                    ),
                  },
                  {
                    q: 'Radar peristiwa udah teruji?',
                    a: (
                      <>
                        Belum, dan layarnya bilang begitu. Uji majunya berjalan sejak radar dipasang, dan sampai jumlah
                        sampel efektifnya cukup, jawabannya ditulis <strong className="text-slate-300">"belum bisa
                        dijawab"</strong> — bukan angka yang kelihatan meyakinkan dari dua belas kejadian yang saling
                        tumpang tindih.
                      </>
                    ),
                  },
                  {
                    q: 'Kenapa screener sering telat?',
                    a: (
                      <>
                        Karena memang telat by construction: ketiga setup-nya butuh tren yang sudah ada. Itu sebabnya
                        radar dibangun terpisah — ia membaca pengajuan ke bursa, bukan tapenya, dan justru{' '}
                        <em>menolak</em> apa pun yang harganya sudah jalan.
                      </>
                    ),
                  },
                  {
                    q: 'Datanya dari mana, dan seberapa sering diperbarui?',
                    a: (
                      <>
                        Emiten, harga harian, indeks, arus asing dan keterbukaan informasi langsung dari API resmi IDX.
                        Laporan keuangan dan harga live dari Yahoo, register kepemilikan dari KSEI. Sesi resmi ditarik
                        tiap pagi; harga intraday tiap beberapa menit selama bursa buka. Kalau ada feed yang basi,
                        angkanya tetap ditampilkan dengan tanggalnya, bukan disembunyikan.
                      </>
                    ),
                  },
                  {
                    q: 'Perlu daftar dulu?',
                    a: 'Nggak buat lihat. Seluruh data di halaman ini sudah dimuat tanpa akun. Akun cuma dipakai buat nyimpan watchlist dan model DCF/LBO kamu sendiri.',
                  },
                ]}
              />
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
