# Menjalankan ValuationPro

## Sekali jalan

```bash
npm install
npm run data:all     # bangun database IDX (~8 menit, sekali saja)
npm run auto         # layanan otomatis + aplikasi di http://localhost:8787
```

`npm run auto` menjalankan satu proses yang mengurus tiga hal: menyajikan
aplikasi, memperbarui data secara terjadwal, dan mengirim alert email.

Untuk mengembangkan tampilan, jalankan `npm run dev` di terminal kedua — Vite
mem-proxy `/api` ke layanan di port 8787.

## Jadwal otomatis

Semua waktu dalam WIB dan dihitung dari zona `Asia/Jakarta`, bukan dari jam
sistem, sehingga tetap benar walau timezone laptop salah.

| Waktu | Yang terjadi |
|---|---|
| Tiap 15 menit selama sesi | Harga live seluruh 962 emiten diperbarui |
| **12:05** (Sen–Kam) / **11:35** (Jum) | **Sesi I ditutup** → refresh + screener + **alert email** |
| 16:20 | Pasar tutup → refresh + screener + alert email |
| 07:30 dan 18:30 | Tarik data resmi IDX (OHLC final + arus dana asing) |
| Sabtu 08:00 | Perbarui laporan keuangan, rasio valuasi, dan aktivitas broker |

Jam perdagangan yang dipakai: Sesi I 09:00–12:00 (Jumat 09:00–11:30), Sesi II
13:30–15:49 (Jumat 14:00–15:49), lelang penutupan sampai 16:15.

**Hari libur bursa dikenali otomatis.** IDX tidak menerbitkan kalender libur
yang terbaca mesin, jadi kalendernya diturunkan dari crawl itu sendiri: hari
kerja di dalam rentang yang tidak menghasilkan sesi adalah hari libur. Saat ini
24 tanggal dikenali — termasuk Natal, Tahun Baru, Idulfitri, dan 17 Agustus.
Tidak ada pekerjaan yang mengasumsikan sesi hidup berjalan pada tanggal itu.

Hari kerja *setelah* sesi terakhir yang diterbitkan IDX tidak dianggap libur —
IDX hanya belum menerbitkannya. Menyamakan keduanya akan membuat scheduler
melewatkan hari perdagangan yang sebenarnya ada.

## Akun & administrator

Saat pertama kali dibuka, aplikasi meminta Anda membuat **akun administrator**.
Alamat email akun itulah yang dipakai untuk mengirim alert stock pick harian —
mengalahkan `ALERT_EMAIL_TO` di `.env`. Akun berikutnya berperan sebagai
*anggota*: bisa memakai terminal, tetapi tidak menerima alert dan tidak bisa
memicu refresh.

Setelah akun pertama ada, seluruh endpoint `/api/*` memerlukan sesi. Sebelum itu
API terbuka — kalau tidak, instalasi baru tidak akan pernah bisa disiapkan.

Bagaimana kata sandi disimpan:

- Hanya hash **scrypt** dan salt acak 16-byte per pengguna yang ditulis ke
  `.data/users.json`. Kata sandinya sendiri tidak pernah menyentuh disk.
- Perbandingan memakai `timingSafeEqual`, jadi lama proses tidak membocorkan
  seberapa dekat tebakan.
- Token sesi 32 byte acak, dikirim sebagai cookie `HttpOnly` + `SameSite=Strict`
  sehingga skrip halaman tidak bisa membacanya. Berlaku 12 jam.
- Login gagal dibatasi 8 percobaan per 15 menit per alamat email.
- Email yang tidak terdaftar dan kata sandi yang salah menghasilkan pesan yang
  sama persis, jadi endpoint ini tidak bisa dipakai mendata akun yang ada.

**Batasan yang harus Anda tahu:** layanan ini berbicara HTTP biasa di localhost.
Di antarmuka loopback itu wajar. Kalau Anda pernah mengikat port-nya ke jaringan
atau internet, kredensial akan lewat dalam bentuk teks biasa — pasang TLS di
depannya lebih dulu. File statis di `/data` disajikan tanpa pemeriksaan sesi;
isinya data pasar IDX yang memang publik.

`.data/` sudah masuk `.gitignore`.

## Alert email

Alert dikirim ke email administrator. SMTP-nya sendiri tetap diisi di `.env`:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=alamat-anda@gmail.com
SMTP_PASS=xxxx xxxx xxxx xxxx
ALERT_EMAIL_TO=alamat-anda@gmail.com
```

Untuk Gmail, `SMTP_PASS` **harus** App Password 16 huruf, bukan password akun
Anda. Aktifkan 2-Step Verification lalu buat App Password di
<https://myaccount.google.com/apppasswords>. Isi sendiri — saya tidak menyimpan
atau menuliskan kredensial apa pun ke dalam repo, dan `.env` sudah masuk
`.gitignore`.

Setelah diisi, restart `npm run auto`. Baris status di aplikasi akan berubah
menjadi "Alert → alamat-anda@gmail.com (akun administrator)", dan tombol
**Uji alert** muncul di sebelahnya untuk mengirim satu email sekarang juga.

Kalau SMTP menolak, pesannya tampil apa adanya di baris status. Yang paling
sering: **535 Username and Password not accepted** — artinya nilai `SMTP_PASS`
bukan App Password yang sah.

`.env` dibaca saat layanan start. Setelah mengubahnya, **restart `npm run auto`**
— proses yang sedang berjalan masih memegang nilai lama.

Setiap job hanya berjalan sekali per jendela waktunya, dan catatan itu disimpan
di `.data/job-state.json`. Jadi me-restart layanan setelah pasar tutup tidak
mengirim ulang digest yang sudah terkirim hari itu. Hapus file tersebut kalau
Anda memang ingin memaksa satu jendela berjalan lagi.

Melihat bentuk emailnya tanpa mengirim apa pun:

```
http://localhost:8787/api/alert/preview
```

Mengirim satu email uji coba sekarang:

```bash
curl -X POST http://localhost:8787/api/alert/test
```

Isi email dibangun dari dua sistem yang sama dengan yang tampil di terminal —
Screener (aturan keras) dan Watchlist (corong empat tahap). Tidak ada saklar
strategi: mengubah pick berarti mengubah aturan di `src/models/stockScreener.ts`
atau `src/models/watchlist.ts`.

## Chatbot

Chatbot berfungsi penuh tanpa konfigurasi apa pun. Parser bahasa Indonesia
menerjemahkan pertanyaan menjadi filter atas 962 emiten dan menjalankannya
langsung — di browser kalau layanan mati, di server kalau hidup.

Mengisi `ANTHROPIC_API_KEY` di `.env` menambah lapisan Claude untuk pertanyaan
yang lebih bebas. Claude **tidak** menjawab dari ingatannya: ia memanggil mesin
query yang sama sebagai tool, jadi angkanya tetap berasal dari database. Kalau
API-nya gagal, jawaban otomatis kembali ke mesin lokal.

## Keterbatasan yang perlu Anda tahu

**Arus dana asing hanya terbit end-of-day.** Ini keterbatasan IDX, bukan
aplikasi. Feed resmi IDX bahkan tertinggal satu sampai dua hari kalender — saat
sesi Rabu, sesi terakhir yang diterbitkan sering masih Senin. Karena itu refresh
siang hari membawa harga, volume, dan momentum yang segar, tetapi faktor arus
asing tetap per sesi resmi terakhir. Baris status dan email selalu menyebutkan
tanggalnya.

**Harga intraday berasal dari Yahoo, terlambat ~10 menit.** IDX tidak
menyediakan feed intraday publik.

**Indeks yang ikut live hanya IHSG dan LQ45.** Sebelas indeks sektoral IDX-IC
tidak dikutip live di mana pun, jadi nilainya tetap pada penutupan resmi
terakhir. Untuk return 3 bulan yang dipakai rotasi sektor, selisih dua hari
tidak mengubah peringkat.

**Konstituen LQ45/IDX30 adalah perkiraan.** IDX tidak menerbitkannya dalam
format terbaca mesin.

**Skor screener murni teknikal dan aliran dana.** Tidak ada faktor fundamental
di dalamnya. P/E dan P/BV ditampilkan sebagai konteks, bukan bagian dari skor.

**Rincian broker per saham tidak tersedia untuk publik.** IDX hanya menerbitkan
total volume, nilai, dan frekuensi tiap anggota bursa untuk seluruh pasar.
Pertanyaan "broker mana yang mengakumulasi BBCA hari ini" hanya bisa dijawab
dengan feed berbayar IDX Data Services. Tab Broker Flow membaca struktur pelaku
pasar — ritel versus institusi lewat ukuran tiket rata-rata — dan menyatakan
batasan ini di layar.

**Harga tidak bisa real-time, dan itu batas sumbernya bukan aplikasinya.** Kutipan
intraday berasal dari Yahoo yang menerbitkan IDX dengan jeda sekitar 15 menit;
TradingView juga delayed untuk IDX. Data tick-by-tick adalah feed bursa berlisensi
yang dibayar dan didistribusikan anggota bursa seperti Stockbit — tidak ada
endpoint publiknya pada kecepatan berapa pun. Yang dilakukan aplikasi: mengutip
ulang otomatis tiap 45 detik selama bursa buka, hanya saat tab-nya terlihat, dan
selalu mencetak umur kuotasi yang sedang tampil di baris status. Memoles interval
lebih cepat dari itu hanya menghabiskan kuota tanpa menghasilkan harga yang lebih
baru.

**Digest email sekarang mengirim Screener + Watchlist**, bukan lagi stock pick
dari mesin faktor. Bagian pertama adalah corong tiga aturan dengan 12 emiten
teratas menurut nilai transaksi; bagian kedua adalah kandidat watchlist mingguan
lengkap dengan pemicu narasinya. `npm run alert:preview` menampilkannya tanpa
mengirim.

**Chatbot memakai Claude Sonnet 5** lewat SDK resmi Anthropic, dengan dua tool:
`screen_emiten` untuk pertanyaan lintas emiten dan `kupas_emiten` untuk membedah
satu kode. Dossier `kupas_emiten` sengaja menyatukan enam lapis dalam satu blok —
pengajuan ke bursa, tema kebijakan, grup pengendali beserta rotasi dan kohesinya,
aksi korporasi terdeteksi, register KSEI, dan pembanding sub-industri lengkap
dengan kapitalisasinya — supaya jawabannya bisa mengatakan *kenapa* sesuatu
bergerak, bukan sekadar *bahwa* ia bergerak. Lihat persis apa yang diterima model
tanpa memanggil API mana pun:

```bash
npm run chat:dossier -- PACK
``` Lapisan Claude butuh `ANTHROPIC_API_KEY` **di dua tempat**, dan tanpa
keduanya chatbot diam-diam turun ke parser lokal:

1. `.env` di komputer Anda — untuk `npm run auto`. Baris kuncinya saat ini masih
   dikomentari dan isinya cuma placeholder `sk-ant-…` sepanjang 10 karakter.
2. Environment variable di proyek Vercel — untuk `/api/chat` di situs live.
   Tanpa ini situs yang di-deploy selamanya memakai parser lokal, berapa kali pun
   modelnya diganti di kode.

Baris kecil di bawah tiap jawaban sekarang menyebut mesin mana yang menjawab,
supaya keadaan ini tidak lagi tak terlihat.

**Tema kebijakan dikurasi, bukan ditarik dari feed.** Keterbukaan informasi IDX
memberi tahu apa yang dilakukan emiten, bukan apa yang diumumkan pemerintah.
Tema seperti PLTS, biodiesel, atau program perumahan ditulis tangan di
`src/data/narratives.ts`. Isi kolom `source` dengan tautan beritanya — tema tanpa
sumber sengaja dipotong bobotnya setengah dan ditandai di layar — dan perbarui
`checkedOn` saat Anda memeriksanya lagi, karena tiap tema meluruh ke nol dalam 90
hari.

**Chart memakai widget TradingView.** Satu-satunya skrip pihak ketiga di
aplikasi. Kalau pemblokir iklan atau proxy kantor menahan `s3.tradingview.com`,
chart-nya diganti tautan langsung, bukan kotak kosong.

**Kepemilikan institusi bersifat bulanan dan tanpa nama.** Sumbernya adalah
berkas Balance Posisi Efek KSEI, satu pengamatan per akhir bulan — arus adalah
selisih antar bulan, bukan aliran harian, dan bacaan terbaru bisa berumur sampai
lima minggu. KSEI juga menerbitkan **kategori** pemegang, bukan nama pengelola
dana: Mutual Fund Tracker bisa mengatakan reksa dana secara keseluruhan menambah
90 bp pada satu emiten, tidak bisa mengatakan reksa dana yang mana.

**Persentase kepemilikan dihitung dari register kustodian KSEI.** Hanya saham
dalam penitipan kolektif yang tercatat di sana. Blok pengendali sering berada di
luar kustodian — register BBCA hanya sekitar 43% dari saham tercatatnya — jadi
penyebutnya jauh lebih dekat ke free float daripada ke total saham. Rasionya
selalu ditampilkan di kartu tiap emiten.

**Keanggotaan grup konglomerasi dikurasi, bukan diturunkan.** IDX tidak
menerbitkan peta pengendali yang terbaca mesin. Tabel grup ada di
`src/data/conglomerates.ts` dan bisa Anda koreksi satu baris. Angka *kohesi* di
tiap kartu adalah korelasi harian terukur antar anggota — bukti apakah grup itu
benar-benar bergerak bersama.

**Valuasi otomatis adalah penyaring, bukan valuasi.** DCF yang dijalankan massal
mengekstrapolasi lima tahun ke depan dari sejarah; untuk emiten dengan laba
bergelombang hasilnya bisa jauh melenceng. Upside besar berarti "layak
diperiksa", bukan "murah".

**Alat riset, bukan rekomendasi investasi.**
