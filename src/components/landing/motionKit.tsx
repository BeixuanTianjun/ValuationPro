// Gerak untuk halaman depan.
//
// KENAPA DITULIS SENDIRI, BUKAN DIPASANG DARI CONTOH. Contoh-contoh yang
// dirujuk Michael di motion.dev — scramble on hover, scroll zoom hero, offset
// terkait kecepatan gulir, typewriter, akordeon, grafik garis, daftar notifikasi
// — kode sumbernya ada di balik Motion+ (berbayar), dan `scrambleText` sendiri
// SEBUAH API MOTION+, bukan bagian dari paket `motion` yang sudah terpasang di
// sini. Jadi yang ada di berkas ini efek yang sama, ditulis di atas API publik
// yang memang sudah kita punya: useScroll, useTransform, useVelocity, useSpring,
// useInView, wrap. Tidak ada dependensi baru dan tidak ada langganan.
//
// SATU ATURAN YANG BERLAKU DI SELURUH BERKAS INI: setiap efek harus MENDARAT DI
// KEADAAN AKHIR YANG BENAR meski geraknya dimatikan. Halaman ini menjual
// ketelusuran angka; teks yang mandek jadi huruf acak, atau judul yang tidak
// pernah selesai diketik, adalah kerusakan yang jauh lebih mahal daripada
// animasi yang tidak jalan. Karena itu tiap komponen memeriksa
// `prefers-reduced-motion` dan langsung memasang nilai akhirnya.

import React, { useEffect, useRef, useState } from 'react';
import {
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  useVelocity,
  wrap,
  type MotionValue,
} from 'motion/react';

/** Karakter pengacak. Sengaja campuran mono yang lebarnya seragam di IBM Plex. */
const ACAK = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*+<>/\\';

/**
 * Teks yang mengacak lalu mengunci huruf demi huruf.
 *
 * ALGORITMANYA. Tiap huruf punya waktu kunci sendiri, `i * jeda`; sebelum waktu
 * itu ia menampilkan karakter acak yang diganti tiap bingkai, sesudahnya ia
 * huruf aslinya dan tidak berubah lagi. Jadi teksnya mengeras dari kiri ke
 * kanan, bukan berkedip serentak.
 *
 * SPASI TIDAK PERNAH DIACAK. Kalau spasi ikut diacak, panjang kata berubah tiap
 * bingkai dan barisnya melompat-lompat — pada judul yang membungkus dua baris
 * itu memicu reflow tiap bingkai, yang terlihat murah DAN mahal sekaligus.
 *
 * Dipakai lewat `pemicu`: 'inView' untuk judul bagian (mengacak sekali waktu
 * bagiannya masuk layar), 'hover' untuk teks yang bisa disentuh.
 */
export const ScrambleText: React.FC<{
  text: string;
  className?: string;
  /** Milidetik antar-huruf terkunci. 28 kira-kira 0,5 detik untuk 18 huruf. */
  jeda?: number;
  pemicu?: 'inView' | 'hover' | 'segera';
  /** Ditunda supaya judul dan sub-judul tidak mengacak berbarengan. */
  tunda?: number;
  as?: 'span' | 'div';
}> = ({ text, className, jeda = 28, pemicu = 'inView', tunda = 0, as = 'span' }) => {
  const ref = useRef<HTMLSpanElement | null>(null);
  const inView = useInView(ref, { once: true, margin: '-12% 0px -12% 0px' });
  const diam = useReducedMotion();
  const [tampil, setTampil] = useState(text);
  const raf = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const jalankan = React.useCallback(() => {
    if (diam) {
      setTampil(text);
      return;
    }
    cancelAnimationFrame(raf.current);
    const mulai = performance.now();
    const total = text.length * jeda + 140;
    const langkah = (t: number) => {
      const lewat = t - mulai;
      let keluar = '';
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === ' ' || lewat > i * jeda) keluar += c;
        else keluar += ACAK[(Math.random() * ACAK.length) | 0];
      }
      setTampil(keluar);
      if (lewat < total) raf.current = requestAnimationFrame(langkah);
      else setTampil(text);
    };
    raf.current = requestAnimationFrame(langkah);
  }, [text, jeda, diam]);

  useEffect(() => {
    if (pemicu === 'hover') return;
    if (pemicu === 'inView' && !inView) return;
    timer.current = setTimeout(jalankan, tunda);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      cancelAnimationFrame(raf.current);
    };
  }, [pemicu, inView, tunda, jalankan]);

  // Teks aslinya tetap ada untuk pembaca layar dan untuk salin-tempel; yang
  // diacak hanya lapisan yang terlihat. Sebuah judul yang dibacakan sebagai
  // "K7#$ Q2 alat saham" bukan efek, itu bug aksesibilitas.
  const Tag = as;
  return (
    <Tag
      ref={ref as React.Ref<HTMLSpanElement & HTMLDivElement>}
      className={className}
      onMouseEnter={pemicu === 'hover' ? jalankan : undefined}
    >
      {/* LEBARNYA DIPESAN OLEH TEKS AKHIRNYA, bukan oleh acakan yang sedang
          berjalan. Di huruf proporsional, "W" dan "i" tidak selebar, jadi tiap
          bingkai acakan mengubah lebar elemennya — dan di baris fungsi terminal
          itu menggeser kotak perintah di sebelahnya maju-mundur selama setengah
          detik tiap kali layarnya diganti. Salinan tak terlihat memesan kotaknya
          sekali; lapisan yang mengacak mengambang di atasnya dan tidak pernah
          ikut menentukan tata letak.

          Pembungkus `relative` ada DI DALAM Tag, bukan menggantikan Tag: kalau
          `inset-0` diukur terhadap Tag yang punya padding — lencana kode fungsi
          punya — teksnya akan menempel ke tepi border, bukan ke dalam paddingnya. */}
      <span className="relative inline-block align-baseline">
        <span className="invisible" aria-hidden="true">
          {text}
        </span>
        <span className="absolute inset-0 whitespace-pre" aria-hidden="true">
          {tampil}
        </span>
      </span>
      <span className="sr-only">{text}</span>
    </Tag>
  );
};

/**
 * Judul yang mengetik, menghapus, lalu mengetik frasa berikutnya.
 *
 * YANG BERUBAH CUMA EKORNYA. Baris "Semua saham Indonesia," tetap diam; yang
 * berganti hanya janji di baris kedua. Kalau seluruh judul ikut berganti,
 * pernyataan pokok halaman ini hilang tiap dua detik dan pengunjung yang datang
 * di detik yang salah membaca kalimat yang bukan intinya.
 *
 * TINGGINYA DIKUNCI oleh frasa terpanjang yang dirender transparan di belakang.
 * Tanpa itu, baris di bawahnya naik-turun tiap kali frasa berganti panjang, dan
 * seluruh hero bergoyang — cacat khas efek ketik yang dipasang buru-buru.
 */
export const Typewriter: React.FC<{
  frasa: string[];
  className?: string;
  /** Milidetik per huruf saat mengetik. Menghapus dibuat dua kali lebih cepat. */
  kecepatan?: number;
  /** Berapa lama frasa penuh didiamkan sebelum dihapus. */
  jeda?: number;
}> = ({ frasa, className, kecepatan = 55, jeda = 2200 }) => {
  const diam = useReducedMotion();
  const [ke, setKe] = useState(0);
  const [n, setN] = useState(0);
  const [hapus, setHapus] = useState(false);

  useEffect(() => {
    if (diam) return; // frasa pertama ditampilkan utuh, selamanya
    const kini = frasa[ke % frasa.length];
    if (!hapus && n === kini.length) {
      const t = setTimeout(() => setHapus(true), jeda);
      return () => clearTimeout(t);
    }
    if (hapus && n === 0) {
      setHapus(false);
      setKe((k) => (k + 1) % frasa.length);
      return;
    }
    const t = setTimeout(() => setN((v) => v + (hapus ? -1 : 1)), hapus ? kecepatan / 2 : kecepatan);
    return () => clearTimeout(t);
  }, [n, hapus, ke, frasa, kecepatan, jeda, diam]);

  const kini = frasa[ke % frasa.length];
  const terpanjang = frasa.reduce((a, b) => (b.length > a.length ? b : a), frasa[0]);

  return (
    <span className={`relative inline-block ${className ?? ''}`}>
      {/* Pengunci tinggi DAN lebar. Dibuat tak terlihat, bukan `hidden`:
          elemen ber-`display:none` tidak memesan ruang sama sekali. */}
      <span className="invisible" aria-hidden="true">
        {terpanjang}
      </span>
      <span className="absolute inset-0" aria-hidden="true">
        {diam ? frasa[0] : kini.slice(0, n)}
        {!diam && (
          <span className="ml-0.5 inline-block w-[0.06em] translate-y-[0.08em] self-stretch bg-amber-400 align-baseline animate-caret" style={{ height: '0.86em' }} />
        )}
      </span>
      <span className="sr-only">{frasa.join('. ')}</span>
    </span>
  );
};

/**
 * Satu baris yang berjalan terus, dan MIRING mengikuti kecepatan gulir.
 *
 * Ini padanan contoh "scroll velocity linked offset": kecepatan gulir dibaca
 * lewat useVelocity, dilewatkan spring supaya tidak menyentak, lalu dipakai
 * untuk dua hal — menambah laju barisnya dan memiringkan tiap kartu. Menggulir
 * cepat membuat barisnya menyusul; berhenti menggulir membuatnya kembali ke
 * laju dasarnya sendiri.
 *
 * ARAHNYA IKUT ARAH GULIR. `useTransform` di bawah memakai tanda kecepatannya,
 * jadi menggulir ke atas benar-benar membalik baris. Tanpa itu efeknya cuma
 * "lebih cepat", yang tidak terbaca sebagai keterkaitan dengan gulir sama
 * sekali — dan keterkaitan itulah seluruh isi idenya.
 *
 * KENAPA DIPAKAI DI SINI. Bagian "19 layar" sebelumnya empat kelompok kartu yang
 * ditumpuk ke bawah: 2.345 piksel, sepertiga tinggi seluruh halaman, untuk
 * daftar yang tak seorang pun baca satu per satu. Dijalankan menyamping, isinya
 * sama persis dan tingginya tinggal seperlimanya.
 */
function useKecepatanGulir(): { laju: MotionValue<number>; miring: MotionValue<number> } {
  const { scrollY } = useScroll();
  const v = useVelocity(scrollY);
  const halus = useSpring(v, { damping: 46, stiffness: 380 });
  // Dibatasi: satu lemparan pada trackpad bisa melewati 8.000 px/dtk, dan tanpa
  // batas barisnya melesat sejauh beberapa layar dalam satu bingkai lalu
  // berkedip. Yang dipetakan hanya 2.000 px/dtk pertama.
  const laju = useTransform(halus, [-2000, 0, 2000], [-5, 0, 5], { clamp: true });
  const miring = useTransform(halus, [-2000, 0, 2000], [8, 0, -8], { clamp: true });
  return { laju, miring };
}

export const VelocityRow: React.FC<{
  children: React.ReactNode[];
  /** Laju dasar dalam persen lebar per detik. Negatif berjalan ke kiri. */
  dasar?: number;
  className?: string;
}> = ({ children, dasar = -3, className }) => {
  const diam = useReducedMotion();
  const { laju, miring } = useKecepatanGulir();
  const x = useMotionValue(0);
  const ref = useRef<HTMLDivElement | null>(null);
  const lebarSatu = useRef(0);
  const terakhir = useRef(0);

  useEffect(() => {
    if (diam) return;
    let raf = 0;
    const langkah = (t: number) => {
      const dt = terakhir.current ? Math.min((t - terakhir.current) / 1000, 0.05) : 0;
      terakhir.current = t;
      // Lebar satu salinan diukur dari DOM, bukan ditebak. Isi baris ini
      // panjangnya berbeda-beda dan `wrap` pada angka karangan akan meninggalkan
      // celah kosong yang lewat tiap beberapa detik.
      const el = ref.current?.firstElementChild as HTMLElement | undefined;
      if (el) lebarSatu.current = el.scrollWidth;
      const w = lebarSatu.current || 1;
      x.set(wrap(-w, 0, x.get() + (dasar + laju.get()) * dt * (w / 100)));
      raf = requestAnimationFrame(langkah);
    };
    raf = requestAnimationFrame(langkah);
    return () => cancelAnimationFrame(raf);
  }, [dasar, diam, laju, x]);

  // Gerak dimatikan: barisnya jadi daftar yang bisa digulir tangan. Isinya tetap
  // seluruhnya bisa dijangkau, yang tidak akan terjadi kalau ia cuma dibekukan.
  if (diam) {
    return (
      <div className={`flex gap-4 overflow-x-auto pb-2 ${className ?? ''}`}>{children}</div>
    );
  }

  return (
    <div className={`relative overflow-hidden ${className ?? ''}`}>
      <motion.div ref={ref} className="flex w-max" style={{ x, skewX: miring }}>
        {/* Dua salinan, dan itu syarat minimum: dengan satu salinan ada saat
            ujungnya sudah lewat sementara awalnya belum masuk, dan barisnya
            memperlihatkan lubang selebar layar. */}
        {[0, 1].map((salinan) => (
          <div key={salinan} className="flex shrink-0 gap-4 pr-4" aria-hidden={salinan === 1}>
            {children}
          </div>
        ))}
      </motion.div>
    </div>
  );
};

/**
 * Hero yang membesar, mengabur dan memudar saat digulir.
 *
 * Bungkus ini yang memberi ruang gulirnya: bagian setinggi `tinggi` dengan isi
 * `sticky` di dalamnya, jadi hero-nya diam di layar sementara halaman bergerak
 * melewatinya. Tanpa ruang itu tidak ada yang bisa dipetakan — useScroll butuh
 * jarak, dan hero setinggi satu layar tidak punya jarak sama sekali.
 *
 * YANG DIANIMASIKAN CUMA LATARNYA. Judul dan tombolnya ikut memudar tapi TIDAK
 * ikut membesar: teks yang di-scale melewati 1,0 dirender ulang buram di banyak
 * mesin, dan judul buram di halaman yang menjual ketelitian adalah harga yang
 * terlalu mahal untuk satu efek.
 */
export const ScrollZoomHero: React.FC<{
  /** Digambar di lapisan yang membesar dan mengabur. */
  latar: React.ReactNode;
  /** Digambar di atasnya; ikut memudar dan naik sedikit, tidak membesar. */
  children: React.ReactNode;
  className?: string;
}> = ({ latar, children, className }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const diam = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });

  const skala = useTransform(scrollYProgress, [0, 1], [1, 1.55]);
  const kabur = useTransform(scrollYProgress, [0, 0.65, 1], [0, 2, 9]);
  const filter = useTransform(kabur, (v) => `blur(${v.toFixed(2)}px)`);
  const pudarLatar = useTransform(scrollYProgress, [0, 0.55, 1], [1, 0.85, 0]);
  const pudarIsi = useTransform(scrollYProgress, [0, 0.42, 0.8], [1, 1, 0]);
  const naikIsi = useTransform(scrollYProgress, [0, 0.8], [0, -70]);

  if (diam) {
    return (
      <section className={`relative flex min-h-[100svh] flex-col overflow-hidden ${className ?? ''}`}>
        {latar}
        {children}
      </section>
    );
  }

  return (
    // 155vh, bukan 200vh seperti contohnya. Ruang gulirnya harus cukup panjang
    // supaya zoom-nya terasa sebagai gerak dan bukan sentakan, tapi tiap vh
    // tambahan adalah gulir yang harus dilewati pengunjung SEBELUM sampai ke isi
    // halaman — dan yang diminta justru halaman yang lebih pendek. Diukur: 200vh
    // menambah 900px, yaitu tiga perempat penghematan yang baru didapat dari
    // memindahkan daftar layar ke baris menyamping. 155vh menyisakan 495px
    // ruang zoom dan menyerahkan sisanya kembali ke halaman.
    <div ref={ref} className="relative h-[155svh]">
      <section className={`sticky top-0 flex h-[100svh] flex-col overflow-hidden ${className ?? ''}`}>
        <motion.div
          className="absolute inset-0"
          style={{ scale: skala, filter, opacity: pudarLatar, transformOrigin: '50% 62%' }}
          aria-hidden="true"
        >
          {latar}
        </motion.div>
        <motion.div className="relative z-10 flex flex-1 flex-col" style={{ opacity: pudarIsi, y: naikIsi }}>
          {children}
        </motion.div>
      </section>
    </div>
  );
};

/**
 * Akordeon FAQ.
 *
 * Ditulis sendiri, bukan Radix: repo ini tidak memakai Radix di mana pun, dan
 * menambah satu pustaka UI untuk satu daftar yang bisa dibuka-tutup akan
 * membawa serta seluruh kebiasaan penataannya ke dalam halaman yang palet dan
 * hairline-nya sudah diatur sendiri.
 *
 * TINGGINYA DIANIMASIKAN KE 'auto', dan itu memang yang dilakukan Motion dengan
 * benar sementara CSS tidak bisa: `height: auto` tidak bisa ditransisikan,
 * sehingga versi CSS-nya harus menebak tinggi maksimum — dan jawaban yang lebih
 * panjang dari tebakan itu akan terpotong diam-diam.
 */
export const Accordion: React.FC<{ items: { q: string; a: React.ReactNode }[] }> = ({ items }) => {
  const [buka, setBuka] = useState<number | null>(0);
  return (
    <div className="divide-y divide-slate-800 border-y border-slate-800">
      {items.map((it, i) => {
        const aktif = buka === i;
        return (
          <div key={it.q}>
            <button
              onClick={() => setBuka(aktif ? null : i)}
              aria-expanded={aktif}
              className="flex w-full items-center justify-between gap-4 py-5 text-left cursor-pointer"
            >
              <span className={`text-[15px] font-semibold transition-colors ${aktif ? 'text-amber-400' : 'text-slate-200'}`}>
                {it.q}
              </span>
              <motion.span
                animate={{ rotate: aktif ? 45 : 0 }}
                transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
                className="shrink-0 text-xl leading-none text-slate-500"
                aria-hidden="true"
              >
                +
              </motion.span>
            </button>
            <motion.div
              initial={false}
              animate={{ height: aktif ? 'auto' : 0, opacity: aktif ? 1 : 0 }}
              transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
              className="overflow-hidden"
            >
              <div className="pb-6 pr-8 text-sm leading-relaxed text-slate-400">{it.a}</div>
            </motion.div>
          </div>
        );
      })}
    </div>
  );
};

/**
 * Grafik garis yang menggambar dirinya sendiri waktu masuk layar.
 *
 * DATANYA SUNGGUHAN — dioper dari pemanggil, bukan dikarang di dalam komponen.
 * Sebuah grafik hiasan dengan bentuk yang dibuat-buat di halaman yang berjudul
 * "angkanya bisa dilacak ke sumbernya" adalah kontradiksi yang paling mudah
 * ditangkap pembaca, dan sekali tertangkap seluruh halaman ikut diragukan.
 */
export const LineGraph: React.FC<{
  nilai: number[];
  className?: string;
  tinggi?: number;
  warna?: string;
}> = ({ nilai, className, tinggi = 96, warna = '#ffa733' }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const inView = useInView(ref, { once: true, margin: '-15% 0px' });
  const diam = useReducedMotion();

  const { d, isi } = React.useMemo(() => {
    if (nilai.length < 2) return { d: '', isi: '' };
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of nilai) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const rentang = hi - lo || 1;
    const titik = nilai.map((v, i) => {
      const x = (i / (nilai.length - 1)) * 100;
      const y = 100 - ((v - lo) / rentang) * 92 - 4;
      return `${x.toFixed(3)},${y.toFixed(3)}`;
    });
    return {
      d: `M${titik.join('L')}`,
      isi: `M${titik.join('L')}L100,100L0,100Z`,
    };
  }, [nilai]);

  if (!d) return null;

  return (
    <div ref={ref} className={className} style={{ height: tinggi }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <defs>
          <linearGradient id="vp-line-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={warna} stopOpacity="0.22" />
            <stop offset="100%" stopColor={warna} stopOpacity="0" />
          </linearGradient>
        </defs>
        <motion.path
          d={isi}
          fill="url(#vp-line-fill)"
          initial={{ opacity: 0 }}
          animate={{ opacity: diam || inView ? 1 : 0 }}
          transition={{ duration: 0.5, delay: 0.5 }}
        />
        <motion.path
          d={d}
          fill="none"
          stroke={warna}
          strokeWidth="0.9"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: diam || inView ? 1 : 0 }}
          transition={{ duration: 1.1, ease: [0.32, 0.72, 0, 1] }}
        />
      </svg>
    </div>
  );
};

/**
 * Daftar notifikasi yang masuk satu per satu dan menumpuk.
 *
 * Dipakai untuk memperlihatkan APA yang sebenarnya dikirim alat ini pagi hari,
 * bukan sebagai hiasan: tiap kartu bentuk baris yang sungguhan dikirim radar
 * dan screener. Karena itu isinya dioper dari pemanggil.
 */
export const NotificationsList: React.FC<{
  items: { ikon: React.ReactNode; judul: string; badan: string; waktu: string }[];
}> = ({ items }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const inView = useInView(ref, { once: true, margin: '-20% 0px' });
  const diam = useReducedMotion();
  const tampil = diam || inView;

  return (
    <div ref={ref} className="space-y-2.5">
      {items.map((n, i) => (
        <motion.div
          key={n.judul}
          initial={{ opacity: 0, y: 14, scale: 0.97 }}
          animate={tampil ? { opacity: 1, y: 0, scale: 1 } : {}}
          transition={{ duration: 0.42, delay: diam ? 0 : i * 0.13, ease: [0.32, 0.72, 0, 1] }}
          className="flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-900/70 p-3.5"
        >
          <div className="mt-0.5 shrink-0">{n.ikon}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <p className="truncate text-[13px] font-semibold text-slate-100">{n.judul}</p>
              <span className="shrink-0 font-mono text-[10px] text-slate-600">{n.waktu}</span>
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-slate-400">{n.badan}</p>
          </div>
        </motion.div>
      ))}
    </div>
  );
};
