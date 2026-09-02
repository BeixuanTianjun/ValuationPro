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
Di layar sentuh Ctrl+K tidak ada, jadi tombol kelima di tab bar bawah membuka
peluncur yang sama — itu satu-satunya jalan ke daftar lengkap fungsi dari HP.

- **Lokal**: `C:\Users\MIchael ROG\OneDrive - Bina Nusantara\Documents\liviee\ValuationPro`
  (dipindah 2026-08-29 dari `~\.gemini\antigravity\scratch\financial-modeling-lbo-dcf`,
  folder scratch milik tool lain yang bisa dihapus sewaktu-waktu — sekarang di
  dalam folder ter-sync OneDrive, jadi `node_modules` dan 11 MB `public/data/idx/`
  ikut ter-upload tiap tulis, dan `tsc` jalan jauh lebih lambat dari sebelumnya)
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

962 emiten · **715 sesi (2023-08-28 → 2026-09-01)** · 45 indeks · 72 hari libur
4.002 pengajuan keterbukaan informasi dari 940 emiten (2026-07-18 → 2026-09-01)
962 kuotasi (100 pelapor non-IDR) · 88 anggota bursa
962 emiten × 24 bulan register KSEI (2024-09 → **2026-08**)
29 instrumen makro · 28 selat dunia + kejadian disrupsi
110 berita 5 kantor + 113 agenda kalender ekonomi · 6 proksi tanker + 12 emiten pelayaran
99.360 rule set di-backtest, 361 lolos gerbang out-of-sample (15 trigger; 4
membeli KELEMAHAN dan nol lolos, 3 masuk LEBIH AWAL dan dua di antaranya lolos)
total ~27 MB di `public/data/idx/`

**Seri resmi IDX sudah TIDAK tertinggal lagi.** Handover sebelumnya mencatat
seri berhenti di 2026-08-24; sekarang `meta.latestSession` = **2026-08-31**, dan
riwayatnya diperdalam dari 285 → **714 sesi** supaya split train/test papan
strategi punya makna. Yang membuatnya bertahan segar bukan CI melainkan
penjadwal lokal — lihat entri "IDX memblokir runner" dan "run mingguan
dibatalkan" di bawah.

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

**Run Actions yang DIBATALKAN membunuh commit-nya, dan tidak terlihat gagal.**
Run 33241417759 (Sabtu 2026-08-29, satu-satunya slot mingguan) menggantung di
tarikan KSEI lalu dibatalkan. Karena langkah "Commit data fundamental" berada
SETELAH itu, tidak satu pun hasil yang sudah selesai ikut tersimpan — quotes dan
ownership lalu basi 125 jam tanpa tanda apa pun. Run yang dibatalkan terbaca
seperti gangguan penjadwalan, bukan seperti empat feed mati. Sekarang tiap
langkah mingguan yang lambat punya `timeout-minutes`, jadi yang menggantung
menjadi skip biasa dan commit tetap jalan membawa yang berhasil.

**IDX memblokir runner GitHub, jadi announcements membeku 114 jam.** "Laporkan
crawl IDX yang diblokir" gagal di empat dari lima run terjadwal terakhir:
Cloudflare menjawab IP datacenter, bukan koneksi rumah. Ingest yang sama selesai
**54 detik** dari mesin lokal. Karena itu `data:announcements` dipindah ke tier
eod penjadwal lokal, dan job mingguan lokal kini juga menarik ownership, macro
dan tanker — sebelumnya feed-feed itu tidak ada di tier lokal mana pun, CI
satu-satunya yang menjalankannya, dan CI-lah yang dibatalkan.

**Winrate tinggi itu gampang dipalsukan, dan gerbang "expectancy > 0" tidak
cukup.** Pencarian pertama papan strategi meloloskan 3.933 rule set; juaranya
menang 94% dengan stop 3×ATR mengejar target 0,5×ATR — expectancy cuma +0,10R,
dan turun sembilan poin winrate saja sudah rugi. Sekarang tiap kandidat dihitung
ulang dengan winrate dipotong 10 poin memakai rata-rata menang/kalahnya sendiri;
yang jadi rugi dibuang berapa pun winrate aslinya. Itu memangkas 3.933 → **101**.
Peringkatnya pun memakai angka setelah potongan, bukan winrate mentah.

**Tiga kegagalan SENYAP berturut-turut di hook suara — semuanya `exit 0`.**
Tidak satu pun terdeteksi tes otomatis; ketiganya akhirnya ketahuan dari telinga
pengguna. (1) `process.exit(0)` di dalam callback async membuat libuv crash di
Windows (`UV_HANDLE_CLOSING`, exit 127) — pakai `process.exitCode` dan biarkan
event loop selesai. (2) PowerShell menyisipkan **BOM UTF-8** saat pipe ke stdin
sehingga `JSON.parse` gagal dan payload jadi `{}`. (3) Fish Audio mengirim WAV
dengan `data` chunk size palsu `0xFFFFFF00` karena responsnya di-stream; Windows
menolak file itu lalu **memutar bunyi default sistem** dan melapor sukses.
Pelajarannya melampaui suara: **jangan pernah menyimpulkan berhasil dari exit
code** di repo ini.

**`System.Media.SoundPlayer` tidak memutar apa pun di sesi non-interaktif** —
balik dalam 0,01 detik tanpa exception. Pakai `winmm.dll` `PlaySound` dengan
`SND_FILENAME|SND_NODEFAULT` (0x00020002). Tanpa `SND_NODEFAULT`, file yang
ditolak akan diganti bunyi sistem dan dilaporkan sukses.

**402 bukan berarti API key rusak.** Fish Audio membalas 402 Payment Required
untuk key yang sah di akun tanpa kredit; key rusak menjawab 401. Model gratis
`s2.1-pro-free` menjawab 200 pada request yang sama, dan itulah default sekarang.

**Penyimpanan yang benar secara nalar bisa salah dalam pemakaian.** Portofolio
awalnya disimpan di localStorage, dengan alasan Vercel tidak punya disk permanen
dan posisi orang itu data paling pribadi di aplikasi ini. Kedua premis itu masih
benar. Yang terlewat: browser tempat layar ini dilihat mulai dari profil bersih,
jadi tiap sesi baru menemukan portofolio kosong dan harus diketik ulang.
Sekarang layanan lokal yang memegang `.data/portfolio.json`, localStorage jadi
cadangan untuk situs statis terdeploy, dan salinan lokal yang terisi otomatis
menyemai berkas kosong pada pemakaian pertama — supaya pindah penyimpanan tidak
terlihat seperti kehilangan semuanya. Pelajarannya: **premis yang benar tidak
menjamin desain yang benar; yang menentukan adalah bagaimana benda itu dipakai.**

**`listen(PORT)` tanpa host membuka SEMUA interface.** Ditemukan tidak sengaja
saat memutuskan apakah rute portofolio boleh tanpa auth: selama ini penyimpanan
akun dan chatbot bisa dijangkau siapa pun di jaringan lokal yang sama. Sekarang
bind ke `127.0.0.1` (override lewat env `HOST`), diverifikasi lewat `netstat`.
Itu pula yang membuat `/api/portfolio` tanpa sesi bisa dipertanggungjawabkan:
"terbuka" berarti terbuka bagi proses di mesin ini, batas kepercayaan yang sama
dengan berkasnya sendiri.

**Satu sesi bursa yang hilang dari kalender terbaca sebagai 701 aksi korporasi.**
Ini gabungan dua kesalahan yang masing-masing tidak berbahaya. Pertama, `cached()`
di `ingest-idx.mjs` menyimpan jawaban KOSONG ke disk selamanya. Feed EOD IDX
tertinggal 1-2 hari kalender, jadi crawl yang menanyakan 2026-08-26 pada pukul
12:00 WIB tanggal 26 dijawab nol baris — bukan karena libur, tapi karena IDX
belum menerbitkannya. Jawaban itu tersimpan, tiap run berikutnya membaca cache
alih-alih bertanya lagi, dan sesi bursa yang sungguhan pun dicatat sebagai
**hari libur**. Kedua, faktor aksi korporasi diturunkan dari
`Previous[i] / close[i-1]` tanpa memeriksa bahwa `i-1` benar-benar sesi
sebelumnya. Begitu 08-26 hilang, `Previous` milik 08-27 menunjuk penutupan yang
tidak pernah tersimpan, dan selisih dua hari gerak harga terbaca sebagai split
untuk **701 dari 962 emiten** — yang lalu menyesuaikan mundur SELURUH 283 sesi
riwayat tiap emiten dengan faktor yang tidak pernah ada.

Tidak ada yang melempar, tidak ada NaN, tiap harga masih terlihat seperti harga:
BBCA hanya berubah dari 6400 jadi 6350,0032 pada 08-24. Yang bergerak adalah
atribusi indeks — meleset 95 poin di SETIAP jendela lebih panjang dari sehari,
sementara jendela satu hari tetap rekonsiliasi sempurna sehingga layar MOST
terlihat sehat. Backtest pun lolos nol temuan, karena residualnya "sudah
dijelaskan" oleh catatan rekonsiliasi. Satu-satunya yang menangkap adalah
`npm test` lewat toleransi 8% pada 1w/1m/3m. Gejala di meta: `corporateActions`
melonjak 32 → 733.

Sekarang: jawaban hari kosong tidak pernah disimpan (dan entri lama yang telanjur
tersimpan diperlakukan sebagai cache miss, jadi cache yang sudah teracuni sembuh
sendiri), dan ingest MENOLAK menulis kalau satu sesi memicu faktor untuk >5%
pasar — pesannya menyebutkan hari kerja yang hilang di antaranya. `--allow-gap`
ada untuk sesi yang memang tidak pernah diterbitkan IDX; ia menulis TANPA faktor
pada sesi itu, bukan dengan faktor yang salah, dan mencatatnya di
`meta.gapSessions`. Invariannya ada di backtest: tidak boleh ada satu tanggal pun
yang memuat faktor aksi korporasi pada lebih dari 5% emiten yang berharga hari
itu.

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

Ada tembok KETIGA yang bentuknya mirip dan penyebabnya lain sama sekali: dari
sesi Claude Code yang jalan di cloud, `www.idx.co.id` ditolak di gerbang egress
sesi itu sendiri — `403 to CONNECT (policy denial)`, nol byte dalam 0,3 detik,
tidak pernah menyentuh IDX. Jangan salah baca itu sebagai IDX yang memblokir:
tantangan Cloudflare memakan 40 detik dan mengembalikan HTML, penolakan
kebijakan langsung dan mengembalikan nol. Yang pertama bisa disiasati, yang
kedua tidak boleh diakali dan harus dilaporkan apa adanya. Ringkasnya, dari tiga
tempat hanya satu yang bisa menarik data resmi IDX sekarang: **koneksi rumah**.

**`workflow_dispatch` dulu berarti "segarkan kuotasi Yahoo saja".** Langkah
perencana memetakan pekerjaan dari `github.event.schedule`; pada run manual
variabel itu kosong, tidak ada `case` yang cocok, dan `EOD` tetap `false`. Jadi
menekan Run workflow menyegarkan harga Yahoo lalu berhenti — seri resmi dan arsip
pengumuman setenang sebelumnya — sementara run-nya hijau dan tetap meng-commit
satu berkas, sehingga terlihat persis seperti refresh yang berhasil. Sekarang ada
input `official_catchup` yang menyala secara default; `full_refresh` tetap
menjaga crawl mingguan yang lambat. Pola yang sama muncul dua kali dalam satu
sesi: langkah yang berhasil mengerjakan lebih sedikit daripada yang diminta.

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

**Daftar fitur yang ditulis tangan SELALU melenceng, dan melencengnya tidak
kelihatan.** Halaman depan memuat 11 kartu yang dikurasi manual. Saat diperiksa,
ia masih mengiklankan **RISK** — layar yang sudah dihapus berminggu-minggu
sebelumnya — sementara enam layar yang sudah rilis (JRN, PORT, CN, NEWS, TNKR,
AVAL) tidak disebut sama sekali. Tidak ada yang error: kartu untuk layar mati
ter-render semulus kartu untuk layar hidup, dan kartu yang hilang ter-render
sebagai ketiadaan. Sekarang backtest membaca sumber `LandingPage.tsx` dan
menuntut dua arah — tiap kartu harus menunjuk kode yang ada di registri, dan
tiap kode di registri harus punya kartu. Jumlah layar dibaca dari
`TERMINAL_FUNCTIONS.length`; menulisnya manual memerahkan run. Diuji dengan
menyuntikkan kedua bug lamanya sekaligus, dan keduanya tertangkap.

Dibaca dari SUMBER, bukan dengan mengimpor komponennya: halaman depan menarik
React dan lucide-react, dan menyeret modul JSX ke dalam bundel node hanya untuk
menghitung string lebih mahal daripada yang dibuktikannya.

**Dua angka di satu halaman yang bertentangan itu bukan typo, itu kegagalan
ketertelusuran.** Draf halaman depan menulis "716 sesi riwayat" di hero dan "45
indeks" di kotak provenance, sementara kartu di bawahnya menghitung 715 dan 46
dari `db` yang sama. Fallback kartu bahkan sempat `716` sementara prosa hero
`715` — versi mini dari bug yang sama. Aturannya sekarang: apa pun yang bisa
dihitung dibaca dari `db`, dan prosa yang tidak bisa menerima angka live
berbicara kualitatif ("seluruh indeks resmi").

**Copy "yang bagus" itu justru AI slop, dan pemilik repo yang menangkapnya.**
Draf pertama halaman depan saya tulis rapi dan formal: "Kebanyakan alat saham
menjawab lebih percaya diri daripada yang datanya izinkan", "Angka tanpa asalnya
cuma opini yang rapi". Terbaca seperti terjemahan, bukan seperti orang. Lebih
buruk lagi: halaman LAMA sebenarnya sudah lebih tongkrongan — ada "nggak",
"gue", "saham gocap" di sana — jadi drafnya adalah kemunduran yang saya sendiri
masukkan, di repo yang HANDOVER-nya sudah menulis bahwa layar baru ditulis
dengan bahasa tongkrongan.

Dua penyakitnya terpisah dan dua-duanya harus diobati. Pertama REGISTER: sekarang
mengikuti suara yang sudah dipakai MACRO dan MAP ("Angkanya kecil-kecil, dan itu
emang jawabannya", "Sehari doang itu noise") — bukan versi "santai" karangan
sendiri. Kedua KEPADATAN: halaman depan bukan tempat menjelaskan metode. Yang
dibuang antara lain penurunan divisor indeks dan rekonsiliasi 0,0003 poin,
penyesuaian Blume dan gerbang R², serta corong empat tahap watchlist yang
diurai satu per satu. Badan kartu turun dari rata-rata ~200 karakter jadi 94.
Kalau sebuah kalimat menjelaskan CARA KERJA, tempatnya di dalam layarnya, bukan
di halaman depan.

**Claude tidak bisa membaca video, tapi browser bisa.** Pemilik repo mengirim
mp4 sebagai referensi. Models API mengonfirmasi Opus 5 hanya menerima teks,
gambar, dan PDF — tidak ada video di daftar kapabilitasnya. ffmpeg juga tidak
terpasang di mesin ini. Jalan yang berhasil: salin mp4 ke `public/` sementara,
buka lewat dev server yang sudah jalan dengan `<video>` plus helper seek, lalu
SCREENSHOT frame-nya — screenshot adalah gambar, dan gambar bisa dibaca. Berkas
sementaranya dihapus setelah selesai. Kalau nanti ada video lagi, itu resepnya.

**Ringkasan AI yang hanya membaca JUDUL akan terdengar benar dan mengarang
seluruhnya.** Semua yang menyentuh pengumuman di aplikasi ini bekerja dari
judul — taksonomi, skor narasi, chip kategori — dan layarnya mengatakan itu
terang-terangan. Itu batas yang jujur untuk sebuah pengklasifikasi, dan batas
yang TIDAK jujur untuk sesuatu yang diberi label "ringkasan": model yang cuma
diberi "Penambahan Modal Tanpa HMETD" akan menulis paragraf lancar tentang apa
yang biasanya ada di pengajuan semacam itu, dan tiap kalimatnya karangan yang
berpakaian seperti hasil membaca. Jadi `disclosureSummary.ts` mengambil PDF
aslinya lewat curl (fetch bawaan Node tetap ditolak IDX) dan mengirim byte-nya
ke Claude sebagai document block — tanpa pustaka ekstraksi teks sama sekali,
dan tetap jalan untuk pengajuan hasil pindaian yang tidak punya lapisan teks.
Bedanya terukur: untuk ASBI, ringkasannya keluar membawa Rp 400 juta per bulan
selama minimal 2,5 tahun, nomor laporan polisi, pelaporan ke OJK lewat APOLO,
dan inisial terlapor — tidak satu pun ada di judulnya.

Dua hal yang ketahuan dari pemanggilan LIVE pertama, bukan dari membaca ulang
prompt: model tetap membuka dengan heading markdown padahal prompt melarang
judul (UI merender teks polos, jadi `#` tampil apa adanya), dan ia menyalin
`5,789999961853027%` mentah-mentah dari PDF karena prompt menyuruh membawa angka
persis seperti tertulis. Sekarang promptnya memberi satu-satunya izin mengubah
angka — merapikan ekor desimal yang jelas artefak, tanpa menggeser nilainya —
dan `tidy()` tetap membersihkan markdown yang lolos. Meminta dan membersihkan,
bukan salah satunya.

Ringkasannya di-cache selamanya per path PDF. Pengajuan itu tidak berubah
setelah terbit, jadi meringkasnya ulang hanya membakar biaya untuk menghasilkan
parafrase berbeda dari paragraf yang sama — dan dua orang yang membuka pengajuan
yang sama akan melihat ringkasan yang berbeda. Rutenya POST, dan itu penjaganya:
satu-satunya rute di aplikasi ini yang membelanjakan uang per panggilan tidak
boleh bisa dipicu prefetch, crawler, atau refresh halaman.

**Jurnal pick: mengukur daftar yang BENAR-BENAR dicetak, bukan aturannya.**
Papan strategi sudah menguji aturan mekanis atas 715 sesi dan untuk pertanyaan
"apakah aturan ini bekerja" ia bukti yang lebih kuat. Ia tidak bisa menjawab
apakah daftar yang terminal ini CETAK, dalam urutan yang dipakainya, dengan
ambang yang benar-benar dikirim, menghasilkan uang — lapisan narasi Watchlist
membaca pengajuan yang hanya ada 45 hari ke belakang, urutan conviction yang
menentukan lima nama mana yang dilihat orang, dan ambang screener berubah begitu
ada yang menyuntingnya di layar. `.data/picks.json` mencatat sepuluh teratas
tiap layar tiap sesi, ditulis penjadwal pada `post-close`, dan dinilai maju
memakai stop/target ATR yang sama dengan yang dicetak layar.

Empat keputusan yang menentukan apakah angkanya berarti:

1. **Penjadwal yang mencatat, bukan UI.** Mencatat saat orang membuka layar akan
   membuat jurnalnya jadi catatan PERHATIAN, bukan catatan keluaran: hari yang
   tidak dibuka lenyap, dan sampelnya condong ke hari yang pasarnya menarik.
   Winrate dari sampel seperti itu mengukur kebiasaan browsing.
2. **Menolak sesi yang masih berjalan.** Harga intraday itu nyata tapi bergerak:
   pick yang sama dicatat 09:30 dan 14:00 menghasilkan dua entry, dua stop ATR,
   dan akhirnya dua vonis berbeda. `--force` ada untuk pengujian dan menandai
   barisnya `entryIsFinalClose: false`; baris itu DIKECUALIKAN dari tiap statistik
   dan tetap disimpan di berkas — mengecualikan baris dari statistik tidak sama
   dengan menghapusnya, dan yang kedua memusnahkan bukti.
3. **Baris sementara digantikan, bukan diblokir.** Cacat yang baru kelihatan saat
   diuji: id-nya `sesi:sumber:kode`, jadi run paksa siang hari mengklaim tiap id
   yang akan ditulis run post-close, dan pencatatan resmi hari itu akan
   dilewati diam-diam sebagai duplikat. Sekarang baris non-final sesi itu dibuang
   begitu ada pencatatan final.
4. **Winrate ditahan di bawah 20 pick selesai**, dan posisi terbuka tidak pernah
   dihitung sebagai setengah kemenangan. Di awal periode hampir semuanya
   terbuka, dan yang selesai paling cepat justru yang paling volatil.

**TIDAK ada backfill, dan itu keputusan, bukan kemalasan.** Merekonstruksi dua
tahun "apa yang akan dikatakan screener" tersedia dan ditolak: rumus conviction
berubah 2 September 2026, arsip pengajuan cuma 45 hari, register KSEI mulai
2024. Pick 2024 hasil rekonstruksi akan dinilai memakai masukan yang tidak
pernah ia miliki — menghasilkan winrate dengan angka nyata dan tanpa makna, yang
lebih buruk daripada tabel kosong yang berkata "datanya belum cukup".

**Invariant look-ahead-nya sudah diuji menggigit.** Pick yang dicatat pada sesi
TERAKHIR wajib berstatus `open`, karena tidak ada sesi sesudahnya. Mengubah loop
penilaian dari `h = 1` jadi `h = 0` — satu karakter — langsung memerahkan
backtest. Ditambah: hasil `stop` wajib R = −1 persis, `target` wajib
R = 2,5/1,5, `expired` wajib tepat 63 sesi, dan ringkasan tidak boleh mencetak
winrate saat nol pick selesai.

**Kata kunci layar baru ketahuan hilang dalam hitungan menit.** JRN ditulis
dengan `hint` yang tidak memuat kata "jurnal" — namanya bahasa Inggris ("Pick
Journal"), dan `searchFunctions` mencocokkan ketikan Indonesia ke `hint`. Daftar
kata wajib di backtest menangkapnya sebelum sempat tayang. Ini kali ketiga
penjaga itu membayar dirinya sendiri.

**Tiga percobaan dengan crumb yang SAMA bukan tiga percobaan.**
`ingest-intraday.mjs` sudah mengulang tiap batch 3x, tapi semuanya memakai satu
crumb. Pada 2026-09-02 09:24 WIB Yahoo mengembalikan **0 dari 962**, run jatuh
ke fallback Google yang dibatasi 120 nama, dan berkasnya ditulis dengan exit 0 —
12% semesta, terlihat sehat. `getCrumb()` sendiri BERHASIL; crumb-nya
well-formed, cuma tidak dihormati lagi oleh endpoint kuotasi, jadi tidak ada
yang mengeluh di mana pun. Menjalankan perintah yang sama sekali lagi langsung
mengembalikan 962/962, karena proses baru mengambil cookie jar baru. Sekarang
kalau satu sapuan kehilangan lebih dari separuh semesta, skrip mengambil sesi
BARU (jar lama dihapus) dan menyapu sekali lagi sebelum menyerah ke Google.
Diuji dengan memaksa crumb pertama palsu: `0/962 → sesi baru → 962/962`.

**`Number.isFinite(0)` bernilai true, dan itu memasukkan harga NOL ke terminal.**
Ditemukan pada hari yang sama: Yahoo menjawab SCPI dengan `price 0, prevClose 0`
berstempel 2024-07-19, sementara penutupan resmi terakhirnya Rp 29.000. Penjaga
di ingest memakai `Number.isFinite(q.regularMarketPrice)`, dan nol lolos —
overlay membawa SCPI di Rp 0, −100%. Tidak melempar, tidak NaN, cuma angka yang
terlihat seperti harga. Sekarang syaratnya `> 0`.

**Kuotasi berstempel lama yang harganya BEDA menciptakan gerakan hantu.** FASW
dikutip 5.450 berstempel 2025-01-30 sementara IDX terakhir menutupnya di 5.275,
jadi overlay mengarang kenaikan +3,3% untuk saham yang tidak bertransaksi
sembilan belas bulan — dan tiap hitungan breadth, atribusi indeks, dan daftar
"penggerak terbesar" mempercayainya. Yang dibuang HANYA yang harganya berbeda:
membuang semua kuotasi basi juga akan mengosongkan berkas pada run akhir pekan
atau hari libur, di mana justru harga terakhir ITULAH harga yang berlaku —
perubahan perilaku yang jauh lebih besar daripada bug yang diperbaiki.

**Tes yang membagi dengan gerak indeks harian akan pecah sendiri pada pasar
datar, dan itu BUKAN alasan melonggarkan toleransi.** "Residual di bawah 10%
dari gerak" adalah pertanyaan yang benar pada hari normal dan tidak bermakna 30
menit setelah pembukaan: 2026-09-02 pukul 09:22 IHSG baru bergerak 2,92 poin di
level 6.602 (0,04%) sementara residual 3,19 poin — 109% dari gerak, tapi 0,048%
dari level. Penyebutnya yang menuju nol, bukan errornya yang membesar. Pintu
darurat lama (`residual < 1 poin`) tidak pernah teruji karena tiap run
sebelumnya punya overlay yang identik dengan penutupan resmi, yang rekonsiliasi
di 0,00 persis.

Yang WAJIB dikerjakan sebelum menyentuh tes semacam ini — dan dikerjakan di sini
— adalah menghabiskan dulu penjelasan lain: mesinnya (published-vs-published
tetap menutup di bawah 0,01 poin), baseline-nya (`prevClose` ^JKSE Yahoo
6599,943 lawan penutupan resmi IDX 6599,943, sama sampai digit terakhir — klaim
lama di dokumen ini diperiksa ulang dan ternyata benar), dan konstituennya (dua
kuotasi memang beracun, keduanya diperbaiki, dan residualnya TIDAK bergerak —
itu yang membuktikan sisanya skew feed). Baru setelah itu tesnya diubah: rasio
ketat tetap berlaku kalau indeks benar-benar bergerak (≥20 poin), dan di bawah
itu rasionya tidak dievaluasi sama sekali, diganti batas terhadap LEVEL indeks
(0,1%) yang tidak runtuh. Cabang ketatnya diuji masih menggigit dengan memaksa
ambangnya ke nol: langsung merah.

**`laggardGap` meloloskan 2 rule set setelah satu sesi tambahan, naik dari 0.**
Jangan dibaca sebagai "setup tertinggal akhirnya terbukti". Dua dari 6.048 rule
set adalah tepi kebisingan, bukan penemuan; angkanya berpindah karena datanya
bertambah satu hari, bukan karena idenya menguat.

**Kolom bernama "conviction" ternyata mengurutkan KETERLAMBATAN, dan itu
persis keluhan yang dilaporkan.** "Sahamnya sudah terbang, kita baru nangkep"
bukan komentar tentang pasar — itu deskripsi akurat tentang
`momentumConviction()`. Tiga dari tujuh sukunya, 35% bobot, membayar LEBIH
mahal justru ketika kita makin telat: `trend` (jarak di atas MA panjang),
`persistence` (sudah berapa lama di atasnya), `relStrength` (keunggulan 3
bulan). Diukur pada sesi 2026-09-01, sepuluh teratasnya adalah persis apa yang
diminta suku-suku itu — TAPG +60%, SINI +91%, KKES +120%, SGER +148% dalam 60
sesi. Median sepuluh teratas: **sudah naik 71% dari dasar 60 sesi, meregang 3,4
ATR dari MA20**. Layar ini tidak telat karena kebetulan; ia DIURUTKAN menurut
keterlambatan, di kolom yang namanya terbaca seperti penilaian kualitas.

Sekarang bobot itu diganti `freshness` (1 sesi di atas MA panjang = nilai
penuh, 6+ sesi = nol) dan `room` (jarak ke MA20 dalam satuan ATR, 0 = penuh,
3 ATR = nol). Median sepuluh teratas menjadi **naik 19%, regangan −0,1 ATR, 1
sesi di atas MA** — CPIN, HEAL, BRIS, BUKA, yang semuanya baru menembus hari
itu. **ATURAN KERASNYA TIDAK DISENTUH**: 227 emiten yang sama tetap lolos.
Pelajarannya berlaku umum di repo ini: gerbang salah menghasilkan daftar yang
salah dan itu ketahuan, sedangkan peringkat salah menghasilkan daftar yang
BENAR dalam urutan yang salah — dan karena layar ini menampilkan lima teratas
secara bawaan, urutan itulah yang sebenarnya dibaca orang.

**Regangan harus dinormalkan ATR, bukan persen.** 8% di atas MA20 adalah hari
Selasa biasa untuk saham yang bergerak 6% sehari, dan regangan ekstrem untuk
yang bergerak 1%. Memakai persentase mentah akan mencap tiap saham volatil
selamanya telat dan tiap saham tenang selamanya awal — bukan mengukur apa pun
kecuali volatilitas.

**Trigger paling telat adalah yang paling tidak berguna, dan sekarang ada
angkanya.** Papan strategi tidak pernah bisa menjawab "seberapa telat aturan
ini masuk" karena angkanya memang tidak pernah dihitung. Sekarang tiap trigger
melaporkan `avgRunupAtEntry` — rata-rata kenaikan yang SUDAH terjadi dari dasar
60 sesi pada saat ia menyala, di seluruh sinyalnya, bukan cuma yang lolos:

    breakout20    masuk setelah naik 87%  →  0 survivor dari 5.688
    drawdown10                        52%  →  0
    pullback20                        45%  →  7
    ma50x100                          43%  →  109
    volumeLead                        20%  →  82
    laggardGap                        12%  →  0

Tembus-tertinggi-20-sesi masuk paling telat DAN tidak meloloskan apa pun; jarak
ke indeks masuk paling awal dan juga tidak meloloskan apa pun. **Masuk lebih
awal itu syarat perlu, bukan syarat cukup** — jangan membaca tabel ini sebagai
"makin awal makin bagus".

Tiga trigger baru yang bisa menyala SEBELUM harga bergerak ikut diuji:
`volumeLead` (volume ≥2,5× sementara harga masih menempel MA20), `flowLead`
(asing net beli 5 sesi sementara harga 20 sesi masih datar), `squeezeBreak`
(volatilitas termampat lalu menembus). Dua yang pertama lolos gerbang —
`volumeLead` dengan **82 survivor**, terbanyak kedua setelah ma50x100. Plus dua
filter keterlambatan (`notExtended` <1,5 ATR di atas MA20, `earlyRunup` belum
naik 25%) yang bisa di-AND-kan ke trigger LAMA — dan itu yang paling berhasil:
**9 dari 25 papan teratas sekarang memakainya**, dengan pola berulang
`MA50 memotong MA100 + harga di bawah MA20 + belum naik 25%` (WR uji 80% dari
40 trade, +0,22R setelah potongan). Artinya tren panjang yang baru berbalik
naik TAPI harganya belum ikut — bukan menunggu sampai semuanya sudah jelas.

**Invariant yang salah memerahkan run atas 489 emiten yang semuanya benar.**
Pemeriksaan "runup dan diskon harus konsisten" ditulis sebagai
`runup + dip >= 0`, yang bukan identitas sama sekali: `close/low + close/high
>= 2` salah untuk saham mana pun yang duduk di antara dasar dan puncaknya.
Yang benar `runup >= dip` (karena `low <= high`). Ini kebalikan dari mode
kegagalan biasa di repo ini — biasanya kodenya salah dan pemeriksaannya benar.
Kalau backtest memerahkan ratusan emiten sekaligus dengan pola yang rapi,
curigai dulu invariannya.

**Suara mengucapkan teks balasan, jadi "suaranya bahasa Inggris" bukan setelan
melainkan sumber teks.** Hook hanya punya balasan yang sudah ditulis, dan
balasan di sini berbahasa Indonesia. Menerjemahkannya lewat model ditolak:
butuh `ANTHROPIC_API_KEY` yang TIDAK ada di environment ini (ia hidup di dalam
`.env` satu proyek, dan hook global yang merogoh rahasia satu proyek akan patah
hari folder itu pindah), menaruh satu round trip jaringan di depan tiap giliran,
dan tetap saja menerjemahkan 700 karakter prosa yang memang tidak layak
didengarkan. Sekarang balasannya menominasikan sendiri kalimat yang diucapkan:
baris yang diawali 🔊, bahasa Inggris, satu-dua kalimat. Yang TERAKHIR yang
dipakai. Tanpa penanda, hook kembali ke perilaku lama (membacakan prosa) —
lupa menulis penanda berarti satu kalimat Indonesia, bukan kesunyian. Aturannya
ada di `~/.claude/CLAUDE.md` supaya ikut sesi berikutnya. Kalimat alert di
`speak-alert.mjs` dan `record()` di `src/server/index.ts` sudah Inggris
langsung — itu string tetap, tidak perlu mesin apa pun.

**Screener yang hanya bisa menjawab satu pertanyaan menyembunyikan setengah
pasar, dan ketidakhadirannya tidak kelihatan.** Aturan lamanya — close di atas
MA3 DAN MA5 — secara konstruksi tidak akan pernah mengembalikan saham yang
sedang turun. Jadi dua setup yang benar-benar dipakai pemilik repo tidak
punya layar sama sekali: saham bagus yang sedang diskon (antre beli/buyback),
dan saham yang diam sementara indeks sektornya sudah lari (PTBA tertinggal 20 pp
dari IDXENERGY, PGAS 30 pp). Yang membuatnya mahal: layar itu tidak pernah
terlihat rusak. Ia mengembalikan 227 baris yang semuanya benar, dan yang hilang
tidak muncul di mana pun untuk dihitung. Sekarang `ScreenerMode` punya tiga
nilai dengan aturan keras masing-masing, corong sendiri, dan conviction sendiri.

**Conviction momentum TIDAK BOLEH dipakai untuk mengurutkan daftar diskon.**
Ia memberi nilai atas jarak DI ATAS MA panjang dan lamanya bertahan di sana;
kandidat antre beli berada di bawah MA pendeknya menurut definisi. Hasilnya
bukan skor rendah yang seragam — hasilnya daftar yang diurutkan terbalik:
diskon paling DANGKAL naik ke urutan teratas, persis kebalikan dari gunanya
layar itu. Tiap mode punya fungsi skornya sendiri sekarang, dan alasan itu
ditulis di atas fungsinya.

**Membeli kelemahan lolos gerbang winrate lalu mati di gerbang expectancy —
keempat trigger barunya, nol survivor.** Papan strategi diperluas supaya dua
setup baru itu diuji, bukan sekadar ditayangkan: `dipBelowMa20`, `rsiDown40`,
`drawdown10`, `laggardGap`, plus filter `belowMa20`, `indexUp10`, `lagging10`.
Hasil out-of-sample-nya jelas dan negatif. Masing-masing menghasilkan 700-1.150
rule set yang lolos winrate uji ≥65% — dan NOL yang juga lolos expectancy
≥0,15R. Artinya winrate itu dibeli dengan target kecil melawan stop lebar,
persis kerapuhan yang gerbang stres dibuat untuk menangkapnya. `breakout20`
yang sudah lama ada gugur dengan pola yang sama. Kesimpulannya: ketiga layar
screener tetap alat riset, tapi hanya keluarga momentum/trend yang punya aturan
mekanis terbukti di belakangnya, dan papan strategi sekarang MENERBITKAN
kegagalan itu per trigger (`perTrigger` di `strategies.json`, tabel "Tiap
trigger, termasuk yang gugur" di layar WL). Papan yang hanya memuat pemenang
membuat "sudah dicoba dan gagal" tidak bisa dibedakan dari "tidak pernah
dicoba".

**`scripts/` TIDAK ikut diperiksa `tsc`.** `tsconfig.json` memuat
`"include": ["src", "api"]` saja, dan `npm run backtest`/`strategy:lab` dibundel
esbuild yang tidak mengecek tipe. Konsekuensi nyata di sesi ini: menambah
parameter WAJIB ke `buildIndicators` meninggalkan satu pemanggil lama dengan dua
argumen, dan itu BUKAN error kompilasi — `indexClose` jadi `undefined`, seluruh
seri indeks jadi NaN, dan drawdown finalis laggard dihitung dari trigger yang
tidak pernah menyala. `npx tsc --noEmit` bersih selama itu terjadi. Kalau
mengubah tanda tangan fungsi yang dipakai `scripts/`, cari pemanggilnya dengan
grep — kompilernya tidak akan menolong.

**Mengetik `konglomerasi` tidak pernah menemukan CNG, padahal dokumen ini
menjadikannya alasan `hint` wajib berbahasa Indonesia.** Klaimnya salah sejak
awal: `hint` CNG berbunyi "31 grup pengendali…" dan kata "konglomerasi" tidak
ada di code, name, maupun hint-nya, jadi `searchFunctions('konglomerasi')`
mengembalikan kosong. Ditemukan bukan dengan membaca, tapi karena backtest
sekarang punya daftar kata yang WAJIB menemukan layarnya (`diskon`,
`tertinggal`, `antre beli`, `buyback`, `salah harga`, `momentum` → SCR;
`konglomerasi` → CNG). Layar yang tidak bisa dicari sama saja dengan layar yang
tidak pernah di-deploy, dan satu-satunya pemeriksaan yang bisa melihatnya adalah
yang benar-benar mengetikkan katanya.

**Suara Fish Audio berganti-ganti orang karena `reference_id` tidak pernah
dikirim.** `FISH_AUDIO_VOICE_ID` opsional dan tidak pernah diset, jadi tiap
request keluar TANPA voice dan Fish Audio menjawab dengan default-nya saat itu —
penutur berbeda dari satu giliran ke giliran berikutnya. Tidak ada yang gagal:
200 OK, audio sungguhan, orang yang salah. Sekarang dipatok ke
`b9698f640357419494bacb46ddcae040` ("Digital System Assistant", My Voices milik
pemilik repo) sebagai default di `~/.claude/hooks/tts.mjs`; env var masih bisa
menimpanya, tapi string kosong TIDAK melepas patokan. Diverifikasi ke API
sebelum dipatok: `GET /model/<id>` menjawab 200 state "trained", dan id palsu
dijawab **400** — jadi 200 berarti suara itu yang benar-benar dipakai.
Ditambahkan juga `tts-last-error.log` (ditimpa, tidak pernah tumbuh) supaya
penolakan HTTP tidak lagi lenyap tanpa jejak: 401 kunci mati, 402 kredit habis,
400 voice id tidak resolve — tiga sebab yang selama ini sama-sama terdengar
sebagai "suaranya diam saja".

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
DES, CHAT, MOST, CNG, FUND, PORT, TNKR, NEWS, AVAL, DCF, LBO). Menambah layar baru = menambah satu
baris di sana; `MenuPanel.tsx` dan `FunctionBar.tsx` keduanya membaca dari situ,
jadi sebuah layar tidak mungkin ada di satu tempat tapi hilang di tempat lain.

## Peta kode

```
scripts/          ingest via curl: idx, intraday, quotes, fundamentals,
                  brokers, ownership (KSEI), announcements (keterbukaan info)
src/models/       dcfEngine, lboEngine, factorEngine,
                  indexAttribution, conglomerateRotation, autoValuation,
                  brokerFlow, ownershipFlow, announcements (taksonomi judul),
                  stockScreener (aturan keras, TIGA mode: momentum / pullback /
                  laggard — masing-masing punya corong + conviction sendiri),
                  watchlist (corong 4 tahap, tahap 3 membaca ketiga mode),
                  emitenQueryEngine, idxCompanyBridge
src/data/         marketRepository (isomorfik: browser + Node), fundamentals,
                  conglomerates (kurasi, 31 grup), narratives (tema kebijakan
                  kurasi), idxIndexCatalog, chatClient, authClient
src/server/       index (HTTP + scheduler), schedule (WIB), auth (scrypt),
                  emailAlert, chatApi, marketFromDisk, alertCli
src/components/   landing, layout, market, analytics, chat, auth, dcf, lbo
src/components/market/AnnouncementFeed.tsx   layar CN — arsip keterbukaan
                  informasi, kategori + filter + tautan PDF asli
src/models/pickJournal.ts    penilaian pick maju + ringkasan winrate
src/models/pickReport.ts     laporan Excel bulanan jurnal pick
src/server/pickRecorder.ts   penulis .data/picks.json, dipanggil post-close
src/server/disclosureSummary.ts  ambil PDF IDX + ringkas lewat Claude, di-cache
src/theme/chart.ts   warna Recharts (satu-satunya hex di luar tailwind.config)
src/components/common/ui.tsx   primitif bersama: Panel, Segmented, Stat,
                  TableScroll, EmptyState — semua aturan responsif ada di sini.
                  Segmented memberi gradasi di sisi yang masih ada isinya dan
                  menggeser tab aktif ke dalam pandangan lewat scrollLeft-nya
                  sendiri (scrollIntoView ikut menarik seluruh halaman)
src/components/layout/   Header + MobileTabBar (tombol kelima = Function
                  Menu, satu-satunya jalan ke peluncur dari layar sentuh),
                  LiveStatusBar (termasuk "Seri resmi tertinggal N sesi"),
                  MenuPanel (Ctrl+K),
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
scripts/ingest-gdelt.mjs      irisan Indonesia dari berkas mentah GDELT 2.0
                              (15 menit/slice) -> gdelt.json, retensi 45 hari
scripts/ingest-risk.mjs       komponen tekanan bersumber publik + komposit
                              yang metodenya dicetak di dalam berkasnya -> risk.json
scripts/strategy-lab.ts       12 trigger x 67 kombinasi filter x 72 exit,
                              out-of-sample; menerbitkan `perTrigger` supaya
                              keluarga yang GAGAL tetap terlihat, bukan hilang
scripts/backtest.ts           sapuan invariant seluruh semesta, lokal
scripts/backtest-live.ts      sapuan invariant terhadap deployment
scripts/preview-dossier.ts    cetak dossier chatbot tanpa memanggil API
src/models/macroLinkage.ts    korelasi/beta tiap instrumen luar ke tiap sektor
src/components/analytics/MacroMonitor.tsx   layar MACRO
src/components/analytics/WorldMap.tsx       layar MAP, globe SVG tanpa pustaka 3D
.claude/agents/               enam subagent proyek ini; disalin ke folder
                              induk lewat `npm run agents:sync`
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
npm run data:gdelt      # 12 hari peristiwa GDELT irisan Indonesia (~4 menit)
npm run data:risk       # komponen tekanan + komposit (~10 detik)
npm run data:news       # 5 kantor berita + kalender ekonomi (~3 detik)
npm run data:tanker     # 6 proksi tarif charter tanker (~3 detik)
npm run strategy:lab    # cari ulang papan strategi, out-of-sample (~1 detik)
npm run alert:preview   # hitung pick tanpa mengirim email

node scripts/wake-report.mjs --since <ISO>   # apa yang terjadi selagi pergi
```

**Suara & sleep mode** (di luar repo, `~/.claude/hooks/`):

```bash
node ~/.claude/hooks/sleepctl.mjs on|off|status   # bisukan suara, catat jamnya
```

Bilang **"sleep mode"** untuk membisukan (kerja jalan terus), **"Daddy's home"**
untuk membangunkan + laporan. Aturannya ada di `~/.claude/CLAUDE.md`. Butuh
`FISH_AUDIO_API_KEY` di environment; tanpa itu hook diam total, bukan error.

## Agen proyek ini

Enam subagent di `.claude/agents/`. Masing-masing memuat jebakan yang relevan
untuk tugasnya, jadi sesi baru tidak perlu menemukan ulang hal yang sudah mahal
ditemukan di repo ini.

| Agen | Dipakai untuk |
|---|---|
| **data-doctor** | menjalankan tangga verifikasi dan melokalisasi kegagalan sampai ke sesi/emiten/field. Dilarang "memperbaiki" dengan melonggarkan toleransi |
| **ingest-operator** | menarik & memperbaiki data. Tahu tiga tembok IDX dan mana yang boleh disiasati (Cloudflare) dan mana yang tidak (penolakan egress) |
| **emiten-analyst** | merangkai enam feed jadi satu benang cerita untuk satu emiten, lewat 9 langkah yang ditarik dari cara @beyondthefundamental membaca MITI. Memuat tabel jujur langkah mana yang BELUM didukung data kita |
| **filing-researcher** | mengambil dokumen primernya: PDF keterbukaan informasi IDX, situs IR emiten, prospektus. Tiap fakta pulang membawa URL, tanggal, dan kutipan — tanpa itu tidak dilaporkan |
| **screen-builder** | menambah/mengubah layar: registri `functions.ts`, tema lewat ramp, dan keterjangkauan dari layar sentuh |
| **deploy-verifier** | memeriksa apa yang BENAR-BENAR disajikan ke pengunjung, dan memisahkan "deployment salah" dari "deployment benar tapi datanya basi" |

Dua agen terakhir sengaja dipisah. `filing-researcher` MENGAMBIL dan mengutip;
`emiten-analyst` MERANGKAI. Langkah paling bernilai dalam metode itu — menemukan
kaitan antar entitas yang tidak kelihatan — juga yang paling gampang dikarang
model, dan kaitan seperti itu menempel pada orang sungguhan. Memisahkan "apa kata
dokumen" dari "apa artinya" membuat batas itu terlihat, bukan tersembunyi di
tengah paragraf.

Agen disimpan di repo supaya ikut ter-commit bersama kode yang dijelaskannya.
Tapi Claude Code mencari agen di folder tempat sesi dibuka, dan sesi biasanya
dibuka di folder INDUK (`liviee`) yang memuat dua proyek lain juga — tanpa
salinan di sana, agennya ada tapi tidak pernah ditawarkan. Itu bentuk kegagalan
yang sama persis dengan layar yang ter-deploy tapi tidak bisa dijangkau.
`npm run agents:sync` menyalinnya; jalankan tiap kali isi `.claude/agents/`
berubah. Membuka Claude Code langsung di folder repo ini tidak butuh salinan.

## Lapisan luar: dicoba lewat MCP, dibatalkan

Sempat dipasang satu server MCP eksternal (`worldmonitor.app`, katalog 69 tool)
untuk menutup tiga lubang yang tidak bisa dibangun jujur dari sini: konvergensi
lintas-aliran (protes + aktivitas militer + pergerakan laut di tempat dan waktu
yang sama), pangsa produksi mineral/HHI untuk CPO-nikel-silika, dan indeks
instabilitas yang dihitung di server mereka. **Dibatalkan** — hampir semua
tool-nya butuh langganan Pro berbayar, dan itu ditolak. `.mcp.json` dan seluruh
rujukan ke MCP itu di kode/agen sudah dicabut, bukan dibiarkan setengah
terpasang.

Sebagian besar alasan MCP itu dipasang sudah tidak berlaku lagi: `get_country_risk`
dan `get_news_intelligence` (GDELT) tergantikan oleh `risk.json`/`gdelt.json` di
bawah — dibangun sendiri dari sumber publik gratis. `get_chokepoint_status`
tidak pernah lebih baik dari `worldmap.json` (IMF PortWatch) yang sudah kita
punya. Yang benar-benar tersisa tanpa pengganti: **konvergensi lintas-aliran**,
**HHI produksi mineral**, dan **data pasar di luar 29 instrumen `macro.json`**.
Ketiganya tetap dinyatakan tidak ada — jangan ditambal proksi, jangan
di-scrape dari situs yang sama sebagai jalan memutar keputusan ini, dan jangan
dipasang ulang tanpa keputusan baru dari pemilik repo.

## Lapisan risiko yang dibangun sendiri

Setelah ketahuan `data.gdeltproject.org` hidup, dua feed baru dibangun dari
sumber primer gratis — bukan menyewa skor pihak lain.

**`gdelt.json`** — irisan Indonesia dari GDELT 2.0 Events. Penyaringnya baca
kolom, bukan grep: `Actor1CountryCode=IDN OR Actor2CountryCode=IDN OR
ActionGeo_CountryCode=ID`. Dua kosakata negara dalam satu baris (aktor CAMEO 3
huruf, geografi FIPS 2 huruf) dan grep `ID` saja sempat menarik berita kebakaran
hutan Amerika sebagai peristiwa Indonesia. ~500-760 peristiwa Indonesia per hari,
lengkap dengan Goldstein scale, tone, quad class, dan URL artikel aslinya.
Retensi 45 hari supaya berkasnya tidak tumbuh tanpa batas — `history.json` yang
6 MB sudah membuat riwayat git naik ~130 MB/bulan sebelum ini ditambahkan.

Pelajaran cache hari ini ikut dipakai: slice yang terbit tidak pernah berubah
jadi aman di-cache selamanya, tapi slice yang KOSONG tidak pernah ditulis ke
disk — persis kesalahan yang menghapus sesi 2026-08-26 dari kalender.

**`risk.json`** — komponen tekanan plus komposit. Aturan repo bukan "jangan
pernah bikin komposit", melainkan jangan menambal dengan proksi dan jangan
menerbitkan angka yang metodenya disembunyikan. Jadi: tiap input endpoint publik
bernama, aritmetikanya dicetak di dalam berkas (`method`), dan komponen
mentahnya diterbitkan di sebelah skornya supaya skornya bisa dibuang dan
komponennya tetap terpakai.

Yang MASUK: pangsa konflik GDELT (quad 3-4), nada pemberitaan (tandanya dibalik
supaya semua komponen searah), gempa M4.5+ USGS di kotak Indonesia. OFAC SDN
ikut sebagai hitungan mentah tapi TIDAK masuk komposit — belum punya riwayat
untuk z-score, dan itu ditulis di berkasnya.

Yang TIDAK BISA, tiap satu dengan alasannya di `unavailable`: UCDP mewajibkan
token yang harus didaftarkan pemilik repo, IMF datamapper menjawab 403, World
Bank menjawab 400 berisi HTML, ReliefWeb butuh appname yang disetujui, UNHCR
menjawab 200 tapi nol baris untuk `coo=IDN` maupun `coa=IDN`.

Audit agen menemukan dua kerusakan kritis di kedua skrip pada hari yang sama
mereka ditulis, dan MEMBUKTIKANNYA, bukan menduga:

**`gdelt.json` bisa menyusut dari 8.166 event jadi 68 dengan exit 0, dan backtest
tetap LULUS.** `readExisting` menelan berkas rusak jadi `null`, lalu run enam jam
menimpa 45 hari riwayat. Lebih parah daripada padanannya di `ingest-idx.mjs`:
slice GDELT dialamati lewat stempel TERBIT, bukan tanggal peristiwa, jadi hari
yang hilang tidak bisa ditarik ulang dengan meminta hari itu. Sekarang berkas
tak terbaca ditolak (bukan dianggap kosong), dan hasil merge wajib superset dari
yang tersimpan di dalam retensi.

**`seismic_m45` bernama 7 hari tapi isinya 6.** FDSN membaca `endtime` tanpa jam
sebagai `T00:00:00`, jadi hari ini tidak pernah ikut — ember terakhir selalu nol
secara struktural, dibandingkan terhadap rata-rata 7 hari yang sesungguhnya.
Terbit 27 padahal 36, meleset 25%, dan tidak pernah error karena nol itu hitungan
yang sah. Memperbaiki `endtime` saja hanya menukar nol dengan hari yang baru
berjalan dua jam; serinya sekarang berakhir di hari UTC terakhir yang UTUH.
Komposit 39,3 -> 40,2.

Ditambah: `--hours --no-cache` dulu membuat `HOURS` jadi NaN, nol slice ditarik,
berkas tetap ditulis dengan stempel segar dan `slicesMissing: 0` — terbaca persis
seperti run sehat. Jendela 6 jam dulu menarik 25 slice (6,25 jam), `W.m1 = 21`
lagi di tempat baru. Hari yang cuma diwakili ekor backfill (0-2% peristiwanya)
dulu masuk `days[]` tanpa penanda dan membuat tebing 175x di tepi jendela ingest.
`windowMean` yang diterbitkan bukan mean yang dipakai z-nya. `windowDays: 90`
menggambarkan satu dari tiga komponen. `totalListed` OFAC kelebihan satu karena
byte 0x1A di ujung `sdn.csv`. Semuanya diperbaiki, dan tiap satu punya invariant
di backtest — yang sudah diuji memerahkan run, bukan sekadar ditulis.

**Belum divalidasi terhadap apa pun.** Tidak ada satu uji pun yang menunjukkan
komposit ini mendahului, mengikuti, atau menerangkan variabel pasar Indonesia.
Kedua berkas menyatakan itu di field `note`-nya sendiri, dan backtest menjaga
supaya komposit tidak pernah terbit saat nol komponen punya z-score.

**Layar RISK SUDAH DIHAPUS.** Ia menskor Indonesia atas nada konflik, gempa dan
sanksi lalu mengatakan sendiri di captionnya bahwa skornya boleh dibuang — layar
yang teksnya sendiri menyuruh mengabaikannya tidak layak satu tab. Penggantinya
`NEWS` (`src/components/analytics/NewsFeed.tsx`): berita realtime lima kantor
(WSJ, CNBC, Yahoo Finance, Investing.com, CNBC Indonesia) plus kalender ekonomi
mingguan. `ingest-risk.mjs` dan `risk.json` SENGAJA dibiarkan hidup — masih
dipakai `backtest.ts` dan `backtest-live.ts`, jadi mencabutnya berarti menyentuh
penjaga yang tidak sedang rusak.

**Penautan berita ke kode emiten harus KETAT.** Pencocokan longgar menandai
berita mode cepat Shein sebagai emiten FAST, dan "Bursa Asia Berguguran" sebagai
PADA — 65% feed jadi "tentang" emiten Indonesia. Banyak ticker IDX kebetulan kata
biasa (PADA, NAIK, UANG, FAST, EAST, RISE, LINK, NINE, BLUE). Aturannya sekarang:
ticker dicocokkan **case-sensitive** sebagai token huruf besar berdiri sendiri,
dan nama perusahaan harus muncul **utuh sebagai frasa**. Turun ke 19 dari 120,
dan tiap satunya benar. Akronim huruf besar yang bertabrakan masih bisa lolos —
CASA dalam istilah perbankan salah satunya.

**Dua bug lama ketahuan saat menguji layar itu di 375px, dan keduanya di luar
layar barunya:**

1. `hint` RISK tidak memuat kata "risiko" — kata paling jelas yang akan diketik
   orang Indonesia untuk mencarinya. `searchFunctions` mencocokkan ke `hint`,
   jadi mengetik `risiko` mengembalikan kosong. Diuji satu per satu terhadap
   sembilan kata sekarang.
2. **Jaminan "tab aktif digeser ke dalam pandangan" di `Segmented` belum pernah
   benar-benar bekerja.** Baris tab memakai `snap-x`, dan `scrollBy` dengan
   `behavior: 'smooth'` pada wadah scroll-snap DIABAIKAN diam-diam: diukur di
   bundel yang benar-benar dijalankan, smooth memindahkan `scrollLeft` dari 4 ke
   4 sementara `auto` pada elemen yang sama di tik yang sama memindahkannya ke
   175. Tidak pernah kelihatan sampai barisnya tumbuh jadi delapan tab dan yang
   aktif mendarat 260px di luar tepi kanan. Sekarang instan. Ini menyentuh SEMUA
   layar bertab, bukan cuma RISK. Pencarian tombol aktifnya juga tidak lagi
   lewat ref yang berpindah antar-sibling, melainkan lewat `aria-current`.

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
- **Pangsa produksi/HHI untuk CPO, nikel, dan silika belum punya sumber gratis
  yang ditemukan.** Sempat tersedia lewat MCP WorldMonitor (`get_mineral_production`)
  sebelum langganan itu dibatalkan; belum ada gantinya. Ini struktur pasar
  (siapa menambang, siapa memurnikan, pangsa negara), bukan seri harga harian —
  dua lubang yang berbeda, dan keduanya masih terbuka.
- **CPO dan nikel tidak ada di lapisan makro, dan itu lubang yang nyata.**
  Kontrak `FCPO=F` dan `NI=F` sama-sama dijawab "symbol may be delisted" oleh
  Yahoo, padahal Indonesia produsen terbesar dunia untuk keduanya. Acuan batu
  bara yang ada cuma API2 Eropa, bukan Newcastle yang dipakai kontrak ekspor
  kita. Tidak ada satu pun yang diganti proksi — korelasi dari barang pengganti
  akan terbaca sebagai bukti padahal bukan. Kalau ketemu sumber harian yang
  gratis dan sah untuk ketiganya, itu penambahan paling berharga berikutnya.
- **Tidak ada data konflik/geopolitik DI LAYAR, tapi sumbernya ternyata ada.**
  Alert di layar MAP adalah bencana alam dan penutupan pelabuhan dari IMF
  PortWatch — jangan menamai ulang itu jadi "geopolitik"; layarnya sengaja
  menyatakan bedanya. Catatan lama di sini bilang GDELT tidak bisa dijangkau dan
  itu SETENGAH benar: yang buntu host API-nya (`api.gdeltproject.org` menjawab
  HTTP 000, diuji ulang dari mesin rumah 2026-08-29 dan masih 000). Host
  BERKAS-nya hidup — `data.gdeltproject.org/gdeltv2/` menjawab 200, dengan
  `lastupdate.txt` plus berkas export/mentions/gkg tiap 15 menit, ~1.000 event
  per slot dan 61 kolom skema Events 2.0. Sampel 12 slot sepanjang 24 jam
  memuat cerita korporasi Indonesia yang relevan (mis. Eagle High Plantations
  vs FELDA lewat tempo.co). Jadi lapisan berita/geopolitik BISA dibangun sendiri
  dan gratis, lewat berkas mentah bukan lewat API. Penyaring per-negara harus
  baca kolom (`Actor1CountryCode`, `Actor2CountryCode`, `ActionGeo_CountryCode`) —
  grep `IDN` saja menghasilkan positif palsu.
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
- **Ingest resmi IDX sekarang HANYA bisa dari mesin lokal.** GitHub Actions
  dijawab HTML/Cloudflare, sesi cloud ditolak di gerbang egress-nya sendiri.
  Selama itu berlaku, pipeline ini punya satu langkah manual yang tidak bisa
  dihilangkan, dan `refresh-data.yml` akan MERAH tiap kali slot EOD jalan — itu
  disengaja, bukan workflow yang rusak. Empat sesi (25–28 Agu) masih menunggu
  ditarik dari rumah.
- **Cron Actions ternyata tidak berhenti — ia MELESET JAUH dari slotnya.**
  Diperiksa 2026-08-29 lewat REST API: 11 run sejak repo dibuat, dan run
  terjadwal 28 Agu menyala pukul 17:20, 20:56, 20:58, dan 21:28 UTC — 5,5 sampai
  10 jam setelah slot mana pun yang mungkin cocok, dengan dua run mendarat
  berjarak 2 menit padahal cron-nya berjarak 30 menit. Itu terbaca seperti
  GitHub menguras antrean yang menumpuk, bukan menghormati slot. Datanya tetap
  benar (run #8 mengejar seri resmi ke 2026-08-28, `pendingSessions` nol), jadi
  yang rusak jadwalnya, bukan hasilnya. Menambah slot cron tidak akan menolong
  gejala seperti ini; kalau polanya berlanjut, jawabannya memindahkan penjadwalan
  keluar dari GitHub.
- **Catatan lama "cron berhenti total" di bawah ini ditulis sebelum bukti itu ada.** Tujuh slot berturut-turut
  tidak menghasilkan run apa pun antara 26 dan 28 Agu, `state` workflow tetap
  `active`, tidak ada run gagal. Saya tidak punya bukti penyebabnya, jadi tidak
  saya tebak — yang dikerjakan justru membuat akibatnya kelihatan di layar
  ("Seri resmi tertinggal N sesi") daripada menambah slot cron asal-asalan.
  Kalau sesi berikutnya melihat pola yang sama berlanjut, itu sinyal untuk
  memindahkan penjadwalan keluar dari GitHub, bukan menambah cron lagi.

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
npm test                 # 34/34  (16 DCF + 18 atribusi/konglomerasi)
npm run backtest -- 5    # ~396k pemeriksaan, nol temuan (90.774 per pass)
npm run picks:record     # catat pick sesi ini (menolak kalau pasar masih buka)
npm run picks:report     # nilai jurnal tanpa mencatat apa pun
npm run backtest:live    # 50 pemeriksaan terhadap deployment, nol temuan
```

Backtest juga menyapu NAVIGASI sekarang, 90 pemeriksaan di luar loop pass: tiap
kode mnemonic unik, tiap kode membuka dirinya sendiri (penjaga tabrakan CN/CNG,
yang satu keystroke dari mengirim `CN` ke layar konglomerasi selamanya), tiap
layar bertab menyebut sub-tab-nya, dan tanda NEW terbukti padam sendiri setelah
400 hari. Layar yang tidak bisa dijangkau sama dengan layar yang tidak pernah
di-deploy, dan tidak ada pemeriksaan lain di sini yang bisa melihatnya.

`backtest:live` yang paling sering menangkap masalah nyata, karena ia satu-satunya
yang tahu apa yang benar-benar disajikan ke pengunjung: berkas data yang tidak
ikut ter-deploy, data yang basi karena ingest terjadwal berhenti, fungsi chat yang
mendekati batas waktu, dan chatbot yang diam-diam jatuh ke parser browser.

## Kondisi saat serah terima ini ditulis

Commit `37067fe` sudah di-push ke `main` dan Vercel menyajikannya — screener
tiga setup, jurnal winrate, ringkasan AI keterbukaan informasi, perbaikan ingest.
Diverifikasi langsung di situs live: `/api/picks` dan `/api/disclosure-summary`
menjawab 404 di sana persis seperti rancangannya, dan kedua layar menampilkan
itu sebagai keterangan, bukan kegagalan.

**Yang BELUM ter-commit: halaman depan yang ditulis ulang** (`LandingPage.tsx`)
plus invarian cakupannya di `backtest.ts`. Verifikasi lokal hijau: `tsc` bersih,
18/18 uji, backtest **237.812 pemeriksaan nol temuan atas 3 pass**,
`strategy:lab` 365 lolos, build produksi sukses, dicek di 375px maupun desktop.

Yang berubah di sesi terakhir:
- **Halaman depan ditulis ulang.** Grid datar 11 kartu diganti struktur
  bertahap: hero, empat angka, tiga blok "kenapa dibikin", perbandingan dua
  kolom, band papan strategi, lalu 18 layar dikelompokkan jadi empat pekerjaan.
  Referensinya halaman jualan kursus yang dikirim pemilik repo — yang diambil
  PACING-nya, bukan funnel-nya: tidak ada angka keberhasilan, harga, atau
  testimoni, karena tidak ada satu pun yang bisa didukung di sini.
- **Halaman depan sekarang dijaga backtest.** Tiap kartu wajib menunjuk layar
  yang ada di registri, tiap layar di registri wajib punya kartu, dan jumlah
  layar tidak boleh ditulis manual. Diuji memerahkan run dengan menyuntikkan
  dua bug lamanya sekaligus.
- **Bahasa halaman depan dikembalikan ke tongkrongan.** Draf pertama saya justru
  lebih formal daripada halaman yang diganti — lihat entri "AI slop" di bawah.

- **Screener punya tiga setup**, bukan satu (`ScreenerMode`): `momentum` (aturan
  lama, tidak berubah satu byte pun), `pullback`/Antre Beli (di atas MA200,
  jatuh di bawah MA20, diskon 8–35% dari puncak 60 sesi), `laggard`/Tertinggal
  (indeks acuannya ≥ +10% dalam 60 sesi, sahamnya ≤ +2%, tidak turun >25%).
  Tiap mode punya corong, kolom, ambang yang bisa disetel, penjelasan kegagalan
  per emiten, dan fungsi conviction-nya sendiri.
- **Watchlist tahap 3 membaca ketiganya.** Skor tape mengambil yang terbaik di
  antara tiga setup, dan cabang momentumnya identik dengan sebelumnya — jadi
  tidak ada kandidat lama yang bisa TURUN skornya, tahap itu hanya bisa
  menemukan lebih banyak. Kandidat diberi label setup yang dipenuhinya, dan
  peringatan "tidak lolos screener" hanya muncul kalau tidak satu pun setup
  terpenuhi.
- **Papan strategi menguji setup baru itu**, dan menerbitkan kegagalannya —
  lihat entri "membeli kelemahan" di atas. 12 trigger × 67 kombinasi filter × 72
  exit = 57.888 rule set, 207 lolos.
- **Backtest menyapu ketiga mode** dan menghitung ulang aritmetika tiap aturan
  dari angka yang dicetak barisnya sendiri. Invariannya sudah DIUJI memerahkan
  run: membalik tanda `gapToIndexPp` menghasilkan 3.371 temuan.
- **Daftar kata yang wajib menemukan layarnya** di backtest — yang langsung
  menangkap `konglomerasi` → CNG yang selama ini kosong.
- **Suara Fish Audio dipatok** ke satu voice id, plus jejak kegagalan HTTP.
- **Conviction momentum berhenti mengurutkan keterlambatan** — dua suku yang
  membayar makin telat diganti `freshness` + `room`. Aturan kerasnya tidak
  berubah, jadi emiten yang lolos tetap 227; yang berubah urutannya.
- **Kolom "Sudah naik" dan "Regangan"** di tiap baris screener, plus dua urutan
  baru (paling baru menembus, paling belum meregang).
- **Papan strategi mengukur keterlambatan tiap trigger** (`avgRunupAtEntry`),
  menambah 3 trigger yang bisa menyala sebelum harga bergerak dan 2 filter
  anti-telat. 15 trigger × 92 kombinasi × 72 exit = 99.360 rule set, 361 lolos.
- **Suara berbahasa Inggris** lewat baris bertanda 🔊 di tiap balasan; aturannya
  di `~/.claude/CLAUDE.md`, kalimat alert diterjemahkan langsung di sumbernya.
- **Ingest intraday: satu retry dengan sesi Yahoo BARU** sebelum jatuh ke
  fallback Google, harga `<= 0` ditolak, dan kuotasi berstempel lama yang
  harganya berbeda dari penutupan resmi dibuang. 960/962 hari ini — dua yang
  hilang (SCPI, FASW) memang tidak punya harga hari ini.
- **Tes overlay live tidak lagi membagi dengan penyebut yang menuju nol**;
  rasio ketatnya utuh dan terbukti masih menggigit.
- **Ringkasan AI keterbukaan informasi** (`CN`): klik satu pengajuan, PDF-nya
  ditarik dari IDX lewat curl dan dibaca Claude Haiku sebagai document block.
  Di-cache per path PDF; rutenya POST supaya tidak bisa dipicu prefetch.
- **Jurnal Pick** (`JRN`) — sepuluh teratas tiap layar dicatat penjadwal tiap
  `post-close` ke `.data/picks.json`, dinilai maju 63 sesi dengan stop/target
  ATR, plus laporan Excel 4 sheet (Ringkasan, Detail, Per Bulan, Metode).
  Pencatatan dimulai 2026-09-02.

Yang berubah di sesi sebelumnya, singkat:
- Screener & Watchlist default **5 teratas** menurut conviction, bisa dibuka penuh
- **Trade setup** entry/stop/target berbasis ATR di tiap baris
- **Papan strategi** out-of-sample: 21.312 rule set, 101 lolos, WR uji 65-73%
- **Portofolio** (`PORT`) — posisi sendiri, tersimpan di localStorage, TIDAK
  pernah menyuruh menjual; hanya menaruh fakta mekanis di sebelah harga beli
- **Tanker & Freight** (`TNKR`) dengan peta selat sebagai tampilan di dalamnya
- **Berita & Kalender** (`NEWS`) menggantikan Country Risk
- Broker Summary dihapus (pipeline `data:brokers` tetap hidup)
- Global Drivers dapat mode **per saham** lewat `linkagesForEmiten`
- Suara Fish Audio + sleep mode + laporan bangun
- Portofolio kini tersimpan di `.data/portfolio.json` lewat `/api/portfolio`,
  bertahan antar sesi; localStorage tinggal cadangan situs terdeploy
- Layanan bind ke `127.0.0.1` saja (dulu semua interface)
- Tier mingguan CI dijadwalkan dua kali: Sabtu DAN Minggu

`backtest:live` BELUM dijalankan terhadap deployment sesi ini — jalankan dari
mesin lokal sebelum mengandalkan apa pun tentang situs live. Untuk sesi terakhir
ia belum relevan: perubahannya belum di-push, jadi yang disajikan situs live
masih bundel lama.

Yang sengaja ditinggalkan terbuka:
- **Kanal "ngabarin terus" belum diputuskan.** Pemilik repo mengirim video agen
  AI yang MENELEPON penggunanya di tengah nyetir, dan bilang butuh yang seperti
  itu untuk update screener. Yang sudah ada: digest email 12:05 dan 16:20 WIB
  (`emailAlert.ts`) plus suara Fish Audio di mesin lokal. Yang tidak bisa: Claude
  tidak punya akses jaringan telepon — panggilan butuh Twilio Voice atau
  sejenisnya, berbayar per menit. Urutan yang disarankan sebelum membangun apa
  pun: PERIKSA DULU apakah `SMTP_*` di `.env` sudah diisi, karena alert email
  yang tidak pernah sampai jauh lebih mungkin kurang konfigurasi daripada kurang
  fitur. Kalau butuh kanal baru, Telegram Bot API gratis dan cukup ~30 baris;
  telepon hanya masuk akal untuk kegagalan mendesak (ingest IDX mati), bukan
  untuk laporan screener harian.

- **Mode antre beli dan tertinggal TIDAK punya aturan mekanis terbukti di
  belakangnya.** Keduanya lolos sebagai penyaring riset — corongnya jujur, tiap
  penolakan bisa dijelaskan — tetapi papan strategi menolak semua trigger yang
  membeli kelemahan pada gerbang expectancy. Jangan menutup jarak itu dengan
  melonggarkan gerbang sampai angkanya bagus; kalau setup ini mau dibuktikan,
  yang dibutuhkan adalah aturan exit yang berbeda (target lebih lebar, hold
  lebih panjang, atau exit berbasis reclaim MA20 alih-alih ATR), bukan ambang
  yang lebih longgar.
- **Ambang keterlambatan (6 sesi, 3 ATR, 25% runup, 1,5 ATR) juga konvensi.**
  Dipilih supaya terbaca, bukan di-fit. Yang PUNYA bukti out-of-sample cuma
  `earlyRunup` dan `notExtended` sebagai filter papan strategi; ambang yang
  dipakai suku `freshness`/`room` di conviction belum diuji terhadap apa pun,
  dan conviction memang bukan gerbang — ia hanya mengurutkan yang sudah lolos.
- **`maxDeclinePercent` 25% dan pita diskon 8-35% adalah konvensi, bukan hasil
  optimasi.** Dipilih supaya terbaca dan bisa disetel dari layar Ambang. Tidak
  ada satu pun angka di sana yang di-fit ke data ini, dan itu disengaja —
  mem-fit-nya akan membuat corongnya terlihat lebih pintar tanpa menjadi lebih
  benar.

- **Tier mingguan CI belum terbukti pulih.** Sudah ada timeout per langkah DAN
  percobaan kedua hari Minggu (`0 1 * * 0`), tapi belum ada satu pun run nyata
  yang membuktikannya — perbaikannya struktural, bukan terverifikasi. Cara
  membuktikan tanpa menunggu akhir pekan: Actions → Run workflow → centang
  `full_refresh`, itu menjalankan persis jalur mingguan yang dulu dibatalkan.
  Sampai run itu hijau, anggap ownership/quotes/brokers bergantung pada
  penjadwal lokal.
- **AIS kapal tidak ada dan tidak akan ada tanpa langganan.** Panel tanker
  memakai proksi (pemilik tanker tercatat), dan mengatakannya terang-terangan.
  Korelasi BULL ke proksi crude terukur **0,02 dari 469 sesi** — praktis tidak
  nyambung, dan itu temuan yang sah, bukan kegagalan.
- **Bandarmology belum bisa di-backtest.** `RawSeries.f` (jumlah transaksi) baru
  mulai direkam, jadi historisnya NaN. Dipakai live saja sampai cukup sesi
  terkumpul.

---

Yang ingin saya kerjakan berikutnya: [TULIS DI SINI]
```
