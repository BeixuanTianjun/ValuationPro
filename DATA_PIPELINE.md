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

## Sumber

**IDX primary API** — harga, indeks, universe, profil perusahaan:

- `/primary/StockData/GetSecuritiesStock` — universe + keanggotaan sektor
- `/primary/ListedCompany/GetCompanyProfiles` — industri, sub-industri, kegiatan usaha
- `/primary/TradingSummary/GetStockSummary?date=YYYYMMDD` — OHLC + net asing seluruh emiten dalam satu panggilan
- `/primary/TradingSummary/GetIndexSummary?date=YYYYMMDD` — 45 indeks dalam satu panggilan

**Yahoo Finance** — laporan keuangan, rasio valuasi, dan harga intraday (IDX
tidak menyediakan keduanya; laporan resminya berupa XBRL `instance.zip` dan
feed hariannya end-of-day):

- `fundamentals-timeseries` — laporan laba rugi, neraca, arus kas tahunan
- `v7/finance/quote` — P/E, P/BV, `financialCurrency`, dan harga live seluruh emiten
- `^JKSE` / `^JKLQ45` — IHSG dan LQ45 live
- `IDR=X` — kurs USD/IDR harian, dirata-ratakan per tahun kalender

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
