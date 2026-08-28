# ValuationPro

Terminal pasar modal Indonesia — basis data seluruh emiten IDX, penyaring alpha
harian, alat analitik ala Bloomberg, dan model DCF/LBO institusional.

**Live:** https://valuation-pro-lake.vercel.app

## Isi

- **962 emiten tercatat** dengan sektor IDX-IC, sub-industri, likuiditas, dan
  arus dana asing — ditarik langsung dari API IDX, bukan agregator.
- **Stock Screener** dengan tiga aturan keras — di atas MA3 dan MA5, volume di
  atas 1 juta lembar, nilai transaksi di atas Rp 1 miliar. Tiap emiten lolos
  atau tidak, dan ada kotak "kenapa emiten saya tidak lolos" yang menunjukkan
  aturan mana yang gagal.
- **Stock Watchlist mingguan & bulanan** dengan alur empat tahap: narasi
  (keterbukaan informasi IDX + tema kebijakan terkurasi) → rotasi konglomerasi →
  price action dan ukuran tiket → chart TradingView.
- **Keterbukaan Informasi (CN)** — arsip 45 hari pengajuan resmi emiten ke bursa,
  ~4.260 dokumen dari ~940 emiten, dikategorikan dari judulnya dan bisa disaring
  per kategori atau per emiten. Pengajuan rutin disembunyikan secara bawaan dan
  jumlahnya selalu disebut. Tiap baris menautkan PDF asli di idx.co.id: bobot
  kategori mengatakan "ini layak dibaca", tidak pernah "ini kabar baik".
- **Leaders & Laggards** — kontribusi poin indeks per emiten, dihitung dari
  bobot free-float resmi IDX. Rekonsiliasi dengan IHSG sampai 0,001 poin.
- **Rotasi konglomerasi** — 31 grup pengendali, termasuk klaster BUMN, dengan
  papan peringkat "siapa yang sedang memimpin" dan pengukuran apakah anggota satu
  grup memang bergerak bersama sebelum menyebut sesuatu sebagai rotasi.
- **Mutual Fund Tracker** — register kepemilikan KSEI per emiten: reksa dana,
  asuransi, dana pensiun, bank dan yayasan, dipisah lokal dan asing, 24 bulan ke
  belakang. Dua garis institusi versus ritel; jaraknya melebar ketika barang
  berpindah dari individu ke pengelola dana.
- **Valuasi otomatis** — DCF dijalankan atas seluruh emiten berlaporan keuangan,
  bank dan asuransi dikecualikan karena UFCF tidak menggambarkan mereka.
- **Broker flow** — struktur ritel versus institusi dari ukuran tiket rata-rata.
- **Chatbot pencari emiten** berbahasa Indonesia; berfungsi penuh tanpa API key.
- **Tata letak responsif** — terminal yang sama di layar 360px dan di monitor
  lebar; tidak ada halaman yang menggeser ke samping di ukuran mana pun.
- **Model DCF & LBO** dengan pemeriksaan asumsi yang ditampilkan terbuka.

## Mulai

```bash
npm install
npm run data:all     # bangun database IDX, sekali saja
npm run auto         # layanan + aplikasi di http://localhost:8787
```

## Dokumentasi

| Berkas | Isi |
|---|---|
| [SETUP.md](SETUP.md) | Menjalankan, jadwal otomatis, alert email, akun |
| [DEPLOY.md](DEPLOY.md) | Deploy Vercel + GitHub Actions, dan batasannya |
| [DATA_PIPELINE.md](DATA_PIPELINE.md) | Sumber data dan catatan teknis penting |
| [HANDOVER.md](HANDOVER.md) | Konteks lengkap untuk melanjutkan di sesi baru |

## Prinsip

Setiap angka bisa ditelusuri ke endpoint sumbernya. Ketika data tidak memadai,
aplikasi mengatakannya di layar alih-alih menutupinya.

**Ini alat riset, bukan rekomendasi investasi.**
