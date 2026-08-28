# Handover — ValuationPro

Salin isi blok di bawah ke chat baru. Bagian **"Yang mahal ditemukan"** adalah
intinya: itu temuan yang tiap kali dilupakan akan menghabiskan berjam-jam untuk
ditemukan ulang, dan beberapa di antaranya menghasilkan angka yang terlihat
masuk akal padahal salah.

---

```markdown
Saya melanjutkan pengembangan ValuationPro. Berikut konteks lengkapnya.

## Apa ini

Terminal pasar modal Indonesia: basis data seluruh emiten IDX, screener aturan
keras, watchlist bernarasi, alat analitik ala Bloomberg, model DCF/LBO, dan sejak
sesi terakhir dua lapisan di luar Indonesia — 29 instrumen makro dan peta selat
dunia. Palet Bloomberg (hitam murni + amber), navigasi mnemonic: Ctrl+K membuka
menu fungsi, ketik kode (`SCR`, `MACRO`, `MAP`) + Enter langsung pindah layar.

- **Lokal**: `C:\Users\MIchael ROG\.gemini\antigravity\scratch\financial-modeling-lbo-dcf`
- **Repo**: https://github.com/BeixuanTianjun/ValuationPro (publik)
- **Live**: https://valuation-pro-lake.vercel.app
- **Stack**: Vite 6 + React 18 + TS 5 + Tailwind 3 + Recharts, layanan Node lokal
- **Label MENU berbahasa Inggris, ISI layar berbahasa Indonesia.** Itu keputusan
  eksplisit pemilik repo, bukan campur aduk yang belum dirapikan. Nav, tab, nama
  fungsi di Ctrl+K, dan chrome panel = Inggris. Judul panel, tabel, angka,
  catatan kaki, dan `hint` di registri fungsi = Indonesia.
- **`hint` di `src/data/functions.ts` WAJIB tetap Indonesia.** Bukan soal gaya:
  `searchFunctions` mencocokkan kata kunci ke sana, jadi menerjemahkannya membuat
  mengetik `konglomerasi` di command bar berhenti menemukan CNG.
- Layar baru ditulis dengan bahasa tongkrongan (lihat MACRO dan MAP). Layar lama
  masih Indonesia formal dan sengaja dibiarkan.
- Komentar kode berbahasa Inggris.

## Kondisi data saat serah terima

962 emiten · 283 sesi (2025-06-23 → 2026-08-28) · 45 indeks · 24 hari libur
4.258 pengajuan keterbukaan informasi (45 hari) · 648 emiten berlaporan keuangan
962 kuotasi (100 pelapor non-IDR) · 88 anggota bursa × 113 sesi
962 emiten × 24 bulan register KSEI (2024-08 → 2026-07)
29 instrumen makro × 282 sesi · 28 selat dunia × 120 hari + 41 kejadian disrupsi
total ~11 MB di `public/data/idx/`

## Arsitektur tiga tempat

| Tempat | Menjalankan | Kenapa di situ |
|---|---|---|
| **Vercel** | Terminal statis + `api/live.ts` + `api/chat.ts` | CDN cepat; serverless sanggup jadi proxy stateless |
| **GitHub Actions** | Ingest terjadwal + alert email | Punya `curl`, cron, dan waktu jalan panjang |
| **Komputer lokal** | `npm run auto` — login, refresh manual, lapisan Claude | Butuh proses hidup + disk permanen |

Aliran: Actions tarik data → commit → Vercel redeploy otomatis.

## Yang mahal ditemukan — JANGAN diulang

**BACA INI DULU: pola yang berulang lima kali di repo ini.** Hampir tiap bug
serius di sini bukan crash — ia mengembalikan angka yang terlihat wajar. Ingest
yang memotong diam-diam, jendela yang namanya 20 tapi isinya 21, dolar berlabel
rupiah, gerbang yang mematikan fitur tanpa error, penyelarasan berbasis posisi
yang bergeser saat satu berkas tumbuh. Semua lolos typecheck dan tes. Yang
menangkapnya bukan review, tapi `npm run backtest` yang menyapu 962 emiten dan
membandingkan angka terhadap invariannya. **Kalau menambah mesin baru, tambahkan
invariannya ke backtest di commit yang sama.**

**Angka baris yang bulat pantas dicurigai.** ArcGIS memotong tiap respons di
`maxRecordCount` tanpa error: minta 32.000, dijawab tepat 1.000, dan
`exceededTransferLimit` diset. Tren "7 hari vs 30 hari" di peta selat sempat
dihitung dari jendela yang diam-diam sepertiga panjangnya. Sekarang dipaginasi
lewat `resultOffset` plus penjaga jumlah baris.

**`indexFrom` pada GetAnnouncement berbasis NOL.** Memulai dari 1 bukan menggeser
satu baris, melainkan membuang `pageSize` pengajuan TERBARU — 1.000 pengajuan,
17 hari, hilang tanpa error sementara log dan field `to` tetap mengaku sampai
hari ini. Lapisan narasi Watchlist meluruh 7 hari, jadi ia menilai pasar yang
pengajuan tersegarnya sudah 17 hari.

**Field bernama `20` dulu memakai 21 sesi.** `W.m1 = 21` dipakai untuk
`tradedSessions20`, `medianValue20IdrBn`, `foreignNet20IdrBn`, `sma20`, `z20`,
`volumeSurge`. Gejalanya tercetak di dossier: "bertransaksi 21 dari 20 sesi
terakhir". Sekarang ada `W.d20 = 20` yang terpisah.

**Pelapor USD bisa keluar berlabel rupiah tanpa penanda.** `resolveStatements`
mencap `currency = 'Rp '` tanpa syarat tapi hanya mentranslasi kalau tabel kurs
ADA. `scripts/` dan `src/` tidak pernah saling impor — kontraknya cuma nama field
di JSON, tidak diperiksa kompiler mana pun. Sekarang mengembalikan `untranslated`
dan `idxCompanyBridge` mengangkatnya jadi WARNING.

**Satu flag dipakai untuk dua pertanyaan berbeda mematikan chat di deployment.**
`serviceAvailable` menjawab "layanan Node lokal hidup?" (diprobe lewat
`/api/status`) tapi juga dipakai sebagai gerbang `askEmitenChat`. Di Vercel tidak
ada `/api/status`, jadi probe 404 dan `/api/chat` **tidak pernah dicoba** padahal
berfungsi. Situs live menjawab semua pertanyaan dengan parser browser tanpa
mengirim satu request pun, dan catatan kakinya menyalahkan API key yang tidak
ada hubungannya. Gerbang chat sekarang punya flag sendiri, dan hanya 404 dari
`/api/chat` sendiri yang boleh menyetelnya.

**Penyelarasan berbasis posisi antar dua berkas patah dalam sehari.**
`macro.json` diselaraskan ke grid sesi saat ditarik; `history.json` tumbuh tiap
refresh. Begitu beda panjang, tiap nilai bergeser dan slot terbaru jadi NaN.
Sekarang berkasnya menyimpan `dates` sendiri dan penyelarasannya per tanggal.

**`maxDuration` Vercel 60 detik, bukan bawaan.** `/api/chat` memuat dua belas
berkas lewat HTTP di dalam fungsi (`history.json` sendiri 6,3 MB) lalu 2-3
putaran tool Claude. Di batas 20 detik pertanyaan pendek lolos sementara "kupas
ADRO" habis waktu, dan gejalanya bukan error melainkan **balasan kosong** —
HTTP 504 tanpa satu byte pun. Live backtest sekarang mengukur waktunya dan
memperingatkan kalau mendekati batas.

**Layar yang sudah ter-deploy bisa tetap tak terlihat di HP, dan itu terbaca
persis seperti deploy yang gagal.** MACRO dan MAP tayang sejak commit-nya
mendarat, tapi dari telepon keduanya tidak ada: baris tab Analytics memuat tujuh
tab yang menggulung ke samping, jadi tab ketujuh berada di luar layar 390px tanpa
satu pun tanda bahwa barisnya masih berlanjut; peluncur fungsi hanya bisa dibuka
lewat Ctrl+K — tombol yang tidak dimiliki telepon — atau chip MENU kecil di
command bar; dan halaman depan tidak menyebut keduanya sama sekali. Tiga jalan
masuk, tiga-tiganya buntu di layar sentuh. Sekarang: tab bar bawah punya tombol
kelima yang membuka peluncur, tab baru diberi titik amber, baris tab yang
menggulung diberi gradasi di sisi yang masih ada isinya, dan tab aktif
di-scroll ke dalam pandangan.

**Bundel yang sedang dijalankan browser sekarang tercetak di layar.** Footer
Function Menu memuat `build <sha> · <waktu WIB>`, diisi vite dari
`VERCEL_GIT_COMMIT_SHA` saat build (lihat `src/data/build.ts`). Tanpa itu,
"deploy-nya belum jalan" dan "browser saya masih memegang bundel lama" terlihat
identik dari telepon — tidak ada view-source, tidak ada log build — dan keduanya
sudah pernah di-debug sebagai yang keliru. Kalau sha di footer sama dengan commit
terakhir, deployment-nya benar dan yang salah ada di tempat lain.

**Header cache untuk HTML sekarang eksplisit di `vercel.json`.** `/assets/*`
immutable satu tahun (namanya ber-hash, aman), tapi `index.html` yang menunjuk ke
hash itu wajib `max-age=0, must-revalidate` — kalau tidak, telepon yang menyimpan
HTML lama akan terus memuat bundel lama sampai cache-nya kedaluwarsa sendiri.

**Cron GitHub Actions bisa berhenti total, bukan cuma melewatkan satu slot.**
Antara 2026-08-26 11:53 UTC dan 2026-08-28 11:20 UTC tidak ada satu pun run
terjadwal — tujuh slot berturut-turut hilang — sementara `state` workflow-nya
tetap `active` dan tidak ada run gagal yang bisa dilihat. Gejalanya halus karena
lapisan intraday menutupinya: harga di layar tetap hari ini (Yahoo dikutip saat
halaman dibuka), tapi seri resmi IDX berhenti di 2026-08-24 — empat sesi
tertinggal — dan arus asing, atribusi indeks, serta tiap faktor yang dihitung
dari sesi resmi ikut berhenti di sana. Kalau data di live terlihat basi, periksa
daftar run Actions DULU sebelum mencurigai Vercel: deployment yang sehat
menyajikan data basi kalau yang mati adalah ingest-nya.

**Env var Vercel hanya berlaku setelah REDEPLOY.** Mengganti nilainya di Settings
tidak menyentuh fungsi yang sudah ter-deploy; ia tetap memakai nilai lama sampai
ada build baru. Ini memakan satu putaran penuh debugging yang mengira key-nya
salah.

**Penyelarasan waktu antar pasar menanggung beban.** Jakarta tutup 09:00 UTC.
Membandingkan sesi Selasa Jakarta dengan penutupan Selasa New York berarti
meregresikan Jakarta terhadap harga yang baru ada setelah Jakarta pulang. 22
instrumen digeser satu sesi (field `after`), 7 pasar Asia tidak. Setelah digeser,
VIX baru muncul dengan korelasi negatif ke IHSG.

**Hasil terukur lapisan makro LEMAH, dan itu jawabannya.** Tidak ada instrumen
luar yang menerangkan lebih dari ~13% gerakan harian satu sektor, dan yang
paling nempel indeks Asia, bukan komoditas. PTBA terhadap Brent r=0,12. Jangan
"memperbaiki" ini dengan mengganti metode sampai angkanya besar — layarnya
sengaja menyatakan kelemahannya.


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

**IDX SEKARANG MEMBLOKIR runner GitHub Actions — klaim sebaliknya sudah kedaluwarsa.**
Pada 2026-08-26 crawl penuh 430 hari berhasil dari IP datacenter Azure, dan itu
ditulis di sini sebagai fakta. Dua hari kemudian setiap permintaan IDX dari
runner dijawab HTML setelah menunggu 40 detik — bentuk tantangan Cloudflare —
dan `ingest-idx.mjs` maupun `ingest-announcements.mjs` mati dengan
`Non-JSON (HTML/blocked) response`. Yang membuatnya mahal: kedua langkah itu
`continue-on-error`, jadi job-nya **hijau** sambil tetap meng-commit satu berkas
harga; dari daftar run tidak ada apa pun yang terlihat salah selama seri resmi
diam-diam berhenti bertambah. Sekarang ada langkah pelapor di akhir job yang
memerahkan run kalau salah satu crawl IDX gagal, setelah harga ter-commit dan
digest terkirim. Sampai IDX melonggar, seri resmi hanya bisa ditarik dari mesin
lokal (`npm run data:refresh`) — dan status bar aplikasi akan berkata "Seri resmi
tertinggal N sesi" selama itu belum dilakukan.

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
                  kebenaran untuk MenuPanel & FunctionBar; field `added`
                  menyalakan tanda NEW yang kedaluwarsa sendiri setelah 21 hari
src/data/build.ts   sha commit + waktu build yang disuntik vite, dicetak di
                  footer Function Menu
api/live.ts       fungsi Vercel: kutip 962 emiten dari Yahoo (+ fallback
                  Google Finance kalau crumb Yahoo gagal) saat diminta
api/chat.ts       pembungkus tipis; logika sebenarnya di api/_chat-impl.ts,
                  dibundel esbuild jadi api/_chat-bundle.mjs saat build
scripts/gfinance-lib.mjs   fallback kutipan Google Finance, dipakai
                  scripts/ingest-intraday.mjs saat Yahoo gagal
scripts/ingest-macro.mjs      29 instrumen luar IDX -> macro.json
scripts/ingest-worldmap.mjs   28 selat + disrupsi + garis pantai -> worldmap.json
scripts/backtest.ts           sapuan invariant seluruh semesta, lokal
scripts/backtest-live.ts      sapuan invariant terhadap deployment
scripts/preview-dossier.ts    cetak dossier chatbot tanpa memanggil API
src/models/macroLinkage.ts    korelasi/beta tiap instrumen luar ke tiap sektor
src/components/analytics/MacroMonitor.tsx   layar MACRO
src/components/analytics/WorldMap.tsx       layar MAP, globe SVG tanpa pustaka 3D
```

## Perintah

```bash
npm run auto            # layanan lokal + aplikasi di :8787
npm run dev             # Vite dev, proxy /api ke :8787

npm test                # 34 uji: guard rail DCF, rekonsiliasi atribusi, kurasi konglomerasi
npm run backtest -- 5   # sapu 962 emiten lewat TIAP mesin, 5 pass  (~108k pemeriksaan)
npm run backtest:live   # invariant yang sama tapi terhadap DEPLOYMENT, bukan disk
npm run chat:dossier -- PTBA   # cetak persis apa yang diterima model, tanpa API

npm run data:all        # bangun ulang seluruh database (~15 menit)
npm run data:intraday   # harga live semua emiten (~3 detik)
npm run data:ownership  # register kepemilikan KSEI 24 bulan (~40 detik)
npm run data:announcements # keterbukaan informasi IDX 45 hari (~10 detik)
npm run data:macro      # 29 aset di luar IDX, 6 kelas (~5 detik)
npm run data:worldmap   # 28 selat + alert disrupsi + garis pantai (~15 detik)
npm run alert:preview   # hitung pick tanpa mengirim email
```

## Yang masih terbuka

- **ANTHROPIC_API_KEY sudah terpasang di dua tempat dan chatbot hidup**, lokal
  maupun live. Kalau suatu saat mati lagi, urutan pemeriksaannya: baris kecil di
  bawah tiap jawaban chat menyebut mesin mana yang menjawab, dan `note`-nya
  memuat pesan error aslinya. Dua jebakan yang sudah pernah kena — `.env` dibaca
  sekali saat start (wajib restart), dan **env var Vercel hanya berlaku setelah
  REDEPLOY**, mengubah nilainya di Settings tidak menyentuh fungsi yang sudah
  ter-deploy.

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
- **CPO dan nikel tidak ada di lapisan makro, dan itu lubang yang nyata.**
  Kontrak `FCPO=F` dan `NI=F` sama-sama dijawab "symbol may be delisted" oleh
  Yahoo, padahal Indonesia produsen terbesar dunia untuk keduanya. Acuan batu
  bara yang ada cuma API2 Eropa, bukan Newcastle yang dipakai kontrak ekspor
  kita. Tidak ada satu pun yang diganti proksi — korelasi dari barang pengganti
  akan terbaca sebagai bukti padahal bukan. Kalau ketemu sumber harian yang
  gratis dan sah untuk ketiganya, itu penambahan paling berharga berikutnya.
- **Tidak ada data konflik/geopolitik.** Alert di layar MAP adalah bencana alam
  dan penutupan pelabuhan dari IMF PortWatch. GDELT tidak bisa dijangkau dari
  host ingest — setiap permintaan menjawab HTTP 000. Jangan menamai ulang alert
  bencana jadi "geopolitik"; layarnya sengaja menyatakan bedanya.
- **Peta menampilkan jumlah transit, bukan posisi kapal.** Data AIS per unit
  berbayar dan tidak punya endpoint publik.
- **Hubungan selat ke satu emiten belum diukur statistik.** Lapisan makro punya
  korelasi/beta/R², lapisan selat belum. Dossier menyebutnya sebagai konteks
  rantai pasok dan melarang model mengklaim itu menggerakkan harga. Mengukurnya
  butuh menyusun seri transit harian per emiten eksportir, dan itu belum ada.
- **Copy layar lama masih Indonesia formal.** Screener, Watchlist, Leaders, KSEI,
  DCF/LBO. Pemilik repo sudah bilang biarkan; yang diubah ke Inggris hanya LABEL
  MENU.
- **Valuasi otomatis adalah penyaring, bukan valuasi.** Properti dan komoditas
  sering keluar dengan upside ekstrem karena laba bergelombang.

## Dokumen lain

`SETUP.md` menjalankan & alert · `DEPLOY.md` Vercel + Actions ·
`DATA_PIPELINE.md` sumber data & catatan teknis

## Aturan yang dipegang

Setiap angka bisa ditelusuri ke endpoint sumbernya. Ketika data tidak memadai —
bank yang tidak melaporkan EBITDA, emiten pelapor USD, arus asing yang belum
terbit, CPO dan nikel yang tidak punya seri publik — aplikasi mengatakannya di
layar, bukan menutupinya, dan tidak pernah menambalnya dengan proksi. Hubungan
yang lemah disebut lemah. Ini alat riset, bukan rekomendasi investasi.

Konsekuensi praktisnya untuk sesi berikutnya: **jangan menambah sumber data yang
butuh kunci berbayar atau yang tidak bisa dilacak**, dan jangan mengganti metode
sampai angka korelasi kelihatan bagus. Kalau sebuah fitur hanya bisa dibuat
dengan menebak, lebih baik tidak dibuat dan alasannya ditulis di layar.

## Cara memverifikasi bahwa semuanya masih benar

Jalankan berurutan sebelum menyentuh apa pun. Kalau salah satu gagal, itu yang
dikerjakan duluan.

```bash
npx tsc --noEmit         # harus bersih
npm test                 # 34/34
npm run backtest -- 5    # ~108k pemeriksaan, nol temuan
npm run backtest:live    # 50 pemeriksaan terhadap deployment, nol temuan
```

`backtest:live` yang paling sering menangkap masalah nyata, karena ia satu-satunya
yang tahu apa yang benar-benar disajikan ke pengunjung: berkas data yang tidak
ikut ter-deploy, data yang basi karena ingest terjadwal berhenti, fungsi chat yang
mendekati batas waktu, dan chatbot yang diam-diam jatuh ke parser browser.

## Kondisi saat serah terima ini ditulis

Commit `e44926b` di `main`, working tree bersih, sinkron dengan remote. Live
menyajikan bundel yang identik dengan build lokal. Semua verifikasi di atas hijau.
Layanan lokal `npm run auto` jalan di `:8787` dengan Claude aktif.

---

Yang ingin saya kerjakan berikutnya: [TULIS DI SINI]
```
