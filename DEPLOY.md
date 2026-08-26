# Deploy ke Vercel

## Ringkas: apa yang bisa dan tidak bisa

Vercel menjalankan **berkas statis dan fungsi serverless**. Tidak ada proses yang
hidup terus, tidak ada disk yang bisa ditulis, dan tidak ada `curl`. Tiga hal itu
justru fondasi layanan lokal aplikasi ini, jadi bagiannya harus dipisah.

| Bagian | Vercel | Alasan |
|---|---|---|
| Terminal (semua tab, chart, tabel) | **Jalan** | Murni di browser, membaca JSON statis |
| Screener, Leaders & Laggards, Rotasi Konglomerasi, Valuasi Otomatis, Broker Flow | **Jalan** | Dihitung di browser dari data yang sama |
| Model DCF & LBO, ekspor Excel | **Jalan** | Sepenuhnya klien |
| Chatbot (mesin lokal) | **Jalan** | Mesin query ikut ke bundel browser |
| Chatbot lapisan Claude | Tidak | Butuh backend pemegang API key |
| Refresh otomatis & harga live | Tidak | Butuh penjadwal yang hidup + tulis ke disk |
| Alert email | Tidak | Sama — tetapi lihat GitHub Actions di bawah |
| Login / signup | Tidak | Sesi di memori dan `users.json` tidak bertahan antar-invocation |

Ini sudah diuji, bukan diperkirakan: `dist/` disajikan tanpa API sama sekali dan
seluruh terminal tetap berfungsi. Baris status menampilkan **"Layanan otomatis
mati"** dan tombol Masuk disembunyikan — aplikasi menurunkan kemampuannya secara
jujur, bukan menampilkan tombol yang tidak akan bekerja.

## Arsitektur yang dipakai

```
GitHub Actions (cron)          GitHub repo              Vercel
  tarik data IDX + Yahoo  ──▶  commit public/data  ──▶  redeploy otomatis
  kirim digest email                                    sajikan terminal statis
```

GitHub Actions punya yang tidak dimiliki Vercel: `curl`, cron, dan waktu jalan
berbmenit-menit. Jadi pekerjaan yang tidak bisa dilakukan Vercel dikerjakan di
sana, hasilnya di-commit, dan Vercel otomatis men-deploy ulang.

Jadwalnya ada di `.github/workflows/refresh-data.yml` (waktu UTC, WIB = UTC+7):

| UTC | WIB | Pekerjaan |
|---|---|---|
| 05:05 Sen–Jum | 12:05 | Sesi I tutup → refresh harga + **kirim alert** |
| 09:20 Sen–Jum | 16:20 | Pasar tutup → refresh harga + **kirim alert** |
| 11:30 Sen–Jum | 18:30 | Tarik data resmi IDX (OHLC final + arus asing) |
| 01:00 Sabtu | 08:00 | Fundamental, rasio valuasi, aktivitas broker |

## Langkah

### 1. Push ke GitHub

```bash
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```

`.env` (berisi App Password Gmail Anda) dan `.data/` (hash kata sandi akun)
sudah ada di `.gitignore` dan tidak akan ikut. Periksa sendiri sebelum push:

```bash
git status --short | grep -E '\.env|\.data' || echo "aman"
```

### 2. Hubungkan ke Vercel

Import repo-nya di <https://vercel.com/new>. `vercel.json` sudah mengatur
build command, output directory, SPA rewrite, dan header cache — file data
`no-cache` supaya refresh langsung terlihat, aset ber-hash `immutable`.

Tidak ada environment variable yang perlu diisi di Vercel: tidak ada rahasia
yang dipakai di sisi klien.

### 3. Isi secrets untuk alert email

Di **Settings → Secrets and variables → Actions** pada repo GitHub, tambahkan:

| Secret | Isi |
|---|---|
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | alamat Gmail Anda |
| `SMTP_PASS` | App Password 16 huruf |
| `ALERT_EMAIL_FROM` | alamat Gmail Anda |
| `ALERT_EMAIL_TO` | tujuan alert |

Opsional, sebagai *variable* (bukan secret): `ALERT_STRATEGY`.

Uji tanpa menunggu jadwal lewat tab **Actions → Refresh data IDX → Run workflow**
dengan `send_alert` dicentang.

## Risiko yang belum bisa saya pastikan

**IDX mungkin memblokir runner GitHub.** Endpoint IDX ada di belakang Cloudflare
yang menilai sidik jari TLS dan reputasi IP. Dari koneksi rumah, `curl` lolos —
itu sudah terbukti. Dari IP datacenter Azure milik GitHub Actions, belum
teruji dan bisa saja ditolak.

Karena itu langkah IDX di workflow diberi `continue-on-error: true`. Kalau
diblokir, refresh harga dari Yahoo tetap berhasil dan terminal tetap ter-update;
yang tertinggal hanya arus dana asing dan OHLC resmi. Anda akan melihatnya
sebagai langkah kuning di tab Actions, bukan kegagalan diam-diam.

Kalau ternyata benar diblokir, jalankan `npm run data:refresh` di komputer Anda
lalu commit hasilnya — atau jalankan layanan lokal seperti biasa.

## Kalau butuh login dan alert yang benar-benar hidup

Vercel bukan tempatnya. Yang dibutuhkan adalah host dengan proses berjalan terus
dan disk permanen — Railway, Render, Fly.io, atau VPS biasa. Di sana
`npm run auto` berjalan apa adanya dan seluruh fitur aktif.

Cara termudah dan paling murah: **biarkan `npm run auto` jalan di komputer Anda**
untuk login, refresh manual, dan chatbot Claude, sementara Vercel menyajikan
terminal untuk diakses dari mana saja.
