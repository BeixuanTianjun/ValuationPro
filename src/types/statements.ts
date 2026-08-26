export interface HistoricalYearData {
  year: string;
  revenue: number;
  revenueGrowth?: number;
  grossProfit: number;
  grossMargin?: number;
  ebitda: number;
  ebitdaMargin?: number;
  ebit: number;
  ebitMargin?: number;
  netIncome: number;
  netMargin?: number;
  capex: number;
  capexPercent?: number;
  da: number;
  daPercent?: number;
  nwc: number;
  nwcPercent?: number;
  cash: number;
  totalDebt: number;
  netDebt?: number;
}

export interface ParsedFinancialReport {
  companyName: string;
  ticker?: string;
  currency: string;
  units: 'billions' | 'millions' | 'thousands' | 'exact';
  years: string[];
  historicalData: HistoricalYearData[];
  
  // Market Info
  sharesOutstanding: number;
  currentSharePrice: number;
  taxRate: number;
}

export interface CalibratedModelParams {
  companyName: string;
  currency: string;
  units: 'billions' | 'millions' | 'thousands' | 'exact';
  
  // Historical stats
  revenueCagr: number;
  avgGrossMargin: number;
  avgEbitdaMargin: number;
  avgEbitMargin: number;
  avgCapexPercent: number;
  avgNwcPercent: number;
  avgDaPercent: number;
  
  // Base period values
  baseRevenue: number;
  baseEbitda: number;
  baseCash: number;
  baseDebt: number;
  
  // 5-Year Forecast projections
  forecastGrowthRates: number[];
  forecastGrossMargins: number[];
  forecastEbitdaMargins: number[];
  forecastEbitMargins: number[];
  forecastCapexPercents: number[];
  forecastNwcPercents: number[];
  forecastDaPercents: number[];
  
  // Market & Capital structure
  sharesOutstanding: number;
  currentSharePrice: number;
  taxRate: number;
}