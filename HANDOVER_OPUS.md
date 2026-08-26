# HANDOVER DOCUMENT & MASTER PROMPT FOR OPUS

Salin prompt di bawah ini dan tempelkan (paste) langsung ke chat Opus Anda untuk melanjutkan pengembangan tanpa kehilangan konteks.

---

```markdown
Halo Opus, saya ingin melanjutkan pengembangan project aplikasi finansial yang sudah saya bangun. Berikut adalah konteks lengkap arsitektur, kode, struktur file, dan logika finansial yang sudah ada:

### 1. INFORMASI UMUM & REPOSITORY
- **Nama Project**: ValuationPro (Institutional DCF & LBO Financial Modeling Suite + Emiten Statement Analyzer)
- **Lokasi Direktori Lokal**: `C:\Users\MIchael ROG\.gemini\antigravity\scratch\financial-modeling-lbo-dcf`
- **Tech Stack**:
  - Runtime & Bundler: Node.js v24 + Vite 6 + React 18 + TypeScript 5
  - Styling & UI: Tailwind CSS 3 + Lucide Icons + Radix/Tailwind Merge
  - Charts & Visuals: Recharts
  - Spreadsheet Engines: `exceljs` & `file-saver` (Wall Street Excel .xlsx exporter) + `xlsx` (SheetJS untuk multi-format file parser)

### 2. STRUKTUR DIREKTORI & FILE
```
financial-modeling-lbo-dcf/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
├── src/
│   ├── main.tsx
│   ├── App.tsx                        # Master Workspace, state sync, tabs switcher, KPI banner
│   ├── types/
│   │   ├── common.ts                  # SensitivityCell, SensitivityMatrix, DealPreset
│   │   ├── dcf.ts                     # DcfAssumptions, WaccBreakdown, UfcfYearData, DcfValuationSummary
│   │   ├── lbo.ts                     # LboAssumptions, SourcesAndUses, DebtTrancheSchedule, LboReturnsSummary
│   │   └── statements.ts              # HistoricalYearData, ParsedFinancialReport, CalibratedModelParams
│   ├── models/
│   │   ├── dcfEngine.ts               # Core math: CAPM WACC, 5-yr UFCF, Gordon Growth & Exit Multiple TV, 2D Sensitivity
│   │   ├── lboEngine.ts               # Core math: Sources & Uses, Multi-Tranche Debt Waterfall, Cash Sweep, Newton-Raphson IRR, MoIC, Sensitivity
│   │   ├── statementParser.ts         # Smart bilingual parser (Indonesian & English accounting aliases for .xlsx/.xls/.csv/.json/text)
│   │   ├── statementCalibrator.ts     # Historical CAGR, average margins, CapEx %, NWC %, auto-calibrate to DCF & LBO
│   │   └── excelExporter.ts           # Wall Street standard Excel .xlsx builder (live dynamic formulas, Navy headers, Blue input font, Black formula font)
│   ├── presets/
│   │   ├── deals.ts                   # Deal presets (CloudScale B2B SaaS, Apex Industrial, OmniHealth Healthcare)
│   │   └── emitenPresets.ts           # Real emiten datasets (PT Telkom Indonesia TLKM.JK, PT Astra International ASII.JK, Apple Inc. AAPL)
│   ├── components/
│   │   ├── layout/
│   │   │   └── Header.tsx             # Navbar, mode switcher (DCF / LBO / Statement), Import modal button, Preset selector, Export .xlsx
│   │   ├── common/
│   │   │   ├── NumberInput.tsx        # Formatted input (currency, percentage, multiple, basis points)
│   │   │   ├── MetricCard.tsx         # Polished KPI card with badges and variant styling
│   │   │   └── HeatmapTable.tsx       # 2D Sensitivity Matrix with dynamic color gradients and base case highlight
│   │   ├── dcf/
│   │   │   ├── DcfAssumptions.tsx     # Inputs: market data, operating forecast, WACC settings
│   │   │   ├── WaccCalculator.tsx     # Visual CAPM cost of equity, after-tax cost of debt, capital structure bar
│   │   │   ├── CashFlowTable.tsx      # Multi-year UFCF schedule (Revenue -> NOPAT -> +D&A -> -CapEx -> -ΔNWC -> UFCF -> PV)
│   │   │   ├── ValuationBridge.tsx    # EV to Equity Value waterfall, Implied Share Price vs Market Price
│   │   │   └── DcfSensitivity.tsx     # 2D WACC vs g / Exit Multiple heatmaps & UFCF Recharts bar chart
│   │   ├── lbo/
│   │   │   ├── LboAssumptions.tsx     # Entry & Exit multiples, tranches, interest rates, holding period slider
│   │   │   ├── SourcesAndUses.tsx     # Senior debt, sub debt, sponsor equity plug with balance check
│   │   │   ├── DebtWaterfall.tsx      # Debt paydown schedule, mandatory amort, excess cash sweep, leverage & coverage ratios
│   │   │   ├── ReturnsSummary.tsx     # Sponsor IRR & MoIC, returns attribution (EBITDA growth vs Multiple expansion vs Debt paydown)
│   │   │   └── LboSensitivity.tsx     # Entry vs Exit multiple returns matrix, leverage vs IRR heatmap & capital structure area chart
│   │   └── importer/
│   │       ├── FinancialReportImporter.tsx # Modal dialog for file upload (.xlsx/.csv/.json), paste raw text, and template downloader
│   │       └── StatementPreviewTable.tsx   # Parsed 3-Statement schedule preview, historical statistics, and "Apply to Models" trigger
│   └── utils/
│       ├── formatters.ts              # Currency, percentage, multiple, number formatting
│       └── financialMath.ts           # Robust Newton-Raphson + Bisection IRR solver, NPV calculations
```

### 3. FITUR UTAMA YANG SUDAH SELESAI & DIVERIFIKASI
1. **DCF Valuation Module**:
   - Dynamic WACC ($K_e = R_f + \beta \times ERP + \text{Size Premium}$, $K_d \times (1-t)$, capital weighting).
   - 5-year discrete Unlevered Free Cash Flow (UFCF) schedule dengan Mid-Year convention discounting.
   - Dual Terminal Value: **Gordon Growth Model** & **Exit Multiple Method**.
   - Valuation Bridge: Enterprise Value $\to$ Cash/Debt Adjustments $\to$ Equity Value $\to$ Target Share Price vs Market Price.
   - 2D Sensitivity Heatmap (WACC vs Perpetual Growth $g$ dan WACC vs Exit Multiple).

2. **LBO Deal Modeling Module**:
   - Sources & Uses of Funds table (Senior Debt, Sub Debt, Advisory & Financing fees, Sponsor Equity Plug).
   - Multi-Tranche Debt Waterfall: Senior & Subordinated debt amort, Cash sweep of excess cash flow (CFADS), ending debt, net debt, leverage ratio & interest coverage ratio.
   - Returns Solver: **Sponsor IRR (% p.a.)** dan **MoIC / Cash-on-Cash multiple**.
   - Value Creation Drivers Attribution (EBITDA growth vs Multiple expansion vs Deleveraging).
   - 2D Returns Sensitivity Matrix (Entry vs Exit multiple for IRR & MoIC, Senior Leverage vs Exit Multiple).

3. **Smart Bilingual Financial Statement Importer**:
   - Upload file spreadsheet (`.xlsx`, `.xls`), CSV, JSON, atau Paste teks mentah laporan keuangan.
   - Regex/Fuzzy dictionary mengenali pos akuntansi Indonesia & Inggris (*Pendapatan Usaha, Laba Bruto, Laba Usaha/EBIT, EBITDA, Laba Bersih, D&A, CapEx, Kas, Utang Bank, Jumlah Saham, Harga Saham*).
   - Auto-Calibrator: Menghitung historical CAGR 3–5 tahun, rata-rata margin, CapEx %, NWC %, lalu secara otomatis mengkalibrasi seluruh parameter model DCF & LBO.
   - Download template Excel `.xlsx` standar.
   - Preset emiten nyata: TLKM (Telkom), ASII (Astra), AAPL (Apple).

4. **Wall Street Standard Excel (.xlsx) Export**:
   - Multi-sheet workbook (`DCF Model`, `LBO Model`) dengan Navy headers (`#1B365D`), font biru untuk input/asumsi, font hitam untuk formula, format mata uang `$#,##0.0`, dan formula aktif (`=SUM`, `=NPV`, `=IRR`, dsb).

5. **Status Build & Testing**:
   - `npm run build` status: **PASSED (0 TypeScript errors)**.
   - Unit tests finansial & parser: **PASSED**.

---

Tolong bantu saya untuk melanjutkan pengembangan fitur berikutnya. Saya ingin mendiskusikan / mengimplementasikan fitur tambahan berikut:
[TULISKAN FITUR ATAU PERTANYAAN YANG INGIN ANDA LANJUTKAN DI SINI, MISALNYA:
- Menambahkan Analisis Valuasi Komparatif (Trading Comps / Multiples Peer Group)
- Menambahkan Fitur PDF OCR / Table Extraction untuk Laporan Keuangan PDF
- Menambahkan Simulasi Monte Carlo untuk Analisis Probabilitas DCF & LBO
- Menambahkan Export Pitch Deck / PDF Report
- Fitur lainnya...]
```