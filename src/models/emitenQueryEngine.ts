// Deterministic Indonesian-language query engine over the IDX emiten database.
//
// This replaces the manual financial-statement importer: instead of asking the
// user to paste a report, they ask for what they want ("saham batu bara PE di
// bawah 10 yang diakumulasi asing") and the engine screens all 962 emiten.
//
// It runs entirely offline with no API key. When an Anthropic key is present
// the server layer can route free-form questions through Claude, which calls
// back into THESE SAME functions as tools — so the numbers never diverge
// between the two paths.

import { Emiten, FactorSnapshot } from '../types/market';
import { MarketDatabase } from '../data/marketRepository';
import { FundamentalsDatabase } from '../data/fundamentalsRepository';

export interface EmitenQuery {
  /** Free-text match against code, name, industry and sub-industry. */
  text?: string;
  sectors?: string[];
  boards?: string[];
  minMarketCapIdrBn?: number;
  maxMarketCapIdrBn?: number;
  minLiquidityIdrBn?: number;
  minPrice?: number;
  maxPrice?: number;
  maxPe?: number;
  minPe?: number;
  maxPbv?: number;
  minDividendYield?: number;
  minReturn3m?: number;
  maxReturn3m?: number;
  minReturn12m?: number;
  maxReturn12m?: number;
  aboveSma200?: boolean;
  belowSma200?: boolean;
  minForeignNet20IdrBn?: number;
  maxForeignNet20IdrBn?: number;
  maxRsi?: number;
  minRsi?: number;
  hasStatements?: boolean;
  suitableForUfcf?: boolean;
  sortBy?: SortKey;
  sortDir?: 'asc' | 'desc';
  limit?: number;
}

export type SortKey =
  | 'marketCap'
  | 'liquidity'
  | 'return1m'
  | 'return3m'
  | 'return12m'
  | 'pe'
  | 'pbv'
  | 'dividendYield'
  | 'foreignNet20'
  | 'rsi';

export interface EmitenRow {
  emiten: Emiten;
  price: number;
  changePercent: number;
  marketCapIdrBn: number;
  liquidityIdrBn: number;
  return1m: number;
  return3m: number;
  return12m: number;
  priceVsSma200: number;
  rsi14: number;
  foreignNet20IdrBn: number;
  pe: number;
  pbv: number;
  dividendYield: number;
  hasStatements: boolean;
  suitableForUfcf: boolean;
}

export interface QueryResult {
  rows: EmitenRow[];
  totalMatched: number;
  appliedFilters: string[];
  sortLabel: string;
}

const NA = Number.NaN;

export function buildRow(
  e: Emiten,
  db: MarketDatabase,
  factors: Map<string, FactorSnapshot> | null,
  fundamentals: FundamentalsDatabase | null
): EmitenRow {
  const d = db.daily.get(e.code);
  const f = factors?.get(e.code);
  const q = fundamentals?.quotes?.quotes?.[e.code];
  const st = fundamentals?.fundamentals?.companies?.[e.code];

  return {
    emiten: e,
    price: d?.close || d?.prev || NA,
    changePercent: d ? d.change / 100 : NA,
    marketCapIdrBn: d ? d.marketCap / 1e9 : NA,
    liquidityIdrBn: f?.medianValue20IdrBn ?? NA,
    return1m: f?.return1m ?? NA,
    return3m: f?.return3m ?? NA,
    return12m: f?.return12m ?? NA,
    priceVsSma200: f?.priceVsSma200 ?? NA,
    rsi14: f?.rsi14 ?? NA,
    foreignNet20IdrBn: f?.foreignNet20IdrBn ?? NA,
    pe: q?.trailingPE ?? NA,
    pbv: q?.priceToBook ?? NA,
    dividendYield: q?.dividendYield ?? NA,
    hasStatements: !!st,
    suitableForUfcf: st?.quality?.suitableForUfcf ?? false,
  };
}

const SORT_LABELS: Record<SortKey, string> = {
  marketCap: 'kapitalisasi pasar',
  liquidity: 'likuiditas',
  return1m: 'return 1 bulan',
  return3m: 'return 3 bulan',
  return12m: 'return 12 bulan',
  pe: 'P/E',
  pbv: 'P/BV',
  dividendYield: 'dividend yield',
  foreignNet20: 'net beli asing 20 hari',
  rsi: 'RSI',
};

const SORT_ACCESSORS: Record<SortKey, (r: EmitenRow) => number> = {
  marketCap: (r) => r.marketCapIdrBn,
  liquidity: (r) => r.liquidityIdrBn,
  return1m: (r) => r.return1m,
  return3m: (r) => r.return3m,
  return12m: (r) => r.return12m,
  pe: (r) => r.pe,
  pbv: (r) => r.pbv,
  dividendYield: (r) => r.dividendYield,
  foreignNet20: (r) => r.foreignNet20IdrBn,
  rsi: (r) => r.rsi14,
};

export function queryEmiten(
  db: MarketDatabase,
  factors: Map<string, FactorSnapshot> | null,
  fundamentals: FundamentalsDatabase | null,
  query: EmitenQuery
): QueryResult {
  const applied: string[] = [];
  const note = (s: string) => applied.push(s);

  const text = (query.text || '').trim().toUpperCase();
  if (text) note(`kata kunci "${query.text}"`);
  if (query.sectors?.length) note(`sektor ${query.sectors.join(', ')}`);
  if (query.boards?.length) note(`papan ${query.boards.join(', ')}`);
  if (query.minMarketCapIdrBn) note(`kapitalisasi ≥ Rp ${query.minMarketCapIdrBn} M`);
  if (query.maxMarketCapIdrBn) note(`kapitalisasi ≤ Rp ${query.maxMarketCapIdrBn} M`);
  if (query.minLiquidityIdrBn) note(`likuiditas ≥ Rp ${query.minLiquidityIdrBn} M/hari`);
  if (query.maxPe) note(`P/E ≤ ${query.maxPe}`);
  if (query.minPe) note(`P/E ≥ ${query.minPe}`);
  if (query.maxPbv) note(`P/BV ≤ ${query.maxPbv}`);
  if (query.minDividendYield) note(`dividend yield ≥ ${(query.minDividendYield * 100).toFixed(1)}%`);
  if (query.minReturn3m) note(`return 3 bulan ≥ ${(query.minReturn3m * 100).toFixed(0)}%`);
  if (query.maxReturn3m) note(`return 3 bulan ≤ ${(query.maxReturn3m * 100).toFixed(0)}%`);
  if (query.minReturn12m) note(`return 12 bulan ≥ ${(query.minReturn12m * 100).toFixed(0)}%`);
  if (query.maxReturn12m) note(`return 12 bulan ≤ ${(query.maxReturn12m * 100).toFixed(0)}%`);
  if (query.aboveSma200) note('harga di atas MA200');
  if (query.belowSma200) note('harga di bawah MA200');
  if (query.minForeignNet20IdrBn) note(`net beli asing 20 hari ≥ Rp ${query.minForeignNet20IdrBn} M`);
  if (query.maxForeignNet20IdrBn) note(`net asing 20 hari ≤ Rp ${query.maxForeignNet20IdrBn} M`);
  if (query.maxRsi) note(`RSI ≤ ${query.maxRsi}`);
  if (query.minRsi) note(`RSI ≥ ${query.minRsi}`);
  if (query.hasStatements) note('punya laporan keuangan');
  if (query.suitableForUfcf) note('layak dimodelkan DCF');

  // A missing reading must never satisfy a numeric bound — a stock with no P/E
  // is not "cheap", it is unknown, and letting it through would quietly pad
  // every value screen with unpriced names.
  const atMost = (v: number, bound?: number) => bound === undefined || (Number.isFinite(v) && v <= bound);
  const atLeast = (v: number, bound?: number) => bound === undefined || (Number.isFinite(v) && v >= bound);

  const rows: EmitenRow[] = [];
  for (const e of db.emiten) {
    if (query.sectors?.length && !query.sectors.includes(e.sector)) continue;
    if (query.boards?.length && !query.boards.includes(e.board)) continue;
    if (text) {
      const hay = `${e.code} ${e.name} ${e.fullName} ${e.industry} ${e.subIndustry} ${e.business}`.toUpperCase();
      if (!hay.includes(text)) continue;
    }

    const r = buildRow(e, db, factors, fundamentals);

    if (!atLeast(r.marketCapIdrBn, query.minMarketCapIdrBn)) continue;
    if (!atMost(r.marketCapIdrBn, query.maxMarketCapIdrBn)) continue;
    if (!atLeast(r.liquidityIdrBn, query.minLiquidityIdrBn)) continue;
    if (!atLeast(r.price, query.minPrice)) continue;
    if (!atMost(r.price, query.maxPrice)) continue;
    // A negative P/E means the company lost money; it is not a cheap stock, so
    // it never satisfies a "P/E below X" screen.
    if (query.maxPe !== undefined && !(Number.isFinite(r.pe) && r.pe > 0 && r.pe <= query.maxPe)) continue;
    if (!atLeast(r.pe, query.minPe)) continue;
    if (query.maxPbv !== undefined && !(Number.isFinite(r.pbv) && r.pbv > 0 && r.pbv <= query.maxPbv)) continue;
    if (!atLeast(r.dividendYield, query.minDividendYield)) continue;
    if (!atLeast(r.return3m, query.minReturn3m)) continue;
    if (!atMost(r.return3m, query.maxReturn3m)) continue;
    if (!atLeast(r.return12m, query.minReturn12m)) continue;
    if (!atMost(r.return12m, query.maxReturn12m)) continue;
    if (query.aboveSma200 && !(Number.isFinite(r.priceVsSma200) && r.priceVsSma200 > 0)) continue;
    if (query.belowSma200 && !(Number.isFinite(r.priceVsSma200) && r.priceVsSma200 < 0)) continue;
    if (!atLeast(r.foreignNet20IdrBn, query.minForeignNet20IdrBn)) continue;
    if (!atMost(r.foreignNet20IdrBn, query.maxForeignNet20IdrBn)) continue;
    if (!atMost(r.rsi14, query.maxRsi)) continue;
    if (!atLeast(r.rsi14, query.minRsi)) continue;
    if (query.hasStatements && !r.hasStatements) continue;
    if (query.suitableForUfcf && !r.suitableForUfcf) continue;

    rows.push(r);
  }

  const sortBy: SortKey = query.sortBy || 'marketCap';
  const dir = (query.sortDir || 'desc') === 'asc' ? 1 : -1;
  const accessor = SORT_ACCESSORS[sortBy];
  rows.sort((a, b) => {
    const av = accessor(a);
    const bv = accessor(b);
    const aOk = Number.isFinite(av);
    const bOk = Number.isFinite(bv);
    if (!aOk && !bOk) return 0;
    if (!aOk) return 1; // unknown readings always sink
    if (!bOk) return -1;
    return dir * (av - bv);
  });

  const limit = Math.max(1, Math.min(query.limit || 15, 100));
  return {
    rows: rows.slice(0, limit),
    totalMatched: rows.length,
    appliedFilters: applied,
    sortLabel: `${SORT_LABELS[sortBy]} ${dir === 1 ? 'menaik' : 'menurun'}`,
  };
}

// ------------------------------------------------------- Indonesian parsing

const SECTOR_KEYWORDS: { match: RegExp; sector: string }[] = [
  { match: /\b(energi|energy|batu ?bara|batubara|coal|migas|minyak|gas)\b/i, sector: 'Energy' },
  { match: /\b(bahan baku|basic materials?|logam|metal|tambang|semen|kimia|emas|nikel|timah)\b/i, sector: 'Basic Materials' },
  { match: /\b(industri|industrials?|manufaktur|alat berat)\b/i, sector: 'Industrials' },
  { match: /\b(konsumen non.?siklikal|non.?cyclical|consumer non|makanan|minuman|rokok|fmcg)\b/i, sector: 'Consumer Non-Cyclicals' },
  { match: /\b(konsumen siklikal|cyclical|ritel|retail|otomotif|media|pariwisata)\b/i, sector: 'Consumer Cyclicals' },
  { match: /\b(kesehatan|health|farmasi|rumah sakit)\b/i, sector: 'Healthcare' },
  { match: /\b(keuangan|financials?|bank|perbankan|asuransi|multifinance)\b/i, sector: 'Financials' },
  { match: /\b(propert|real estate|konstruksi)\b/i, sector: 'Properties & Real Estate' },
  { match: /\b(teknologi|technology|tech|digital|software)\b/i, sector: 'Technology' },
  { match: /\b(infrastruktur|infrastructure|telko|telekomunikasi|menara|jalan tol)\b/i, sector: 'Infrastructures' },
  { match: /\b(transportasi|transport|logistik|logistic|pelayaran|maskapai)\b/i, sector: 'Transportation & Logistic' },
];

/** "5 triliun" / "500 miliar" / "2rb" -> a number in IDR billions. */
function parseIdrBillions(raw: string, unit: string): number {
  const value = Number(raw.replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'));
  if (!Number.isFinite(value)) return NaN;
  const u = unit.toLowerCase();
  if (/tri/.test(u)) return value * 1000;
  if (/mili|milyar|m\b/.test(u)) return value;
  if (/juta/.test(u)) return value / 1000;
  return value;
}

export interface ParsedIntent {
  query: EmitenQuery;
  /** What the parser understood, echoed back so the user can correct it. */
  understood: string[];
  /** True when nothing recognisable was found and only text search applies. */
  fellBackToTextSearch: boolean;
}

/**
 * Turn an Indonesian sentence into a structured query.
 *
 * Intentionally conservative: it only claims to understand patterns it really
 * matched, and reports them back. Anything it cannot parse becomes a keyword
 * search rather than a silently-wrong filter.
 */
export function parseIndonesianQuery(input: string): ParsedIntent {
  const q: EmitenQuery = {};
  const understood: string[] = [];
  const s = ` ${input.toLowerCase()} `;

  for (const { match, sector } of SECTOR_KEYWORDS) {
    if (match.test(s)) {
      q.sectors = [...(q.sectors || []), sector];
      understood.push(`sektor ${sector}`);
    }
  }

  const pe = s.match(/\bp\s*\/?\s*e\b[^0-9]{0,18}?(\d+(?:[.,]\d+)?)/i);
  if (pe) {
    const v = Number(pe[1].replace(',', '.'));
    if (/\b(di ?bawah|kurang|maks|maksimal|<|below|under)\b/.test(s.slice(Math.max(0, (pe.index || 0) - 30), (pe.index || 0) + 30))) {
      q.maxPe = v;
      understood.push(`P/E di bawah ${v}`);
    } else if (/\b(di ?atas|lebih|min|minimal|>|above|over)\b/.test(s.slice(Math.max(0, (pe.index || 0) - 30), (pe.index || 0) + 30))) {
      q.minPe = v;
      understood.push(`P/E di atas ${v}`);
    } else {
      q.maxPe = v;
      understood.push(`P/E di bawah ${v}`);
    }
  }

  const pbv = s.match(/\b(?:pbv|p\s*\/?\s*bv|price to book)\b[^0-9]{0,18}?(\d+(?:[.,]\d+)?)/i);
  if (pbv) {
    q.maxPbv = Number(pbv[1].replace(',', '.'));
    understood.push(`P/BV di bawah ${q.maxPbv}`);
  }

  const div = s.match(/\b(?:dividen|dividend|yield)\b[^0-9]{0,18}?(\d+(?:[.,]\d+)?)\s*%/i);
  if (div) {
    q.minDividendYield = Number(div[1].replace(',', '.')) / 100;
    understood.push(`dividend yield minimal ${div[1]}%`);
  }

  const cap = s.match(/\b(?:kapitalisasi|market ?cap|kap)\b[^0-9]{0,22}?(\d+(?:[.,]\d+)?)\s*(triliun|trilyun|miliar|milyar|juta|t|m)\b/i);
  if (cap) {
    const v = parseIdrBillions(cap[1], cap[2]);
    if (Number.isFinite(v)) {
      q.minMarketCapIdrBn = v;
      understood.push(`kapitalisasi minimal Rp ${v.toLocaleString('id-ID')} miliar`);
    }
  }

  const liq = s.match(/\b(?:likuid(?:itas)?|transaksi|volume|turnover)\b[^0-9]{0,22}?(\d+(?:[.,]\d+)?)\s*(triliun|trilyun|miliar|milyar|juta|t|m)\b/i);
  if (liq) {
    const v = parseIdrBillions(liq[1], liq[2]);
    if (Number.isFinite(v)) {
      q.minLiquidityIdrBn = v;
      understood.push(`likuiditas minimal Rp ${v.toLocaleString('id-ID')} miliar/hari`);
    }
  }

  if (/\b(likuid|liquid)\b/.test(s) && !q.minLiquidityIdrBn) {
    q.minLiquidityIdrBn = 10;
    understood.push('likuiditas minimal Rp 10 miliar/hari');
  }

  if (/\b(blue ?chip|big ?cap|kapitalisasi besar|saham besar)\b/.test(s)) {
    q.minMarketCapIdrBn = Math.max(q.minMarketCapIdrBn || 0, 20000);
    understood.push('kapitalisasi besar (≥ Rp 20 triliun)');
  }
  if (/\b(small ?cap|kapitalisasi kecil|saham kecil|lapis (?:dua|tiga))\b/.test(s)) {
    q.maxMarketCapIdrBn = 10000;
    understood.push('kapitalisasi kecil (≤ Rp 10 triliun)');
  }

  if (/\b(asing (?:borong|akumulasi|masuk|net ?buy)|net ?buy asing|diakumulasi asing|dikoleksi asing)\b/.test(s)) {
    q.minForeignNet20IdrBn = 1;
    q.sortBy = 'foreignNet20';
    understood.push('net beli asing 20 hari positif');
  }
  if (/\b(asing (?:keluar|jual|net ?sell)|net ?sell asing|dilepas asing)\b/.test(s)) {
    q.maxForeignNet20IdrBn = -1;
    q.sortBy = 'foreignNet20';
    q.sortDir = 'asc';
    understood.push('net jual asing 20 hari');
  }

  if (/\b(uptrend|tren naik|di atas ma ?200|above ma ?200)\b/.test(s)) {
    q.aboveSma200 = true;
    understood.push('harga di atas MA200');
  }
  if (/\b(downtrend|tren turun|di bawah ma ?200|below ma ?200)\b/.test(s)) {
    q.belowSma200 = true;
    understood.push('harga di bawah MA200');
  }

  if (/\b(oversold|jenuh jual|murah secara teknikal)\b/.test(s)) {
    q.maxRsi = 35;
    understood.push('RSI di bawah 35 (oversold)');
  }
  if (/\b(overbought|jenuh beli)\b/.test(s)) {
    q.minRsi = 70;
    understood.push('RSI di atas 70 (overbought)');
  }

  if (/\b(naik|menguat|kuat|top gainer|momentum)\b/.test(s) && !q.sortBy) {
    q.sortBy = 'return3m';
    understood.push('diurutkan dari return 3 bulan tertinggi');
  }
  if (/\b(turun|melemah|anjlok|jatuh|top loser)\b/.test(s)) {
    q.sortBy = 'return3m';
    q.sortDir = 'asc';
    understood.push('diurutkan dari return 3 bulan terendah');
  }
  if (/\b(murah|undervalued|diskon|value)\b/.test(s) && !q.sortBy) {
    q.sortBy = 'pe';
    q.sortDir = 'asc';
    if (!q.maxPe) q.maxPe = 15;
    understood.push('P/E di bawah 15, diurutkan dari termurah');
  }
  if (/\b(dividen|dividend)\b/.test(s) && !q.sortBy) {
    q.sortBy = 'dividendYield';
    understood.push('diurutkan dari dividend yield tertinggi');
  }

  if (/\b(bisa di ?dcf|layak dcf|model dcf|valuasi dcf)\b/.test(s)) {
    q.suitableForUfcf = true;
    understood.push('hanya emiten yang layak dimodelkan DCF');
  }
  if (/\b(laporan keuangan|fundamental)\b/.test(s)) {
    q.hasStatements = true;
    understood.push('hanya emiten yang punya laporan keuangan');
  }

  const topN = s.match(/\b(?:top|(\d{1,2})\s*(?:saham|emiten|teratas))\b/);
  if (topN && topN[1]) {
    q.limit = Number(topN[1]);
    understood.push(`${q.limit} teratas`);
  }

  // Anything left that looks like a ticker or a plain noun becomes a keyword.
  const ticker = input.match(/\b([A-Z]{4})\b/);
  if (ticker && !q.sectors?.length) {
    q.text = ticker[1];
    understood.push(`kode emiten ${ticker[1]}`);
  }

  const fellBack = understood.length === 0;
  if (fellBack) {
    q.text = input.trim().split(/\s+/).slice(0, 4).join(' ');
  }

  return { query: q, understood, fellBackToTextSearch: fellBack };
}

/** Compact plain-text rendering, used for the email digest and the chat reply. */
export function formatRowsAsText(result: QueryResult): string {
  if (!result.rows.length) return 'Tidak ada emiten yang cocok dengan kriteria itu.';
  const lines = result.rows.map((r, i) => {
    const bits = [
      `${i + 1}. ${r.emiten.code} — ${r.emiten.name}`,
      `   Rp ${fmt(r.price)} (${pct(r.changePercent)}) · ${r.emiten.sector}`,
      `   Kap Rp ${fmt(r.marketCapIdrBn)} M · Likuiditas Rp ${fmt(r.liquidityIdrBn, 1)} M/hari`,
      `   3 bln ${pct(r.return3m)} · 12 bln ${pct(r.return12m)} · vs MA200 ${pct(r.priceVsSma200)}`,
    ];
    if (Number.isFinite(r.pe) || Number.isFinite(r.pbv)) {
      bits.push(`   P/E ${fmt(r.pe, 1)} · P/BV ${fmt(r.pbv, 2)} · Asing 20H Rp ${fmt(r.foreignNet20IdrBn, 1)} M`);
    }
    return bits.join('\n');
  });
  return lines.join('\n');
}

const fmt = (v: number, d = 0) =>
  Number.isFinite(v) ? v.toLocaleString('id-ID', { maximumFractionDigits: d }) : '–';
const pct = (v: number, d = 1) =>
  Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%` : '–';
