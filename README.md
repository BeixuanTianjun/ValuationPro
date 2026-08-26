# ValuationPro: LBO & DCF Institutional Financial Modeling Platform

Platform pemodelan finansial komprehensif untuk analisis **Discounted Cash Flow (DCF)** dan **Leveraged Buyout (LBO)**, dilengkapi dengan visualisasi interaktif, 2D Sensitivity Matrix heatmaps, studi kasus preset (Tech SaaS, Manufacturing, Healthcare), dan **Export ke Microsoft Excel (.xlsx)** berstandar Wall Street / Private Equity dengan formula aktif dan cell color-coding.

---

## Fitur Utama

### 1. DCF Valuation Module
- **WACC Engine**: Perhitungan Cost of Equity (CAPM), After-Tax Cost of Debt, Capital Structure Weighting, serta opsi manual override.
- **Unlevered Free Cash Flow (UFCF) Schedule**: Proyeksi Revenue $\to$ EBITDA $\to$ EBIT $\to$ NOPAT $\to$ +D&A $\to$ -CapEx $\to$ -ΔNWC $\to$ UFCF dengan diskonto Mid-Year convention.
- **Dual Terminal Value Method**:
  - **Gordon Growth Model** ($TV = \frac{UFCF_{n+1}}{WACC - g}$)
  - **Exit Multiple Method** ($TV = EBITDA_n \times \text{Multiple}$)
- **Valuation Bridge**: Implied Enterprise Value $\to$ Net Debt Adjustments $\to$ Implied Equity Value $\to$ Target Share Price vs Current Market Price (Upside/Downside %).
- **2D Sensitivity Matrix & Visual Charts**: Heatmap WACC vs Terminal Growth ($g$) dan WACC vs Exit Multiple.

### 2. LBO Transaction & Returns Module
- **Sources & Uses of Funds**: Senior Secured Debt (Tranche A), Subordinated/Mezzanine Debt (Tranche B), Advisory Fees, Financing Fees, Sponsor Equity (Plug) dengan verifikasi otomatis Balance.
- **Debt Paydown Schedule (Waterfall)**: Proyeksi operasional, beban bunga berjenjang per tranche, amortisasi wajib, excess cash sweep untuk pelunasan hutang senior lebih cepat, serta pelacakan rasio Leverage (Net Debt / EBITDA) & Coverage (EBITDA / Interest).
- **Sponsor Returns Engine**:
  - **Sponsor IRR (% per annum)** via Newton-Raphson numerical solver
  - **Multiple on Invested Capital (MoIC / Cash-on-Cash)**
  - **Returns Attribution**: Dekomposisi kontribusi nilai dari EBITDA Growth, Multiple Expansion, dan Debt Paydown.
- **Returns Sensitivity Matrix**: Entry Multiple vs Exit Multiple (IRR & MoIC), serta Leverage vs Exit Multiple.

### 3. Wall Street-Standard Excel Export (.xlsx)
- Export multi-sheet workbook (`DCF Model`, `LBO Model`) dengan format profesional Investment Banking:
  - Header Biru Navy (`#1B365D`) dengan teks tebal putih
  - Font Biru (`#002060`) untuk input & asumsi
  - Font Hitam (`#000000`) untuk formula kalkulasi
  - Format angka standar: Currency `$#,##0.0`, Persentase `0.0%`, Multiples `0.0x`
  - Seluruh formula spreadsheet aktif dan dapat diedit langsung di Microsoft Excel.

---

## Cara Menjalankan Aplikasi

1. Buka terminal di folder project:
   ```bash
   cd "C:\Users\MIchael ROG\.gemini\antigravity\scratch\financial-modeling-lbo-dcf"
   ```

2. Jalankan development server:
   ```bash
   npm run dev
   ```

3. Buka browser di URL yang muncul di terminal (biasanya `http://localhost:5173`).