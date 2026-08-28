# Pipeline Data Pasar IDX

Seluruh data pasar di aplikasi ini berasal dari API publik dan dibangun ulang oleh
skrip di `scripts/`. Tidak ada angka yang dikarang: setiap nilai bisa ditelusuri
ke endpoint sumbernya.

## Perintah

```bash
npm run auto               # layanan otomatis: refresh terjadwal + alert + aplikasi
npm run data:all           # bangun ulang seluruh database (harga, kuotasi, fundamental)
npm run data:refresh       # harga, indeks, arus asing (IDX)      -> ~4 menit
npm run data:intraday      # harga live seluruh emiten            -> ~3 detik
npm run data:quotes        # rasio valuasi + mata uang pelaporan   -> ~30 detik
npm run data:fundamentals  # laporan keuangan tahunan              -> ~3 menit
npm run data:brokers       # aktivitas harian anggota bursa        -> ~2 menit
npm run data:ownership     # register kepemilikan KSEI bulanan     -> ~40 detik
npm run data:announcements # keterbukaan informasi IDX 45 hari     -> ~10 detik
npm run chat:dossier -- PACK  # cetak dossier yang diterima chatbot (tanpa API)
npm test                   # uji numerik guard rail mesin DCF
```

Untuk penjadwalan, alert email, dan chatbot lihat [SETUP.md](SETUP.md).

Hasilnya ditulis ke `public/data/idx/` dan dibaca browser lewat `fetch`, jadi
tidak ada masalah CORS saat aplikasi berjalan.

## Berkas keluaran

| Berkas | Isi | Ukuran |
|---|---|---|
| `universe.json` | 962 emiten tercatat: kode, nama, sektor IDX-IC, sub-industri, papan, tanggal listing, jumlah saham | 0,4 MB |
| `daily.json` | Snapshot sesi terakhir untuk seluruh emiten: OHLC, volume, nilai, frekuensi, net asing, kapitalisasi | 0,2 MB |
| `history.json` | 282 sesi perdagangan: close/high/low/volume/nilai/net-asing per emiten | 6,4 MB |
| `indices.json` | Riwayat harian 45 indeks IDX | 0,4 MB |
| `quotes.json` | P/E, P/BV, EPS, dividend yield, mata uang pelaporan, kurs USD/IDR tahunan | 0,3 MB |
| `fundamentals.json` | Laporan keuangan tahunan 648 emiten (Rp miliar) | 1,1 MB |
| `intraday.json` | Harga live seluruh emiten + IHSG/LQ45 selama sesi berjalan | 0,1 MB |
| `brokers.json` | Aktivitas harian 88 anggota bursa, 113 sesi | 0,2 MB |
| `ownership.json` | Register kepemilikan KSEI: 962 emiten × 24 bulan × 9 jenis investor × lokal/asing | 1,6 MB |
| `announcements.json` | Keterbukaan informasi IDX 45 hari terakhir: ~4.260 pengajuan dari ~940 emiten | 0,7 MB |

## Sumber

**IDX primary API** — harga, indeks, universe, profil perusahaan:

- `/primary/StockData/GetSecuritiesStock` — universe + keanggotaan sektor
- `/primary/ListedCompany/GetCompanyProfiles` — industri, sub-industri, kegiatan usaha
- `/primary/TradingSummary/GetStockSummary?date=YYYYMMDD` — OHLC + net asing seluruh emiten dalam satu panggilan
- `/primary/TradingSummary/GetIndexSummary?date=YYYYMMDD` — 45 indeks dalam satu panggilan
- `/primary/ListedCompany/GetAnnouncement` — keterbukaan informasi per emiten: RUPS, dividen,
  transaksi material, perolehan kontrak, dan permintaan penjelasan bursa.
  **`indexFrom` adalah nomor HALAMAN berbasis NOL, bukan offset baris** —
  mengirim offset baris menjawab `ResultCount: 0` tanpa error, bukan halaman
  berikutnya. Mulai dari `indexFrom=1` bukan menggeser satu baris melainkan
  membuang `pageSize` pengajuan TERBARU: dengan `pageSize=1000` crawl pulang
  membawa 3.261 dari 4.261 baris dan nol pengajuan dari 17 hari terakhir,
  sementara log dan field `to` tetap mengaku sampai hari ini. Skrip sekarang
  menolak menulis berkas kalau jumlah baris meleset >5% dari `ResultCount`
  atau kalau pengajuan terbaru berumur lebih dari 5 hari.

**Yahoo Finance** — laporan keuangan, rasio valuasi, dan harga intraday (IDX
tidak menyediakan keduanya; laporan resminya berupa XBRL `instance.zip` dan
feed hariannya end-of-day):

- `fundamentals-timeseries` — laporan laba rugi, neraca, arus kas tahunan
- `v7/finance/quote` — P/E, P/BV, `financialCurrency`, dan harga live seluruh emiten
- `^JKSE` / `^JKLQ45` — IHSG dan LQ45 live
- `IDR=X` — kurs USD/IDR harian, dirata-ratakan per tahun kalender

**KSEI Balance Posisi Efek** — satu-satunya feed kepemilikan per saham yang
publik di pasar Indonesia, dan dasar dari Mutual Fund Tracker:

- `https://www.ksei.co.id/storage/Download/BalanceposEfek<YYYYMMDD>.zip` — saldo
  kustodian akhir bulan untuk seluruh efek, dipecah ke sembilan jenis investor
  (reksa dana, asuransi, dana pensiun, bank, yayasan, individu, korporasi,
  perusahaan efek, lain-lain) dan lagi ke lokal versus asing.

Tanggal pada nama berkas adalah hari penyelesaian terakhir bulan itu, yang tidak
selalu tanggal kalender terakhir; skrip menelusuri mundur dari akhir bulan sampai
sebuah URL menjawab 200 (tanggal yang salah menjawab 302 ke halaman 404). Berkas
zip dibongkar di dalam proses dengan `zlib`, bukan lewat `unzip`, karena proses
Node yang dijalankan dari PowerShell atau runner CI tidak bisa mengandalkan
`unzip` ada di PATH.

### Kenapa ada dua lapisan harga

Feed `TradingSummary` milik IDX bersifat end-of-day **dan tertinggal satu sampai
dua hari kalender** — saat sesi Rabu pukul 11:00, sesi terakhir yang diterbitkan
sering masih Senin. Feed itu tidak akan pernah bisa menggerakkan alur "refresh
setelah Sesi I". Karena itu:

- **Lapisan intraday (Yahoo)** — harga, volume, momentum, tren. Segar tiap 15 menit.
- **Lapisan EOD (IDX)** — OHLC resmi, 45 indeks, dan **arus dana asing**.

Arus dana asing hanya ada di lapisan kedua. Saat refresh siang, faktor asing
tetap per sesi resmi terakhir, dan seluruh UI menyebutkan tanggalnya secara
eksplisit alih-alih menampilkannya sebagai nol.

## Catatan implementasi yang penting

**Transport lewat curl, bukan `fetch`.** `idx.co.id` berada di belakang Cloudflare
yang memeriksa sidik jari TLS. `fetch` bawaan Node (undici) selalu ditolak dengan
HTTP 403 apa pun header yang dikirim, sementara curl lolos. Karena itu seluruh
permintaan di `scripts/idx-lib.mjs` dijalankan melalui curl.

**Crawl harus lambat.** Percobaan pertama dengan concurrency 4 tanpa jeda membuat
Cloudflare memblokir 288 dari 308 sesi. Dengan concurrency 2, jeda 350 ms, dan
cookie jar yang dipertahankan antar-permintaan, 308 sesi berhasil ditarik tanpa
satu pun kegagalan. Menaikkan angka ini akan mempercepat crawl sampai titik di
mana crawl gagal total.

**Cache per sesi.** Respons mentah disimpan di `.cache/idx/day-YYYYMMDD.json`,
jadi menjalankan ulang ingest hanya menarik sesi baru. Gunakan `--no-cache` untuk
memaksa tarik ulang.

**Emiten pelapor USD.** 100 dari 962 emiten — terutama batu bara dan migas seperti
ADRO, ITMG, MEDC, INDY — melapor dalam USD walau diperdagangkan dalam rupiah.
Angka laporannya ditranslasikan ke IDR memakai kurs rata-rata tahun kalender untuk
setiap tahun laporan, dan kurs yang dipakai selalu ditampilkan di panel emiten.
P/BV dari Yahoo untuk emiten ini dibuang, bukan ditampilkan, karena Yahoo membagi
harga rupiah dengan nilai buku dolar sehingga hasilnya tidak bermakna.

**Sektor keuangan.** Bank dan asuransi tidak melaporkan EBITDA, laba usaha, maupun
pemisahan aset/liabilitas lancar dalam feed ini. EBIT-nya diturunkan dari laba
sebelum pajak dan emiten tersebut ditandai `suitableForUfcf: false`. Aplikasi
menampilkan peringatan bahwa DCF unlevered bukan metode yang tepat untuk mereka —
yang benar adalah residual income atau dividend discount.

**Aksi korporasi diturunkan dari data IDX sendiri.** IDX melaporkan `Previous`
yang **sudah** disesuaikan split, reverse split, dan rights issue, sementara
`Close` adalah harga mentah. Jadi ketika `Previous[i]` berbeda dari penutupan
yang kami catat untuk sesi i-1, rasio keduanya *adalah* faktor penyesuaiannya —
split 1:25 MLPT muncul persis 0,0401, dan 1:5 milik RAJA serta RMKE persis
0,2000. Tanpa ini, split 1:25 terbaca sebagai anjlok 96% dan mencemari seluruh
faktor momentum, regresi beta, dan atribusi indeks. 32 aksi korporasi terdeteksi
dalam rentang saat ini.

**Bobot free-float untuk atribusi indeks.** Field `WeightForIndex` pada
`GetStockSummary` adalah jumlah saham hasil penyesuaian free float yang dipakai
IDX untuk membobot indeksnya. Divisor indeks **diturunkan** darinya
(`Σ(bobot × harga) / nilai indeks`), bukan diambil dari field `MarketCapital`
yang diterbitkan — field itu kapitalisasi penuh, dan memakainya membuat setiap
kontribusi mengecil sekitar 4x. Divisor turunan mereproduksi penutupan
sebelumnya yang diterbitkan IDX sampai tiga desimal.

**Skala jumlah saham.** Mesin DCF membagi nilai ekuitas dengan `sharesOutstanding`
tanpa penskalaan, jadi jumlah saham harus berada pada skala yang sama dengan
`units`. Untuk model rupiah dalam miliar, TLKM adalah `99.05`, bukan `99062`.
Salah skala di sini membuat target harga meleset 1000x.

## Keterbatasan yang diketahui

- **Keterbukaan informasi bukan feed berita.** Emiten melapor ketika DIA yang
  bertindak. Pengumuman program pemerintah — proyek PLTS, mandatori biodiesel,
  program perumahan — tidak pernah masuk ke sana kecuali emitennya sendiri
  melaporkan perannya. Tema kebijakan karena itu dikurasi tangan di
  `src/data/narratives.ts`, lengkap dengan tautan sumber dan tanggal periksa;
  tema tanpa sumber bobotnya dipotong setengah dan tiap tema meluruh ke nol
  dalam 90 hari sejak terakhir diperiksa.
- **Rincian broker per saham tidak ada di sumber publik mana pun.** Yang bisa
  dihitung per saham adalah nilai ÷ frekuensi — ukuran tiket rata-rata satu
  transaksi. `history.json` menyimpan nilai tetapi tidak jumlah transaksi, jadi
  tiket sesi lampau tidak bisa direkonstruksi; perbandingannya dilakukan lintas
  pasar pada hari yang sama.
- **Chart memakai widget TradingView.** Ini satu-satunya dependensi runtime
  pihak ketiga di aplikasi: skrip dimuat dari `s3.tradingview.com` dan dirender
  dalam iframe. Tidak ada data aplikasi yang dikirim ke sana selain kode
  emitennya. Kalau skripnya diblokir, komponennya mengatakan itu dan memberi
  tautan langsung, bukan kotak kosong.

- **Kepemilikan KSEI adalah bulanan dan tanpa nama.** Satu pengamatan per akhir
  bulan, jadi bacaan terbaru bisa berumur sampai lima minggu; arus adalah selisih
  antar bulan, bukan aliran harian. Dan KSEI menerbitkan **kategori** pemegang,
  bukan nama pengelola dana — datanya bisa mengatakan reksa dana secara
  keseluruhan menambah 90 bp, tidak bisa mengatakan reksa dana yang mana.
- **Persentase kepemilikan dihitung dari register kustodian, bukan dari saham
  tercatat.** Hanya saham dalam penitipan kolektif KSEI yang muncul. Blok
  pengendali sering tercatat di luar kustodian — register BBCA hanya ~43% dari
  saham tercatatnya — sehingga penyebutnya jauh lebih dekat ke free float. Rasio
  kustodian terhadap saham tercatat selalu ditampilkan di layar.
- **Keanggotaan grup konglomerasi dikurasi manual** di `src/data/conglomerates.ts`;
  IDX tidak menerbitkan peta pengendali yang terbaca mesin. Angka *kohesi* di UI
  adalah bukti terukur apakah anggota grup benar-benar bergerak bersama.

- **Konstituen indeks adalah perkiraan.** IDX tidak menerbitkan daftar anggota
  LQ45/IDX30 secara terbaca mesin. Filter indeks di screener mendekati keanggotaan
  dengan meranking rata-rata nilai transaksi 12 bulan digabung kapitalisasi pasar,
  lalu mengambil sebanyak jumlah anggota yang dilaporkan indeks. Hasilnya tepat
  untuk blue chip tetapi tidak identik dengan daftar resmi. Indeks sektoral tidak
  terpengaruh — keanggotaannya persis sektor IDX-IC.
- **Riwayat 282 sesi (~14 bulan).** Cukup untuk momentum 12 bulan dan MA200, tetapi
  belum cukup untuk backtest lintas siklus.
- **Skor screener murni teknikal dan aliran dana.** Tidak ada faktor fundamental di
  dalamnya. P/E dan P/BV ditampilkan di browser emiten sebagai konteks, bukan
  sebagai bagian dari skor.
- **Harga intraday terlambat ~10 menit** dan hanya IHSG serta LQ45 yang punya
  kutipan indeks live; sebelas indeks sektoral tetap pada penutupan resmi
  terakhir.
- **Hari libur bursa tidak dimodelkan.** Pada hari libur feed live melaporkan
  `marketState: CLOSED` dengan harga sebelumnya, dan aplikasi menampilkannya
  sebagai data basi.
