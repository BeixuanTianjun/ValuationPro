// Portfolio tracker — your actual positions, priced live, read against the
// same mechanical rules the rest of this terminal applies to everything else.
//
// ── WHERE THE DATA LIVES, AND WHY IT IS NOT ON A SERVER ───────────────────
//
// localStorage, in your own browser. Two reasons, and the second is the real
// one:
//
//   1. This app deploys to Vercel, which has no persistent disk. A server-side
//      store would work on the local service and silently lose every position
//      on the deployed site — the worst kind of split behaviour, because it
//      only shows up after you have trusted it with real numbers.
//   2. Your average price and position size are the most private data this
//      terminal will ever hold. Keeping them in your browser means they never
//      cross the network at all, and nothing here has to be trusted not to
//      log them.
//
// The cost is honest and stated in the UI: clear your browser data and the
// portfolio goes with it. That is why export/import to a JSON file exists —
// the data is never trapped in a store you cannot get it out of.
//
// ── WHAT THIS DELIBERATELY DOES NOT DO ────────────────────────────────────
//
// It does not tell you to sell. Every reading below is a MEASUREMENT with a
// stated rule behind it — is the price under the mechanical ATR stop measured
// from YOUR entry, does it still pass the screener's three rules, has KSEI
// institutional ownership risen or fallen — and every one of them names the
// rule that produced it. What none of them do is add up to "dump it", because
// that depends on your horizon, your tax position, your conviction and what
// else you hold, none of which this file knows. The terminal's job is to make
// the numbers impossible to misread, not to decide for you.

import { FactorSnapshot } from '../types/market';
import { MarketDatabase } from '../data/marketRepository';
import { ScreenerRow } from './stockScreener';
import { TradeSetup, buildTradeSetup } from './tradeSetup';

const STORAGE_KEY = 'valuationpro.portfolio.v1';

/** One lot is 100 shares on IDX. Every input in the UI is in lots. */
export const SHARES_PER_LOT = 100;

export interface Position {
  /** Stable id so two lots of the same emiten can be tracked separately. */
  id: string;
  code: string;
  /** Lots held. */
  lots: number;
  /** Average buy price per SHARE, in rupiah. */
  avgPrice: number;
  /** ISO date the position was opened. Optional — blank is allowed. */
  boughtOn?: string;
  note?: string;
}

export interface PositionReading {
  position: Position;
  name: string;
  sector: string;
  /** Current price per share; NaN when the emiten did not trade. */
  price: number;
  changePercent: number;
  shares: number;
  costIdr: number;
  valueIdr: number;
  gainIdr: number;
  gainPercent: number;
  /** Share of the whole portfolio by market value, 0..1. */
  weight: number;

  // ---- mechanical readings, each with its rule named in the UI ----
  /** The three hard screener rules on today's session, or null if not evaluated. */
  screener: ScreenerRow | null;
  /** ATR stop/target measured from YOUR average price, not from today's close. */
  setupFromEntry: TradeSetup | null;
  /** True when the live price has fallen through that stop. */
  belowEntryStop: boolean;
  rsi14: number;
  priceVsSma50: number;
  priceVsSma200: number;
  /** Percentage-point change in KSEI institutional ownership over 3 months. */
  institutionalDeltaPp: number;
  atrPercent: number;
}

export interface PortfolioSummary {
  positions: PositionReading[];
  costIdr: number;
  valueIdr: number;
  gainIdr: number;
  gainPercent: number;
  /** Positions whose live price is below the ATR stop measured from entry. */
  belowStopCount: number;
  /** Positions that no longer pass all three screener rules. */
  failingScreenerCount: number;
  /** Largest single weight, 0..1 — concentration in one line. */
  topWeight: number;
  topWeightCode: string;
}

// ─────────────────────────────────────────────────────────────── storage ──

export function loadPositions(): Position[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Every field is re-validated rather than trusted: this JSON can be edited
    // by hand, imported from a file, or left over from an older shape, and a
    // NaN avgPrice would poison every downstream number silently.
    return parsed.flatMap((p) => {
      const r = p as Partial<Position>;
      if (typeof r.code !== 'string' || !r.code.trim()) return [];
      const lots = Number(r.lots);
      const avgPrice = Number(r.avgPrice);
      if (!Number.isFinite(lots) || lots <= 0) return [];
      if (!Number.isFinite(avgPrice) || avgPrice <= 0) return [];
      return [
        {
          id: typeof r.id === 'string' && r.id ? r.id : `${r.code}-${Math.random().toString(36).slice(2, 9)}`,
          code: r.code.trim().toUpperCase(),
          lots,
          avgPrice,
          boughtOn: typeof r.boughtOn === 'string' ? r.boughtOn : undefined,
          note: typeof r.note === 'string' ? r.note : undefined,
        },
      ];
    });
  } catch {
    // A corrupt or unavailable store must not take the screen down; an empty
    // portfolio is a correct rendering of "nothing readable is saved".
    return [];
  }
}

export function savePositions(positions: Position[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
    return true;
  } catch {
    // Private windows and disabled site data both throw here. The caller warns
    // rather than pretending the save happened.
    return false;
  }
}

export const newPositionId = () => `pos-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

// ─────────────────────────────────────────────────────────────── compute ──

/**
 * Prices the portfolio and attaches the mechanical readings.
 *
 * The ATR stop is computed from YOUR average price, not from today's close,
 * and that difference is the point. A stop drawn from the current price tells
 * you where a NEW entry today would be cut; a stop drawn from your entry tells
 * you whether the trade you actually took has broken. They are different
 * questions and the second is the one a holder is asking.
 */
export function buildPortfolio(
  positions: Position[],
  db: MarketDatabase,
  factors: Map<string, FactorSnapshot> | null,
  screenerRows: Map<string, ScreenerRow> | null,
  institutionalDeltaPp?: Map<string, number>
): PortfolioSummary {
  const readings: PositionReading[] = [];
  let costTotal = 0;
  let valueTotal = 0;

  for (const p of positions) {
    const emiten = db.byCode.get(p.code);
    const quote = db.daily.get(p.code);
    const f = factors?.get(p.code) ?? null;

    const shares = p.lots * SHARES_PER_LOT;
    const cost = shares * p.avgPrice;
    // An emiten that did not trade keeps its cost as its value rather than
    // dropping to zero — a suspended stock is not a total loss, and printing
    // one would be alarming and wrong.
    const price = quote && quote.close > 0 ? quote.close : NaN;
    const value = Number.isFinite(price) ? shares * price : cost;

    costTotal += cost;
    valueTotal += value;

    const setupFromEntry = buildTradeSetup({
      code: p.code,
      close: p.avgPrice,
      atr14: f?.atr14 ?? NaN,
    });

    readings.push({
      position: p,
      name: emiten?.name ?? p.code,
      sector: emiten?.sector ?? '–',
      price,
      changePercent: quote && quote.prev > 0 ? quote.close / quote.prev - 1 : NaN,
      shares,
      costIdr: cost,
      valueIdr: value,
      gainIdr: value - cost,
      gainPercent: cost > 0 ? value / cost - 1 : NaN,
      weight: 0, // filled once the total is known
      screener: screenerRows?.get(p.code) ?? null,
      setupFromEntry,
      belowEntryStop: Boolean(setupFromEntry && Number.isFinite(price) && price < setupFromEntry.stop),
      rsi14: f?.rsi14 ?? NaN,
      priceVsSma50: f?.priceVsSma50 ?? NaN,
      priceVsSma200: f?.priceVsSma200 ?? NaN,
      institutionalDeltaPp: institutionalDeltaPp?.get(p.code) ?? NaN,
      atrPercent: f?.atrPercent ?? NaN,
    });
  }

  for (const r of readings) r.weight = valueTotal > 0 ? r.valueIdr / valueTotal : 0;
  readings.sort((a, b) => b.valueIdr - a.valueIdr);

  const top = readings[0];

  return {
    positions: readings,
    costIdr: costTotal,
    valueIdr: valueTotal,
    gainIdr: valueTotal - costTotal,
    gainPercent: costTotal > 0 ? valueTotal / costTotal - 1 : NaN,
    belowStopCount: readings.filter((r) => r.belowEntryStop).length,
    failingScreenerCount: readings.filter((r) => r.screener && !r.screener.passAll).length,
    topWeight: top?.weight ?? 0,
    topWeightCode: top?.position.code ?? '',
  };
}
