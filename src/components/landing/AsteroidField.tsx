// Bidang asteroid di hero halaman depan.
//
// DARI MANA IDENYA. Michael mengirim tautan halaman peluncuran GPT-6 Astra dan
// minta hero-nya "mirip kaya gini" — asteroid, bereaksi ke kursor, dan ikut
// waktu digulir. Halamannya sendiri TIDAK BISA saya buka: OpenAI menaruhnya di
// belakang perlindungan bot Cloudflare, dan baik pengambil biasa maupun Chrome
// sungguhan cuma dapat 403 dan halaman "Just a moment...". Jadi yang ditiru di
// sini deskripsi Michael, BUKAN rancangan mereka. Kalau nanti hasilnya tidak
// mirip, itu sebabnya, dan itu perlu dikatakan di muka.
//
// TIAP ASTEROID SEBUAH EMITEN, dan itu bukan hiasan yang kebetulan dipasangi
// data. Seluruh dalil halaman ini "angkanya bisa dilacak ke sumbernya"; sebuah
// bidang partikel acak di atas kalimat itu adalah kontradiksi yang paling
// gampang ditangkap pembaca. Maka:
//
//   ukuran   = kapitalisasi pasar (akar pangkat tiga, lihat catatan di bawah)
//   warna    = naik atau turun pada sesi ini
//   kedalaman= diundi dari kodenya, tetap sama tiap kali dimuat
//
// Yang bergerak di layar memang bentuk bursanya hari ini, sama seperti skyline
// yang digantikannya.

import React, { useEffect, useRef } from 'react';
import { MarketDatabase } from '../../data/marketRepository';
import { CHART } from '../../theme/chart';

type Batu = {
  /** Posisi dasar dalam satuan 0..1 terhadap bidang, sebelum semua pergeseran. */
  bx: number;
  by: number;
  /** Kedalaman 0,25..1. Yang dekat lebih besar, lebih terang, dan bergerak lebih jauh. */
  z: number;
  /** Jari-jari dalam piksel pada z = 1. */
  r: number;
  naik: boolean;
  /** Simpul poligonnya, sebagai jari-jari relatif per sudut. Bentuk batu, bukan lingkaran. */
  simpul: number[];
  sudut: number;
  putar: number;
  hanyutX: number;
  hanyutY: number;
  /** Simpangan sementara akibat dorongan kursor; meluruh kembali ke nol. */
  dx: number;
  dy: number;
};

/** Acak deterministik dari sebuah string. Kode emiten yang sama selalu jatuh di tempat yang sama. */
function undi(teks: string, garam: number): number {
  let h = 2166136261 ^ garam;
  for (let i = 0; i < teks.length; i++) {
    h ^= teks.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // >>> 0 supaya hasilnya tidak pernah negatif.
  return ((h >>> 0) % 100000) / 100000;
}

export const AsteroidField: React.FC<{ db: MarketDatabase | null }> = ({ db }) => {
  const ref = useRef<HTMLCanvasElement | null>(null);
  /** Posisi kursor dalam piksel bidang. -1 berarti kursornya sedang tidak di sini. */
  const tikus = useRef({ x: -1, y: -1, ada: false });
  const gulir = useRef(0);

  useEffect(() => {
    const cv = ref.current;
    if (!cv || !db) return;

    const diam = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    // --- bangun batunya sekali -----------------------------------------------
    const kandidat: { kode: string; cap: number; naik: boolean }[] = [];
    for (const e of db.emiten) {
      const q = db.daily.get(e.code);
      if (!q || !(q.close > 0) || !(q.listedShares > 0)) continue;
      kandidat.push({ kode: e.code, cap: q.close * q.listedShares, naik: q.change >= 0 });
    }
    if (!kandidat.length) return;
    kandidat.sort((a, b) => b.cap - a.cap);

    // AKAR PANGKAT TIGA, seperti pada skyline yang digantikannya, dan alasannya
    // sama: kapitalisasi terbesar di bursa ini ribuan kali lipat yang terkecil.
    // Dipetakan linear, satu batu memenuhi layar dan sembilan ratus sisanya jadi
    // titik sub-piksel. Yang perlu dikatakan terang-terangan: ukuran batunya
    // BUKAN proporsi kapitalisasinya.
    const akarMaks = Math.cbrt(kandidat[0].cap);

    const batu: Batu[] = kandidat.map((k) => {
      const z = 0.25 + undi(k.kode, 3) * 0.75;
      const sisi = 6 + Math.floor(undi(k.kode, 11) * 4); // 6..9 simpul
      const simpul: number[] = [];
      for (let i = 0; i < sisi; i++) {
        // 0,62..1,0 — cukup tidak beraturan untuk terbaca sebagai batu, tidak
        // cukup untuk terbaca sebagai pecahan kaca.
        simpul.push(0.62 + undi(k.kode, 20 + i) * 0.38);
      }
      return {
        bx: undi(k.kode, 1),
        by: undi(k.kode, 2),
        z,
        r: 1.6 + (Math.cbrt(k.cap) / akarMaks) * 26,
        naik: k.naik,
        simpul,
        sudut: undi(k.kode, 5) * Math.PI * 2,
        putar: (undi(k.kode, 6) - 0.5) * 0.22,
        hanyutX: (undi(k.kode, 7) - 0.5) * 5.5,
        hanyutY: (undi(k.kode, 8) - 0.5) * 3.2,
        dx: 0,
        dy: 0,
      };
    });

    let w = 0;
    let h = 0;
    let dpr = 1;
    let ctx: CanvasRenderingContext2D | null = null;

    const ukur = () => {
      const lw = cv.clientWidth;
      const lh = cv.clientHeight;
      if (!lw || !lh) return false;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = lw;
      h = lh;
      cv.width = Math.floor(w * dpr);
      cv.height = Math.floor(h * dpr);
      ctx = cv.getContext('2d');
      if (!ctx) return false;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return true;
    };

    // BERAPA BANYAK YANG DIGAMBAR. Sembilan ratus poligon per bingkai pada 60fps
    // di layar yang juga sedang memuat basis data 2 MB bukan pertukaran yang
    // sehat, dan bidang yang tersendat justru lebih murah kelihatannya daripada
    // bidang yang lebih jarang. Yang digambar yang terbesar lebih dulu, dan
    // jumlahnya mengikuti lebar layar — di ponsel jauh lebih sedikit, karena di
    // sanalah anggaran bingkainya paling sempit.
    const jumlah = () => Math.max(90, Math.min(batu.length, Math.round((w * h) / 5200)));

    const DORONG = 128; // jangkauan dorongan kursor, dalam piksel

    const gambar = (dt: number) => {
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);

      const n = jumlah();
      const mx = tikus.current.x;
      const my = tikus.current.y;
      const adaTikus = tikus.current.ada;

      // Paralaks kursor: seluruh bidang bergeser sedikit BERLAWANAN arah kursor,
      // dan yang dekat bergeser lebih jauh dari yang jauh. Ini yang membuat
      // bidangnya terbaca punya kedalaman, terpisah dari dorongan per batu.
      const pgx = adaTikus ? ((mx - w / 2) / w) * -26 : 0;
      const pgy = adaTikus ? ((my - h / 2) / h) * -16 : 0;

      for (let i = 0; i < n; i++) {
        const b = batu[i];

        if (!diam) {
          b.sudut += b.putar * dt;
          b.bx += (b.hanyutX * dt) / Math.max(w, 1);
          b.by += (b.hanyutY * dt) / Math.max(h, 1);
          // Melingkar di keempat sisinya, jadi bidangnya tidak pernah menipis.
          if (b.bx < -0.1) b.bx += 1.2;
          if (b.bx > 1.1) b.bx -= 1.2;
          if (b.by < -0.1) b.by += 1.2;
          if (b.by > 1.1) b.by -= 1.2;
        }

        // GULIR: yang dekat bergerak lebih cepat dari yang jauh. Itu seluruh isi
        // "ikut waktu digulir" — bukan bidangnya digeser utuh, karena bidang
        // yang bergeser utuh terbaca sebagai gambar yang ditarik, bukan sebagai
        // ruang yang dilewati.
        const y = b.by * h + gulir.current * b.z * 0.42 + pgy * b.z;
        const x = b.bx * w + pgx * b.z;

        // Dibungkus lagi setelah pergeseran gulir, supaya batunya tidak pernah
        // habis di bagian atas bidang waktu halamannya digulir jauh.
        const yy = ((y % (h + 160)) + h + 160) % (h + 160) - 80;

        let ax = x + b.dx;
        let ay = yy + b.dy;

        // DORONGAN KURSOR. Yang didorong SIMPANGANNYA, bukan posisi dasarnya —
        // jadi begitu kursornya pergi, batunya pulang ke tempatnya sendiri
        // alih-alih meninggalkan lubang permanen di bidangnya.
        if (adaTikus && !diam) {
          const jx = ax - mx;
          const jy = ay - my;
          const jarak = Math.hypot(jx, jy);
          if (jarak < DORONG && jarak > 0.01) {
            const kuat = (1 - jarak / DORONG) ** 2;
            // Yang dekat (z besar) terdorong lebih jauh: sebuah batu di
            // kejauhan yang melompat sama jauhnya dengan yang di depan akan
            // menghancurkan kedalaman yang baru saja dibangun.
            const daya = kuat * 42 * b.z;
            b.dx += (jx / jarak) * daya * dt * 6;
            b.dy += (jy / jarak) * daya * dt * 6;
          }
        }
        // Peluruhan. Tanpa ini simpangannya menumpuk dan seluruh bidang
        // perlahan terlempar keluar layar.
        const luruh = Math.exp(-dt * 3.1);
        b.dx *= luruh;
        b.dy *= luruh;
        ax = x + b.dx;
        ay = yy + b.dy;

        const r = b.r * b.z;
        if (ax < -40 || ax > w + 40 || ay < -40 || ay > h + 40) continue;

        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(b.sudut);
        ctx.beginPath();
        const s = b.simpul;
        for (let k = 0; k < s.length; k++) {
          const a = (k / s.length) * Math.PI * 2;
          const rr = r * s[k];
          const px = Math.cos(a) * rr;
          const py = Math.sin(a) * rr;
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();

        // Isinya nyaris hitam dan tepinya yang berwarna. Batu yang diisi penuh
        // warna terbaca sebagai konfeti; yang tergambar dari tepinya terbaca
        // sebagai benda.
        ctx.globalAlpha = 0.55 * b.z;
        ctx.fillStyle = '#08080c';
        ctx.fill();
        ctx.globalAlpha = (b.naik ? 0.62 : 0.3) * b.z;
        ctx.strokeStyle = b.naik ? CHART.amber : CHART.tickMuted;
        ctx.lineWidth = Math.max(0.6, r * 0.09);
        ctx.stroke();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    };

    let raf = 0;
    let hidup = true;
    let terakhir = 0;

    const langkah = (t: number) => {
      if (!hidup) return;
      const dt = terakhir ? Math.min((t - terakhir) / 1000, 0.05) : 0.016;
      terakhir = t;
      gambar(dt);
      raf = requestAnimationFrame(langkah);
    };

    const mulai = () => {
      if (!ukur()) return;
      // TAB TERSEMBUNYI TIDAK MENJALANKAN requestAnimationFrame. Pelajaran yang
      // sudah dibayar dua kali di berkas sebelah: membuka tautan di tab latar
      // adalah cara paling biasa orang membuka tautan, dan versi yang cuma
      // menjadwalkan bingkai pertamanya akan menunggu selamanya — latarnya
      // kosong bahkan setelah tabnya dibuka.
      gambar(0.016);
      if (diam) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(langkah);
    };

    const ro = new ResizeObserver(mulai);
    ro.observe(cv);

    const onGulir = () => {
      gulir.current = window.scrollY;
    };
    // Kursornya dilacak di WINDOW, bukan di kanvasnya. Kanvas ini
    // `pointer-events: none` supaya tidak pernah menelan klik tombol di
    // atasnya, dan elemen yang tidak menerima pointer juga tidak menerima
    // mousemove — dipasang di kanvas, dorongannya tidak akan pernah menyala.
    const onGerak = (e: MouseEvent) => {
      const kotak = cv.getBoundingClientRect();
      tikus.current = { x: e.clientX - kotak.left, y: e.clientY - kotak.top, ada: true };
    };
    const onKeluar = () => {
      tikus.current = { x: -1, y: -1, ada: false };
    };

    window.addEventListener('scroll', onGulir, { passive: true });
    window.addEventListener('mousemove', onGerak, { passive: true });
    window.addEventListener('mouseout', onKeluar, { passive: true });
    onGulir();

    return () => {
      hidup = false;
      ro.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onGulir);
      window.removeEventListener('mousemove', onGerak);
      window.removeEventListener('mouseout', onKeluar);
    };
  }, [db]);

  return (
    <canvas
      ref={ref}
      data-vp="asteroid"
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    />
  );
};
