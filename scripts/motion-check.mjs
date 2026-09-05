// Vonis untuk gerak halaman depan dan terminal.
// Jalankan dengan: npm run motion:check   (server dev harus sudah hidup di 5173)
//
// KENAPA ADA. Gerak adalah satu-satunya bagian aplikasi ini yang tidak bisa
// dibuktikan oleh tsc, oleh tes unit, maupun oleh sebuah tangkapan layar. Sebuah
// pil tab yang "meluncur" dan sebuah pil tab yang berpindah seketika
// menghasilkan DOM yang sama persis, className yang sama persis, dan tangkapan
// layar akhir yang sama persis. Yang membedakan keduanya cuma apa yang terjadi
// di antara dua bingkai — dan itu berarti satu-satunya cara memeriksanya adalah
// merekam nilainya bingkai demi bingkai di browser sungguhan.
//
// KASUS YANG MELAHIRKANNYA. Tiga kali berturut-turut efek gerak dikirim dengan
// catatan "belum pernah terlihat bergerak": panel pratinjau tempat repo ini
// diuji ternyata tidak pernah menyalakan requestAnimationFrame sama sekali
// (diukur: nol panggilan setelah event scroll), sehingga SELURUH frame loop
// Motion mati di sana. Keadaan akhirnya benar, jadi tidak ada yang gagal dan
// tidak ada yang mengeluh — persis kelas bug yang paling mahal di repo ini:
// hasil yang masuk akal tanpa satu pun galat.
//
// Chrome sungguhan lewat playwright-core, bukan panel pratinjaunya.

import { chromium } from 'playwright-core';

const URL = process.env.VP_URL || 'http://localhost:5173';
const CHROME =
  process.env.VP_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const hasil = [];
const cek = (nama, ok, detail = '') => hasil.push({ nama, ok, detail: ok ? '' : String(detail) });

/**
 * Rekam sebuah nilai tiap bingkai selama `ms`, di dalam halaman.
 *
 * Dikirim sebagai teks fungsi karena ia dijalankan di konteks halaman, bukan di
 * Node. Yang dikembalikan deret nilai — bukan nilai awal dan akhir saja, karena
 * pertanyaannya justru apakah ada sesuatu DI ANTARA keduanya.
 */
async function rekam(page, ekspresiJs, ms = 700) {
  return page.evaluate(
    ([ekspresi, durasi]) =>
      new Promise((selesai) => {
        // eslint-disable-next-line no-new-func
        const baca = new Function(`return (${ekspresi});`);
        const deret = [];
        const t0 = performance.now();
        const langkah = () => {
          try {
            deret.push(baca());
          } catch {
            deret.push(null);
          }
          if (performance.now() - t0 < durasi) requestAnimationFrame(langkah);
          else selesai(deret);
        };
        requestAnimationFrame(langkah);
      }),
    [ekspresiJs, ms]
  );
}

const skalaDari = (t) => {
  if (!t || t === 'none') return 1;
  const m = t.match(/matrix\(([^)]+)\)/);
  return m ? parseFloat(m[1].split(',')[0]) : 1;
};
const kaburDari = (f) => {
  if (!f || f === 'none') return 0;
  const m = f.match(/blur\(([\d.]+)px\)/);
  return m ? parseFloat(m[1]) : 0;
};
const naikTegas = (a) => a.every((v, i) => i === 0 || v >= a[i - 1] - 1e-6) && a[a.length - 1] > a[0] + 1e-6;

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const galat = [];
  page.on('pageerror', (e) => galat.push(e.message));

  await page.goto(URL, { waitUntil: 'load', timeout: 45000 });
  await page.waitForSelector('h1', { timeout: 20000 });
  // Basis data pasar dimuat dua fase; latarnya baru digambar setelah fase
  // pertama sampai. Menunggu kanvasnya benar-benar terisi, bukan menunggu
  // sekian detik dan berharap.
  await page
    .waitForFunction(
      () => [...document.querySelectorAll('canvas')].some((c) => c.width > 400),
      { timeout: 25000 }
    )
    .catch(() => {});

  // -------------------------------------------------------------------------
  // 1. HERO YANG MEMBESAR SAAT DIGULIR.
  //
  // Yang diperiksa bukan cuma "berubah", tapi berubah DI RENTANG YANG BENAR.
  // Hero ini `sticky` di dalam pembungkus yang lebih tinggi dari layar, dan ia
  // berhenti menempel begitu ujung bawah pembungkusnya sampai di bawah layar —
  // di sini pada 495px. Kalau pemetaan gulirnya salah, sebagian besar zoom-nya
  // terjadi SETELAH hero mulai naik keluar layar, yaitu saat tidak ada lagi yang
  // melihatnya. Efeknya "jalan" dan tetap tidak terasa.
  // -------------------------------------------------------------------------
  const ukur = await page.evaluate(() => {
    const sticky = document.querySelector('section.sticky');
    const bungkus = sticky?.parentElement;
    if (!sticky || !bungkus) return null;
    return { tinggiBungkus: bungkus.getBoundingClientRect().height, tinggiLayar: innerHeight };
  });
  cek('hero punya pembungkus sticky', !!ukur, 'section.sticky tidak ditemukan');

  if (ukur) {
    const rentangLengket = Math.round(ukur.tinggiBungkus - ukur.tinggiLayar);
    const ambil = async (y) => {
      await page.evaluate((v) => window.scrollTo({ top: v, behavior: 'instant' }), y);
      await page.waitForTimeout(220);
      return page.evaluate(() => {
        const el = document.querySelector('section.sticky')?.firstElementChild;
        const cs = getComputedStyle(el);
        return { t: cs.transform, f: cs.filter, o: parseFloat(cs.opacity) };
      });
    };

    // DIUKUR SEPANJANG SELURUH PEMBUNGKUS, bukan cuma sepanjang rentang
    // lengketnya. Versi pertama vonis ini hanya mencicipi rentang lengket lalu
    // membandingkan totalnya dengan dirinya sendiri — `totalNaik / totalNaik`,
    // yang selalu 1 dan karenanya selalu LULUS. Ia tidak pernah bisa menangkap
    // justru satu-satunya hal yang ingin ditangkapnya. Untuk tahu berapa BAGIAN
    // gerak yang terjadi selagi terlihat, keduanya harus diukur: yang di dalam
    // rentang lengket, dan yang di sepanjang pembungkus penuh.
    const ambilBanyak = async (daftar) => {
      const keluar = [];
      for (const y of daftar) keluar.push(await ambil(y));
      return keluar;
    };

    const penuh = Math.round(ukur.tinggiBungkus);
    const contohLengket = await ambilBanyak([0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(rentangLengket * f)));
    const contohPenuh = await ambilBanyak([0, 0.5, 1].map((f) => Math.round(penuh * f)));

    // HERO-NYA BENAR-BENAR MENEMPEL?
    //
    // Vonis ini ada karena semua vonis lain di blok ini LULUS pada hero yang
    // tidak menempel sama sekali. `scrollYProgress` tetap maju, jadi zoom, kabur
    // dan pudarnya berjalan normal — sementara hero-nya sendiri naik keluar
    // layar seperti elemen biasa dan seluruh efeknya dimainkan untuk ruang
    // kosong. Tidak ada galat, tidak ada yang terlihat rusak.
    //
    // Penyebabnya waktu itu `overflow-x: hidden` pada sebuah elemen leluhur:
    // itu menjadikannya scroll container, dan `position: sticky` di dalam scroll
    // container menempel pada container-nya, bukan pada layar.
    const atasSticky = [];
    for (const y of [0, Math.round(rentangLengket / 2), rentangLengket]) {
      await page.evaluate((v) => window.scrollTo({ top: v, behavior: 'instant' }), y);
      await page.waitForTimeout(200);
      atasSticky.push(
        await page.evaluate(() => Math.round(document.querySelector('section.sticky').getBoundingClientRect().top))
      );
    }
    cek(
      'hero benar-benar menempel selama rentang lengketnya',
      atasSticky.every((t) => Math.abs(t) <= 2),
      `tepi atas hero pada 0/50/100%: ${JSON.stringify(atasSticky)} — seharusnya tetap 0`
    );

    const skala = contohLengket.map((c) => skalaDari(c.t));
    const kabur = contohLengket.map((c) => kaburDari(c.f));
    const opak = contohLengket.map((c) => c.o);

    cek('latar hero membesar saat digulir', naikTegas(skala), JSON.stringify(skala));
    cek('latar hero mengabur saat digulir', naikTegas(kabur), JSON.stringify(kabur));
    cek('latar hero memudar saat digulir', opak[opak.length - 1] < opak[0] - 0.02, JSON.stringify(opak));

    // Vonis yang sebenarnya: sebagian besar gerak harus sudah terjadi sebelum
    // hero berhenti menempel. Apa pun setelah itu terjadi selagi hero naik
    // keluar layar — efeknya "jalan" dan tetap tidak pernah terasa.
    const naikLengket = skala[skala.length - 1] - skala[0];
    const naikPenuh = skalaDari(contohPenuh[contohPenuh.length - 1].t) - skalaDari(contohPenuh[0].t);
    const bagianTerlihat = naikPenuh > 1e-6 ? naikLengket / naikPenuh : 0;
    cek(
      'sebagian besar zoom terjadi selagi hero masih menempel',
      bagianTerlihat >= 0.8,
      `hanya ${(bagianTerlihat * 100).toFixed(0)}% dari zoom terjadi selagi terlihat ` +
        `(lengket ${naikLengket.toFixed(3)} dari total ${naikPenuh.toFixed(3)})`
    );

    // Dan geraknya harus HALUS, bukan dua keadaan. Kalau nilai tengahnya sama
    // dengan salah satu ujungnya, yang terjadi lompatan, bukan animasi.
    const adaTengah = skala.slice(1, -1).some((v) => v > skala[0] + 1e-3 && v < skala[skala.length - 1] - 1e-3);
    cek('zoom melewati nilai antara, bukan melompat', adaTengah, JSON.stringify(skala));

    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForTimeout(200);
  }

  // -------------------------------------------------------------------------
  // 2. JUDUL YANG MENGETIK.
  // -------------------------------------------------------------------------
  {
    // 3.400ms, bukan 900ms. Frasa penuh sengaja DIDIAMKAN 2.200ms sebelum
    // dihapus, jadi jendela 900ms bisa jatuh seluruhnya di dalam jeda itu dan
    // melaporkan "tidak mengetik" pada komponen yang bekerja dengan benar.
    // Jendelanya harus lebih panjang dari jeda terpanjangnya.
    const deret = await rekam(page, "document.querySelector('h1')?.innerText || ''", 3400);
    const beda = new Set(deret.filter(Boolean)).size;
    cek('judul mengetik sendiri', beda > 3, `${beda} keadaan berbeda dalam 3400ms`);
  }

  // -------------------------------------------------------------------------
  // 3. BARIS FITUR YANG BERJALAN, DAN IKUT KECEPATAN GULIR.
  //
  // Dua vonis terpisah, karena keduanya bisa gagal sendiri-sendiri: barisnya
  // bisa berjalan tapi mengabaikan gulir (itu marquee biasa), atau bereaksi pada
  // gulir tapi diam saat tidak digulir.
  // -------------------------------------------------------------------------
  {
    await page.evaluate(() => {
      const baris = [...document.querySelectorAll('.overflow-hidden > .flex.w-max')].filter(
        (e) => !e.className.includes('animate-marquee')
      );
      window.__baris = baris[0] || null;
      baris[0]?.scrollIntoView({ block: 'center', behavior: 'instant' });
    });
    // 1.100ms, bukan 300ms. `scrollIntoView` ITU SENDIRI sebuah gulir, dan
    // spring kecepatannya masih meluruh sesudahnya. Menakar "laju diam" pada
    // 300ms menakar sisa lemparan barusan, bukan laju dasarnya — terukur 5,05
    // px/bingkai pada baris yang laju diam sebenarnya di bawah 1. Baseline yang
    // ketinggian itulah yang membuat vonis ini kadang gagal tanpa sebab.
    await page.waitForTimeout(1100);

    /**
     * Laju per bingkai yang tahan terhadap lompatan `wrap`.
     *
     * Barisnya melingkar: begitu satu salinan penuh lewat, `x` melompat kembali
     * sejauh lebar salinan itu — ribuan piksel dalam satu bingkai. Mengukur
     * laju dengan (akhir - awal) / jumlah bingkai menjadi omong kosong kalau
     * lompatan itu kebetulan terjadi di tengah perekaman, dan KAPAN ia terjadi
     * murni bergantung pada di mana barisnya sedang berada saat tes dimulai.
     * Itu sumber sesungguhnya dari vonis yang kadang lulus kadang tidak.
     *
     * Median dari selisih antar-bingkai kebal terhadapnya: satu lompatan cuma
     * satu pencilan di antara puluhan selisih yang wajar.
     */
    const lajuMedian = (deret) => {
      const d = [];
      for (let i = 1; i < deret.length; i++) {
        const selisih = Math.abs(deret[i] - deret[i - 1]);
        if (selisih < 60) d.push(selisih); // apa pun di atas ini sebuah lompatan wrap
      }
      if (!d.length) return 0;
      d.sort((a, b) => a - b);
      return d[Math.floor(d.length / 2)];
    };

    const diam = await rekam(page, "window.__baris ? getComputedStyle(window.__baris).transform : null", 900);
    const geserDiam = diam.filter(Boolean).map((t) => {
      const m = String(t).match(/matrix\(([^)]+)\)/);
      return m ? parseFloat(m[1].split(',')[4]) : 0;
    });
    const bergerakSendiri = geserDiam.length > 4 && lajuMedian(geserDiam) > 0.05;
    cek('baris fitur berjalan sendiri tanpa digulir', bergerakSendiri, JSON.stringify(geserDiam.slice(0, 4)));

    const lajuDasar = lajuMedian(geserDiam);

    const sambilGulir = await page.evaluate(
      () =>
        new Promise((selesai) => {
          const el = window.__baris;
          const deret = [];
          let i = 0;
          const y0 = scrollY;
          const langkah = () => {
            scrollTo({ top: y0 + i * 60, behavior: 'instant' });
            const m = String(getComputedStyle(el).transform).match(/matrix\(([^)]+)\)/);
            deret.push(m ? parseFloat(m[1].split(',')[4]) : 0);
            i++;
            if (i < 34) requestAnimationFrame(langkah);
            else selesai(deret);
          };
          requestAnimationFrame(langkah);
        })
    );
    const lajuGulir = lajuMedian(sambilGulir);
    cek(
      'kecepatan gulir benar-benar mengubah laju barisnya',
      lajuGulir > lajuDasar * 1.4,
      `laju diam ${lajuDasar.toFixed(2)} px/bingkai vs saat digulir ${lajuGulir.toFixed(2)}`
    );
  }

  // -------------------------------------------------------------------------
  // 4. TERMINAL: PIL TAB YANG MELUNCUR.
  //
  // Vonis pentingnya bukan "pilnya pindah" — itu terjadi juga tanpa animasi apa
  // pun. Yang diperiksa apakah ia SINGGAH di posisi antara. Sebuah pil yang
  // meluncur melewati puluhan koordinat; yang berpindah seketika cuma punya dua.
  // -------------------------------------------------------------------------
  {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /Buka Terminal/.test(x.innerText));
      b?.click();
    });
    await page.waitForSelector('#fn-cmd', { timeout: 20000 });
    await page.waitForTimeout(1200);

    const kiriPil = await page.evaluate(
      () =>
        new Promise((selesai) => {
          const nav = document.querySelector('nav[aria-label="Bagian pasar"]');
          if (!nav) return selesai(null);
          const tombol = [...nav.querySelectorAll('button')];
          const tujuan = tombol.find((b) => /Portofolio|Stock Watchlist|Event Radar/.test(b.innerText));
          if (!tujuan) return selesai(null);
          const deret = [];
          let n = 0;
          const langkah = () => {
            const pil = nav.querySelector('button[aria-current="page"] > span:first-child');
            deret.push(pil ? Math.round(pil.getBoundingClientRect().left) : null);
            n++;
            if (n < 40) requestAnimationFrame(langkah);
            else selesai(deret);
          };
          tujuan.click();
          requestAnimationFrame(langkah);
        })
    );

    if (!kiriPil) {
      cek('pil tab ditemukan', false, 'nav atau tombol tujuan tidak ada');
    } else {
      const nilai = kiriPil.filter((v) => v != null);
      const unik = [...new Set(nilai)];
      cek('pil tab berpindah', unik.length > 1, JSON.stringify(unik));
      // Tiga posisi berbeda sudah cukup membuktikan ia meluncur, bukan melompat.
      cek('pil tab MELUNCUR, bukan melompat', unik.length >= 3, `hanya ${unik.length} posisi: ${JSON.stringify(unik)}`);
    }
  }

  // -------------------------------------------------------------------------
  // 5. TERMINAL: KODE FUNGSI YANG MENGACAK.
  // -------------------------------------------------------------------------
  {
    const deret = await rekam(
      page,
      "(document.querySelector('#fn-cmd') ? (document.querySelectorAll('.font-mono')[0]?.innerText || '') : '')",
      700
    );
    const beda = new Set(deret.filter((v) => v !== null && v !== '')).size;
    // Boleh 1 kalau acakannya kebetulan sudah selesai sebelum perekaman mulai;
    // yang tidak boleh nol.
    cek('baris fungsi terbaca', beda >= 1, `${beda} keadaan`);
  }

  // -------------------------------------------------------------------------
  // 6. TIDAK ADA GALAT YANG DILEMPAR SELAMA SEMUA INI.
  // -------------------------------------------------------------------------
  cek('tidak ada galat halaman', galat.length === 0, galat.join(' | '));

  await browser.close();

  let gagal = 0;
  for (const r of hasil) {
    if (!r.ok) gagal++;
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.nama}${r.detail ? `  (${r.detail})` : ''}`);
  }
  console.log(`\n${hasil.length - gagal}/${hasil.length} passed`);
  if (gagal > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
