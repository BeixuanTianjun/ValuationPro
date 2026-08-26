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
harian, alat analitik ala Bloomberg, dan model DCF/LBO institusional.

- **Lokal**: `C:\Users\MIchael ROG\.gemini\antigravity\scratch\financial-modeling-lbo-dcf`
- **Repo**: https://github.com/BeixuanTianjun/ValuationPro (publik)
- **Live**: https://valuation-pro-lake.vercel.app
- **Stack**: Vite 6 + React 18 + TS 5 + Tailwind 3 + Recharts, layanan Node lokal
- Seluruh UI berbahasa Indonesia; komentar kode berbahasa Inggris.

## Kondisi data saat serah terima

962 emiten · 282 sesi (2025-06-23 → 2026-08-24) · 45 indeks · 24 hari libur
32 aksi korporasi · 648 emiten berlaporan keuangan · 962 kuotasi (100 pelapor
non-IDR) · 88 anggota bursa × 113 sesi · total 8,9 MB di `public/data/idx/`

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

## Peta kode

```
scripts/          ingest via curl: idx, intraday, quotes, fundamentals, brokers
src/models/       dcfEngine, lboEngine, factorEngine, alphaScreener,
                  indexAttribution, conglomerateRotation, autoValuation,
                  brokerFlow, emitenQueryEngine, idxCompanyBridge
src/data/         marketRepository (isomorfik: browser + Node), fundamentals,
                  conglomerates (kurasi), idxIndexCatalog, chatClient, authClient
src/server/       index (HTTP + scheduler), schedule (WIB), auth (scrypt),
                  emailAlert, chatApi, marketFromDisk, alertCli
src/components/   landing, layout, market, analytics, chat, auth, dcf, lbo
api/live.ts       fungsi Vercel: kutip 962 emiten dari Yahoo saat diminta
```

## Perintah

```bash
npm run auto            # layanan lokal + aplikasi di :8787
npm run dev             # Vite dev, proxy /api ke :8787
npm test                # 32 uji: guard rail DCF + rekonsiliasi atribusi indeks
npm run data:all        # bangun ulang seluruh database (~15 menit)
npm run data:intraday   # harga live semua emiten (~3 detik)
npm run alert:preview   # hitung pick tanpa mengirim email
```

## Yang masih terbuka

- **Keanggotaan grup konglomerasi dikurasi manual** di `src/data/conglomerates.ts`.
  IDX tidak menerbitkan peta pengendali. Angka *kohesi* di UI adalah bukti
  terukur apakah grup benar-benar bergerak bersama.
- **Konstituen LQ45/IDX30 adalah perkiraan** dari likuiditas 12 bulan digabung
  kapitalisasi. Tepat untuk blue chip, tidak identik dengan daftar resmi.
- **Rincian broker per saham tidak tersedia publik** — hanya total per anggota
  bursa. Yang ada di UI adalah struktur pelaku (ritel vs institusi dari ukuran
  tiket rata-rata).
- **Arus dana asing hanya EOD.** Refresh intraday membawa harga segar tetapi
  faktor asing tetap per sesi resmi terakhir; UI selalu menyebut tanggalnya.
- **Riwayat git tumbuh ~130 MB/bulan** karena `history.json` 6 MB ditulis ulang
  tiap tarik data resmi. Resep pemadatan ada di `DEPLOY.md`.
- **Login hanya jalan di layanan lokal.** Sesi di memori + `users.json` tidak
  bertahan di serverless.
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
