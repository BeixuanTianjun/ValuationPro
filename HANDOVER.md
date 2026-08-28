# Handover — ValuationPro

Salin isi blok di bawah ke chat baru. Bagian **"Yang mahal ditemukan"** adalah
intinya: itu temuan yang tiap kali dilupakan akan menghabiskan berjam-jam untuk
ditemukan ulang, dan beberapa di antaranya menghasilkan angka yang terlihat
masuk akal padahal salah.

---

```markdown
Saya melanjutkan pengembangan ValuationPro. Berikut konteks lengkapnya.

## Apa ini

Terminal pasar modal Indonesia: basis data seluruh emiten IDX, penyaring alpha
harian, alat analitik ala Bloomberg, dan model DCF/LBO institusional. Tampilan
sekarang memakai palet Bloomberg (hitam murni + amber) dan navigasi mnemonic
ala Bloomberg — Ctrl+K membuka menu fungsi, mengetik kode (mis. `SCR`, `FUND`,
`WL`) + Enter langsung berpindah layar.

- **Lokal**: `C:\Users\MIchael ROG\.gemini\antigravity\scratch\financial-modeling-lbo-dcf`
- **Repo**: https://github.com/BeixuanTianjun/ValuationPro (publik)
- **Live**: https://valuation-pro-lake.vercel.app
- **Stack**: Vite 6 + React 18 + TS 5 + Tailwind 3 + Recharts, layanan Node lokal
- Seluruh UI berbahasa Indonesia; komentar kode berbahasa Inggris.

## Kondisi data saat serah terima

962 emiten · 282 sesi (2025-06-23 → 2026-08-24) · 45 indeks · 24 hari libur
4.258 pengajuan keterbukaan informasi (45 hari) · 648 emiten berlaporan keuangan · 962 kuotasi (100 pelapor
non-IDR) · 88 anggota bursa × 113 sesi · 962 emiten × 24 bulan register
kepemilikan KSEI (2024-08 → 2026-07) · total 10,5 MB di `public/data/idx/`

## Arsitektur tiga tempat

| Tempat | Menjalankan | Kenapa di situ |
|---|---|---|
| **Vercel** | Terminal statis + `api/live.ts` | CDN cepat; serverless sanggup jadi proxy stateless |
| **GitHub Actions** | Ingest terjadwal + alert email | Punya `curl`, cron, dan waktu jalan panjang |
| **Komputer lokal** | `npm run auto` — login, refresh manual, lapisan Claude | Butuh proses hidup + disk permanen |

Aliran: Actions tarik data → commit → Vercel redeploy otomatis.

## Yang mahal ditemukan — JANGAN diulang

**IDX memblokir `fetch` bawaan Node lewat sidik jari TLS.** Selalu 403, apa pun
header-nya. `curl` lolos. Semua permintaan IDX di `scripts/idx-lib.mjs` lewat
curl. Yahoo **tidak** memblokirnya — itulah sebabnya `api/live.ts` bisa hidup di
Vercel yang tidak punya curl.

**Cloudflare IDX membatasi laju.** Concurrency 4 tanpa jeda → 288 dari 308 sesi
gagal. Concurrency 2 + jeda 350 ms + cookie jar persisten → 308 sesi, nol gagal.

**Feed EOD IDX tertinggal 1–2 hari kalender.** Saat sesi Rabu, sesi terakhir
yang diterbitkan sering masih Senin. Feed itu tidak akan pernah bisa menggerakkan
alur "refresh setelah Sesi I" — karena itu ada lapisan intraday dari Yahoo.

**Field `Previous` milik IDX sudah disesuaikan aksi korporasi, `Close` mentah.**
Rasio `Previous[i] / close[i-1]` *adalah* faktor penyesuaiannya. Split 1:25 MLPT
muncul persis 0,0401. Tanpa ini split terbaca sebagai anjlok 96% dan mencemari
seluruh faktor momentum, regresi beta, dan atribusi indeks.

**Divisor indeks harus DITURUNKAN, bukan diambil dari feed.** Field
`MarketCapital` yang diterbitkan IDX adalah kapitalisasi penuh, sedangkan IHSG
berbobot free float sejak 2021 — memakainya membuat tiap kontribusi mengecil ~4x.
Rumus benar: `Σ(WeightForIndex × close) / nilai indeks`. Rekonsiliasi sampai
0,0003 poin.

**`sharesOutstanding` harus seskala dengan `units`.** Mesin DCF membaginya tanpa
penskalaan. Untuk model rupiah dalam miliar, TLKM adalah `99.05` bukan `99062`.
Salah di sini membuat target harga meleset 1000x — dan hasilnya tetap terlihat
seperti angka wajar.

**Ingest bersifat inkremental, bukan menimpa.** `--days 20` menggabung dengan
riwayat tersimpan. Dulu ia membangun ulang, dan job terjadwal akan memangkas 282
sesi jadi ~14 tanpa satu pun pesan error. Pakai `--replace` untuk bangun ulang
sengaja.

**Beta hasil regresi butuh penyesuaian Blume + gerbang R².** Beta mentah 0,20
menghasilkan WACC 7,6% untuk ITMG — di bawah imbal hasil obligasi negara. WACC
juga dilantai di suku bunga bebas risiko + 1%.

**Catatan "job sudah jalan" harus disimpan ke disk.** Kalau hanya di memori,
me-restart layanan di dalam jendela pasca-penutupan mengirim ulang digest.
Sekarang di `.data/job-state.json`.

**Urutan langkah workflow disengaja.** Harga di-commit dan alert dikirim
**sebelum** pekerjaan lambat. Job yang dibatalkan tidak menjalankan sisa
langkahnya — run pertama membuang crawl IDX yang sudah berhasil karena commit
ada di belakang crawl fundamental.

**`.env` dibaca saat start.** Setelah mengubahnya, wajib restart. Ini menjebak
dua kali.

**Bentuk balasan `/api/status` berbeda saat belum masuk** — hanya
`{ accountsExist, locked }`. Menyentuh `status.now.phase` mematikan seluruh
halaman. Semua field detail bertipe opsional; biarkan begitu.

**IDX TIDAK memblokir runner GitHub Actions.** Sudah terbukti — crawl penuh 430
hari berhasil dari IP datacenter Azure.

**`indexFrom` pada GetAnnouncement adalah nomor HALAMAN BERBASIS NOL.**
Mengirim offset baris (1001, 2001, …) menjawab `ResultCount: 0` dan `Replies: []`
tanpa error apa pun. Yang jauh lebih mahal: memulai dari `indexFrom=1` bukan
menggeser satu baris, melainkan MEMBUANG `pageSize` pengajuan terbaru. Itu yang
terjadi sampai 2026-08-27 — crawl pulang membawa 3.261 dari 4.261 baris, nol
pengajuan dari 17 hari terakhir, sementara log dan field `to` tetap mengaku
sampai hari ini, dan lapisan narasi Watchlist (paruh waktu 7 hari) diam-diam
menilai pasar yang pengajuan tersegarnya sudah berumur 17 hari. Sekarang skrip
menolak menulis kalau baris meleset >5% dari `ResultCount` atau kalau pengajuan
terbaru lebih tua dari 5 hari.

**Aturan volume dan aturan nilai di screener bukan aturan yang sama dua kali.**
Volume > 1 juta lembar dan nilai > Rp 1 miliar mengikat di ujung harga yang
berbeda, dan keduanya perlu ada. `daily.volume` dalam LEMBAR, sedangkan
`PriceSeries.volume` dalam LOT (repository membaginya 100 saat masuk) dan
`PriceSeries.value` dalam JUTA rupiah. Membandingkan hitungan lot terhadap
1.000.000 diam-diam menyaring 100 juta lembar dan mengembalikan hampir kosong.

**Palet Bloomberg dipasang lewat REMAP ramp Tailwind, bukan menyunting komponen.**
`tailwind.config.js` mendefinisikan ulang arti `slate`, `amber`, `cyan`, `blue`,
`indigo`, `emerald`, dan `rose`, plus `borderRadius` supaya seluruh sudut jadi
2-4px. Konsekuensinya: jangan menulis hex mentah di komponen — tulis kelas ramp,
dan warnanya ikut. Mengubah tema seluruh aplikasi = mengubah satu berkas.
`slate-950` sekarang hitam murni dan `slate-500` sengaja dinaikkan dari bawaan
Tailwind karena bawaannya disetel untuk latar putih dan tidak terbaca di hitam.

**Recharts tidak bisa memakai kelas Tailwind, jadi warnanya hidup di
`src/theme/chart.ts`.** Itu satu-satunya berkas selain `tailwind.config.js` yang
boleh memuat hex. Sebelum ada, setiap chart masih memakai hex BAWAAN Tailwind
(#3b82f6, #10b981, #0f172a) yang berhenti menjadi warna aplikasi begitu ramp
di-remap — chart tetap biru dasbor web di terminal yang sudah amber-di-hitam,
dan tidak ada yang menandainya karena tiap hex sah secara individual. Recharts
juga punya bawaannya sendiri: garis sumbu keluar `#666` kalau `axisLine` dan
`tickLine` tidak diisi. Mengubah tema = mengubah dua berkas.

**Dev server TIDAK memuat ulang tailwind.config.js.** Setelah mengubah tema,
`npm run dev` yang sudah jalan akan tetap memakai palet lama dan membuat Anda
mengira perubahannya gagal. Verifikasi lewat `npm run build` + `vite preview`,
atau restart dev server.

**`npm run backtest` menangkap yang tidak bisa dilihat unit test.** `npm test`
memeriksa segelintir angka pilihan tangan; backtest menyapu 962 emiten lewat
SETIAP mesin dan menuntut invarian yang harus berlaku untuk semuanya: tidak ada
yang melempar, tidak ada NaN/Infinity sampai ke field yang dicetak UI, aturan
screener cocok dengan angka mentah yang diklaimnya dibaca, dan pelapor mata uang
asing selalu ditranslasi ATAU ditandai. Sekali jalan pertama ia menemukan tiga
bug nyata sekaligus — termasuk `tradedSessions20` yang mengembalikan 21. Jalankan
dengan beberapa pass (`-- 3`) untuk menangkap ketergantungan urutan: pass ke-N
dibandingkan dengan pass pertama.

**Field bernama `20` sekarang benar-benar 20 sesi.** `W.m1` bernilai 21 dan
dipakai untuk semua yang berlabel 20 — `tradedSessions20`, `medianValue20IdrBn`
("Likuiditas 20H"), `foreignNet20IdrBn` ("Asing 20H"), `sma20`, `z20`,
`volumeSurge`. Akibatnya dossier mencetak "bertransaksi 21 dari 20 sesi terakhir"
dan itu sudah tayang. Sekarang ada `W.d20 = 20` terpisah; `W.m1` hanya untuk yang
benar-benar berarti "sekitar sebulan" (return 1 bulan, momentum 12-1).

**Pelapor USD yang gagal ditranslasi sekarang BERTERIAK.** `report.currency`
dicap `'Rp '` tanpa syarat, jadi kalau tabel kurs hilang, laporan 100 emiten
pelapor USD keluar mentah dalam dolar berlabel rupiah — meleset ~16.000x dan
`translatedFrom` tidak terisi sehingga UI pun tidak mencetak catatan apa pun.
`resolveStatements` sekarang mengembalikan `untranslated`, dan
`idxCompanyBridge` mengangkatnya jadi WARNING, bukan note.

**Dossier chatbot menyatukan enam feed, dan itu inti fiturnya.** `buildDossier`
di `src/server/chatApi.ts` menggabungkan harga + aturan screener, laporan
keuangan, aksi korporasi terdeteksi, pengajuan ke bursa, tema kebijakan, grup
pengendali beserta rotasi dan kohesi terukur, register KSEI, dan pembanding
sub-industri berikut kapitalisasinya. Dua feed terakhir (`announcements.json`,
`ownership.json`) TIDAK ada di `MarketDatabase` — keduanya masuk lewat
`ChatContext` yang disalurkan dari `src/server/index.ts` (lokal) dan
`api/_chat-impl.ts` (Vercel). Kalau salah satu jalur lupa menyalurkannya,
chatbot tidak error: ia diam-diam kehilangan lapisan narasi. Dossier membedakan
"tidak ada pengajuan" dari "berkasnya belum dibangun" secara eksplisit karena
model yang tidak bisa membedakan keduanya akan melaporkan emiten sepi kabar
padahal baru rights issue. Periksa isinya kapan saja dengan
`npm run chat:dossier -- KODE` — tanpa API key, tanpa mengirim apa pun.

**Chatbot butuh ANTHROPIC_API_KEY di DUA tempat.** `.env` lokal untuk
`npm run auto`, dan environment variable proyek Vercel untuk `api/chat.ts`.
Sebelum `api/chat.ts` ada, situs live sama sekali tidak punya endpoint chat —
`chatClient` memanggil `/api/chat`, Vercel menjawab 404, dan UI diam-diam
memakai parser lokal. Mengganti model di `src/server/chatApi.ts` tidak akan
pernah terlihat di situs live sampai kedua hal itu benar.

**GitHub Actions MENJATUHKAN slot cron yang ramai.** Riwayat repo ini
menunjukkan slot `5 5` dan `20 9` tidak menghasilkan commit berhari-hari
sementara `30 11` jalan terus. Karena itu penutupan sekarang dijadwalkan pada
menit ganjil (`17 9`) DAN diulang (`47 9`). Commit harga juga dipindah ke SEBELUM
`npm test` — satu tes yang gagal dulu membuang harga penutupan yang sudah
berhasil ditarik.

**Google Finance bukan sumber yang lebih cepat.** Sudah diukur: penutupan BBCA
6400 sama persis dengan Yahoo, tidak ada endpoint batch (404), dan satu ticker
berarti satu halaman HTML 182 KB. Dipakai hanya sebagai fallback berbatas 120
emiten paling likuid ketika crumb Yahoo gagal — yang benar-benar terjadi.

**Kepemilikan per saham ADA publiknya — di KSEI, bukan di IDX.** Berkas bulanan
`https://www.ksei.co.id/storage/Download/BalanceposEfek<YYYYMMDD>.zip` memuat
saldo kustodian tiap efek dipecah ke sembilan jenis investor × lokal/asing. Ini
satu-satunya feed kepemilikan per emiten yang publik di pasar Indonesia, dan
dasar dari Mutual Fund Tracker. Riwayatnya sampai setidaknya 2023. KSEI tidak
memblokir `fetch` maupun `curl`.

**Tanggal pada nama berkas KSEI adalah hari penyelesaian terakhir, bukan tanggal
kalender terakhir.** Tanggal yang salah menjawab 302 ke halaman 404, bukan 404.
Skrip menelusuri mundur dari akhir bulan sampai ada yang menjawab 200.

**Zip KSEI dibongkar dengan `zlib` di dalam proses, bukan `unzip`.** Proses Node
yang dijalankan dari PowerShell atau runner CI tidak bisa mengandalkan `unzip`
ada di PATH — di Git Bash ada, di luar itu belum tentu.

**Angka KSEI adalah persen dari REGISTER KUSTODIAN, bukan dari saham tercatat.**
Kolom `Sec. Num` adalah saham diterbitkan; jumlah seluruh kategori jauh lebih
kecil untuk sekitar separuh emiten karena blok pengendali tercatat di luar
penitipan kolektif. Register BBCA hanya 42,6% dari saham tercatatnya. Memakai
saham tercatat sebagai penyebut akan mengecilkan tiap porsi institusi lebih dari
dua kali lipat. `custodyCoverage` selalu ditampilkan di layar.

**Nav tab `w-fit` harus dipasangi `max-w-full`.** `overflow-x-auto` saja tidak
menolong: elemen `w-fit` mengambil lebar konten, jadi baris lima tab tumbuh
melewati viewport alih-alih menggulung di dalam dirinya. Ini yang membuat tata
letak 768px rusak sementara 375px justru bersih.

**Fungsi serverless yang mengimpor dari `src/` gagal dimuat di Vercel — bukan
gagal berjalan.** `api/chat.ts` versi pertama mengimpor `src/server/chatApi.ts`
langsung dan menjawab `FUNCTION_INVOCATION_FAILED` pada SETIAP request termasuk
GET. Diagnosisnya bukan bug logika, tapi cara builder Vercel menyelesaikan impor
TypeScript relatif yang dalam di bawah `"type": "module"`. Solusinya: bundel
duluan. `npm run build:chatfn` (bagian dari `npm run build`) memakai esbuild
untuk merangkum `api/_chat-impl.ts` jadi satu berkas ESM mandiri
`api/_chat-bundle.mjs` tanpa sisa impor relatif, dan `api/chat.ts` tinggal
pembungkus sembilan baris yang mengimpor bundel itu. `_chat-bundle.mjs` masuk
`.gitignore` — dibangun ulang tiap `npm run build`, jangan commit manual.

**Menu fungsi & command bar membaca satu registri.** `src/data/functions.ts`
adalah satu-satunya sumber kebenaran untuk kode mnemonic (MKT, SCR, WL, CN,
DES, CHAT, MOST, CNG, FUND, BRK, AVAL, DCF, LBO). Menambah layar baru = menambah satu
baris di sana; `MenuPanel.tsx` dan `FunctionBar.tsx` keduanya membaca dari situ,
jadi sebuah layar tidak mungkin ada di satu tempat tapi hilang di tempat lain.

## Peta kode

```
scripts/          ingest via curl: idx, intraday, quotes, fundamentals,
                  brokers, ownership (KSEI), announcements (keterbukaan info)
src/models/       dcfEngine, lboEngine, factorEngine,
                  indexAttribution, conglomerateRotation, autoValuation,
                  brokerFlow, ownershipFlow, announcements (taksonomi judul),
                  stockScreener (aturan keras), watchlist (corong 4 tahap),
                  emitenQueryEngine, idxCompanyBridge
src/data/         marketRepository (isomorfik: browser + Node), fundamentals,
                  conglomerates (kurasi, 31 grup), narratives (tema kebijakan
                  kurasi), idxIndexCatalog, chatClient, authClient
src/server/       index (HTTP + scheduler), schedule (WIB), auth (scrypt),
                  emailAlert, chatApi, marketFromDisk, alertCli
src/components/   landing, layout, market, analytics, chat, auth, dcf, lbo
src/components/market/AnnouncementFeed.tsx   layar CN — arsip keterbukaan
                  informasi, kategori + filter + tautan PDF asli
src/theme/chart.ts   warna Recharts (satu-satunya hex di luar tailwind.config)
src/components/common/ui.tsx   primitif bersama: Panel, Segmented, Stat,
                  TableScroll, EmptyState — semua aturan responsif ada di sini
src/components/layout/   Header, LiveStatusBar, MenuPanel (Ctrl+K),
                  FunctionBar (command line), CurtainTransition (animasi
                  masuk terminal, pakai `motion`)
src/components/market/TradingViewChart.tsx   widget chart, satu-satunya
                  dependensi runtime pihak ketiga di aplikasi
src/data/functions.ts   registri kode mnemonic ala Bloomberg — sumber
                  kebenaran untuk MenuPanel & FunctionBar
api/live.ts       fungsi Vercel: kutip 962 emiten dari Yahoo (+ fallback
                  Google Finance kalau crumb Yahoo gagal) saat diminta
api/chat.ts       pembungkus tipis; logika sebenarnya di api/_chat-impl.ts,
                  dibundel esbuild jadi api/_chat-bundle.mjs saat build
scripts/gfinance-lib.mjs   fallback kutipan Google Finance, dipakai
                  scripts/ingest-intraday.mjs saat Yahoo gagal
```

## Perintah

```bash
npm run auto            # layanan lokal + aplikasi di :8787
npm run dev             # Vite dev, proxy /api ke :8787
npm test                # 32 uji: guard rail DCF + rekonsiliasi atribusi indeks
npm run data:all        # bangun ulang seluruh database (~15 menit)
npm run data:intraday   # harga live semua emiten (~3 detik)
npm run data:ownership  # register kepemilikan KSEI 24 bulan (~40 detik)
npm run data:announcements # keterbukaan informasi IDX 45 hari (~10 detik)
npm run alert:preview   # hitung pick tanpa mengirim email
```

## Yang masih terbuka

- **BELUM SELESAI, sedang dikerjakan user: ANTHROPIC_API_KEY.** `.env` baris 15
  masih dikomentari dengan placeholder (`# ANTHROPIC_API_KEY=sk-ant-...`), dan
  environment variable Vercel-nya juga belum diisi. Tanpa keduanya chatbot
  (baik lokal maupun live) diam-diam jatuh ke parser lokal — baris di bawah
  tiap jawaban chat sekarang bilang jujur mesin mana yang menjawab. Setelah
  user dapat kuncinya dari console.anthropic.com: isi `.env` baris 15 (hapus
  `#`, ganti nilai), lalu tambah env var yang sama di Vercel → Settings →
  Environment Variables → redeploy.

- **Keanggotaan grup konglomerasi dikurasi manual** di `src/data/conglomerates.ts`.
  IDX tidak menerbitkan peta pengendali. Angka *kohesi* di UI adalah bukti
  terukur apakah grup benar-benar bergerak bersama.
- **Konstituen LQ45/IDX30 adalah perkiraan** dari likuiditas 12 bulan digabung
  kapitalisasi. Tepat untuk blue chip, tidak identik dengan daftar resmi.
- **Rincian broker per saham tidak tersedia publik** — hanya total per anggota
  bursa. Yang ada di UI adalah struktur pelaku (ritel vs institusi dari ukuran
  tiket rata-rata). Untuk kepemilikan per saham, jawabannya bukan broker
  summary melainkan register KSEI di tab Mutual Fund Tracker.
- **Kepemilikan KSEI bulanan dan tanpa nama pengelola.** Bisa mengatakan reksa
  dana secara keseluruhan menambah 90 bp; tidak bisa mengatakan reksa dana mana.
  Tidak ada potongan harian di sumber mana pun yang publik.
- **Arus dana asing hanya EOD.** Refresh intraday membawa harga segar tetapi
  faktor asing tetap per sesi resmi terakhir; UI selalu menyebut tanggalnya.
- **Riwayat git tumbuh ~130 MB/bulan** karena `history.json` 6 MB ditulis ulang
  tiap tarik data resmi. Resep pemadatan ada di `DEPLOY.md`.
- **Login hanya jalan di layanan lokal.** Sesi di memori + `users.json` tidak
  bertahan di serverless.
- **Broker summary per saham TIDAK akan pernah bisa dari sumber publik.** Sudah
  diuji ulang: `GetBrokerSummary?code=BBCA` menerima parameternya dan
  mengabaikannya — tetap 88 baris seluruh pasar. Yang ada di UI adalah aktivitas
  anggota bursa market-wide plus nilai ÷ frekuensi per emiten sebagai pendekatan.
- **Harga tidak bisa real-time.** Yahoo delay ~15 menit untuk IDX. Polling lebih
  cepat dari itu tidak menghasilkan harga baru. Auto-refresh 45 detik ada di
  `hooks/useMarketData.ts` dan hanya jalan saat fase pasar aktif dan tab terlihat.
- **Valuasi otomatis adalah penyaring, bukan valuasi.** Properti dan komoditas
  sering keluar dengan upside ekstrem karena laba bergelombang.

## Dokumen lain

`SETUP.md` menjalankan & alert · `DEPLOY.md` Vercel + Actions ·
`DATA_PIPELINE.md` sumber data & catatan teknis

## Aturan yang dipegang

Setiap angka bisa ditelusuri ke endpoint sumbernya. Ketika data tidak memadai —
bank yang tidak melaporkan EBITDA, emiten pelapor USD, arus asing yang belum
terbit — aplikasi mengatakannya di layar, bukan menutupinya. Ini alat riset,
bukan rekomendasi investasi.

---

Yang ingin saya kerjakan berikutnya: [TULIS DI SINI]
```
