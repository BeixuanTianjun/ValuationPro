// Display metadata for every index IDX publishes in its daily index summary.
// The codes here are exactly the ones returned by
// /primary/TradingSummary/GetIndexSummary, so the catalog stays in sync with
// whatever the ingest script pulls down.

import { IndexQuote } from '../types/market';

type Group = IndexQuote['group'];

interface IndexMeta {
  name: string;
  group: Group;
  /** IDX-IC sector this index tracks, for sector-relative strength. */
  sector?: string;
}

export const IDX_INDEX_CATALOG: Record<string, IndexMeta> = {
  // --- headline
  COMPOSITE: { name: 'IHSG — Indeks Harga Saham Gabungan', group: 'headline' },
  LQ45: { name: 'LQ45 — 45 Saham Paling Likuid', group: 'headline' },
  IDX30: { name: 'IDX30', group: 'headline' },
  IDX80: { name: 'IDX80', group: 'headline' },
  KOMPAS100: { name: 'Kompas100', group: 'headline' },
  MBX: { name: 'Main Board Index', group: 'headline' },
  DBX: { name: 'Development Board Index', group: 'headline' },
  ABX: { name: 'Acceleration Board Index', group: 'headline' },

  // --- factor / style
  IDXQ30: { name: 'IDX Quality30', group: 'factor' },
  IDXV30: { name: 'IDX Value30', group: 'factor' },
  IDXG30: { name: 'IDX Growth30', group: 'factor' },
  IDXHIDIV20: { name: 'IDX High Dividend 20', group: 'factor' },
  IDXLQ45LCL: { name: 'IDX LQ45 Low Carbon Leaders', group: 'factor' },
  'IDXSMC-LIQ': { name: 'IDX SMC Liquid — Small & Mid Cap', group: 'factor' },
  'IDXSMC-COM': { name: 'IDX SMC Composite — Small & Mid Cap', group: 'factor' },
  IDXSHAGROW: { name: 'IDX Sharia Growth', group: 'factor' },
  'I-GRADE': { name: 'Infobank Grade', group: 'factor' },

  // --- sharia
  ISSI: { name: 'ISSI — Indeks Saham Syariah Indonesia', group: 'sharia' },
  JII: { name: 'JII — Jakarta Islamic Index', group: 'sharia' },
  JII70: { name: 'JII70', group: 'sharia' },

  // --- thematic / curated
  IDXBUMN20: { name: 'IDX BUMN20', group: 'thematic' },
  IDXMESBUMN: { name: 'IDX MES BUMN 17', group: 'thematic' },
  IDXESGL: { name: 'IDX ESG Leaders', group: 'thematic' },
  'SRI-KEHATI': { name: 'SRI-KEHATI', group: 'thematic' },
  ESGSKEHATI: { name: 'ESG Sector Leaders KEHATI', group: 'thematic' },
  ESGQKEHATI: { name: 'ESG Quality 45 KEHATI', group: 'thematic' },
  INFOBANK15: { name: 'Infobank15', group: 'thematic' },
  'BISNIS-27': { name: 'Bisnis-27', group: 'thematic' },
  Investor33: { name: 'Investor33', group: 'thematic' },
  SMinfra18: { name: 'SMInfra18', group: 'thematic' },
  MNC36: { name: 'MNC36', group: 'thematic' },
  PRIMBANK10: { name: 'PEFINDO Prime Bank 10', group: 'thematic' },
  ECONOMIC30: { name: 'Economic30', group: 'thematic' },
  IDXVESTA28: { name: 'IDX-Vesta28', group: 'thematic' },

  // --- IDX-IC sectors
  IDXENERGY: { name: 'IDX Sector Energy', group: 'sector', sector: 'Energy' },
  IDXBASIC: { name: 'IDX Sector Basic Materials', group: 'sector', sector: 'Basic Materials' },
  IDXINDUST: { name: 'IDX Sector Industrials', group: 'sector', sector: 'Industrials' },
  IDXNONCYC: { name: 'IDX Sector Consumer Non-Cyclicals', group: 'sector', sector: 'Consumer Non-Cyclicals' },
  IDXCYCLIC: { name: 'IDX Sector Consumer Cyclicals', group: 'sector', sector: 'Consumer Cyclicals' },
  IDXHEALTH: { name: 'IDX Sector Healthcare', group: 'sector', sector: 'Healthcare' },
  IDXFINANCE: { name: 'IDX Sector Financials', group: 'sector', sector: 'Financials' },
  IDXPROPERT: { name: 'IDX Sector Properties & Real Estate', group: 'sector', sector: 'Properties & Real Estate' },
  IDXTECHNO: { name: 'IDX Sector Technology', group: 'sector', sector: 'Technology' },
  IDXINFRA: { name: 'IDX Sector Infrastructures', group: 'sector', sector: 'Infrastructures' },
  IDXTRANS: { name: 'IDX Sector Transportation & Logistic', group: 'sector', sector: 'Transportation & Logistic' },
};

/** IDX-IC sector -> its sector index code. */
export const SECTOR_TO_INDEX: Record<string, string> = Object.entries(IDX_INDEX_CATALOG).reduce(
  (acc, [code, meta]) => {
    if (meta.sector) acc[meta.sector] = code;
    return acc;
  },
  {} as Record<string, string>
);

export const GROUP_LABELS: Record<Group, string> = {
  headline: 'Indeks Utama',
  sector: 'Indeks Sektoral IDX-IC',
  factor: 'Indeks Faktor & Gaya',
  thematic: 'Indeks Tematik',
  sharia: 'Indeks Syariah',
};

export function describeIndex(code: string): IndexMeta {
  return IDX_INDEX_CATALOG[code] || { name: code, group: 'thematic' };
}
