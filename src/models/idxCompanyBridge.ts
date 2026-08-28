// Bridges the IDX market database into the DCF / LBO engines.
//
// Given a ticker it assembles the emiten's reported statements, stamps them
// with the latest IDX close and share count, calibrates the forecast off the
// actual history, and replaces the placeholder beta with one regressed against
// IHSG from real price data.

import { DcfAssumptions } from '../types/dcf';
import { LboAssumptions } from '../types/lbo';
import { CalibratedModelParams, ParsedFinancialReport } from '../types/statements';
import { Emiten } from '../types/market';
import { MarketDatabase } from '../data/marketRepository';
import { FundamentalsDatabase, StatementQuality, resolveStatements } from '../data/fundamentalsRepository';
import { calibrateFinancialReport, convertCalibratedToDcf, convertCalibratedToLbo } from './statementCalibrator';
import { computeBeta } from './factorEngine';
import { IDX_BASE_DCF, IDX_BASE_LBO, IDX_MARKET_PARAMS } from '../presets/deals';

export interface EmitenModelBundle {
  emiten: Emiten;
  report: ParsedFinancialReport;
  calibrated: CalibratedModelParams;
  dcf: DcfAssumptions;
  lbo: LboAssumptions;
  quality: StatementQuality;
  beta: number;
  betaObservations: number;
  /** Things the analyst needs to know before trusting the output. */
  notes: string[];
  warnings: string[];
}

/** Enterprise value implied by the live price, used to anchor the entry multiple. */
function impliedEntryMultiple(
  sharePriceIdr: number,
  sharesOutstandingBn: number,
  netDebtIdrBn: number,
  ebitdaIdrBn: number
): number {
  if (!(ebitdaIdrBn > 0)) return IDX_BASE_LBO.entryEvEbitdaMultiple;
  // IDR/share x billions of shares == IDR billions of market cap.
  const equityValueIdrBn = sharePriceIdr * sharesOutstandingBn;
  const ev = equityValueIdrBn + netDebtIdrBn;
  const multiple = ev / ebitdaIdrBn;
  return Number.isFinite(multiple) && multiple > 0 ? Math.min(multiple, 40) : IDX_BASE_LBO.entryEvEbitdaMultiple;
}

export function buildEmitenModel(
  emiten: Emiten,
  market: MarketDatabase,
  fundamentals: FundamentalsDatabase
): EmitenModelBundle | null {
  const daily = market.daily.get(emiten.code);
  const livePrice = daily?.close || daily?.prev || 0;
  // Statements are in IDR billions, so the share count is carried in billions
  // too — the DCF engine divides equity value by it without rescaling.
  const liveSharesBn = emiten.listedShares ? emiten.listedShares / 1e9 : 0;

  const resolved = resolveStatements(emiten.code, fundamentals, livePrice, liveSharesBn);
  if (!resolved) return null;

  const { report, quality, translatedFrom, untranslated } = resolved;
  const calibrated = calibrateFinancialReport(report);

  const betaResult = computeBeta(market, emiten.code);
  const beta = betaResult ? Math.min(Math.max(betaResult.beta, 0.2), 2.5) : 1.0;

  const latest = report.historicalData[report.historicalData.length - 1];
  const netDebt = (latest?.totalDebt || 0) - (latest?.cash || 0);
  const entryMultiple = impliedEntryMultiple(livePrice, liveSharesBn, netDebt, latest?.ebitda || 0);
  const marketCapIdrBn = livePrice * liveSharesBn;

  const dcf: DcfAssumptions = {
    ...convertCalibratedToDcf(calibrated, IDX_BASE_DCF),
    companyName: `${emiten.code} — ${emiten.name}`,
    currency: IDX_MARKET_PARAMS.currency,
    units: 'billions',
    currentSharePrice: livePrice,
    sharesOutstanding: liveSharesBn,
    beta,
    // Small caps carry a size premium; IDX large caps (> Rp 10 tn) do not.
    sizePremium: marketCapIdrBn < 10_000 ? 0.02 : 0,
    exitMultiple: Number(Math.max(3, Math.min(entryMultiple, 20)).toFixed(1)),
  };

  const lbo: LboAssumptions = {
    ...convertCalibratedToLbo(calibrated, IDX_BASE_LBO),
    dealName: `Project ${emiten.code} Buyout`,
    currency: IDX_MARKET_PARAMS.currency,
    entryEvEbitdaMultiple: Number(Math.max(3, Math.min(entryMultiple, 20)).toFixed(1)),
    exitEvEbitdaMultiple: Number(Math.max(3, Math.min(entryMultiple * 1.05, 20)).toFixed(1)),
  };

  const notes: string[] = [];
  const warnings: string[] = [];

  notes.push(
    `Laporan keuangan ${report.years[0]}–${report.years[report.years.length - 1]} (${report.years.length} periode), satuan Rp miliar.`
  );
  notes.push(
    `Harga acuan Rp ${livePrice.toLocaleString('id-ID')} per lembar pada sesi ${market.meta.latestSession}, ${liveSharesBn.toLocaleString(
      'id-ID',
      { maximumFractionDigits: 2 }
    )} miliar lembar saham tercatat — kapitalisasi Rp ${marketCapIdrBn.toLocaleString('id-ID', {
      maximumFractionDigits: 0,
    })} miliar.`
  );
  if (betaResult?.reliable) {
    notes.push(
      `Beta ${betaResult.beta.toFixed(2)} (mentah ${betaResult.rawBeta.toFixed(
        2
      )}, disesuaikan Blume) diregresikan terhadap IHSG dari ${betaResult.observations} observasi harian; R² ${betaResult.rSquared.toFixed(
        2
      )}.`
    );
  } else if (betaResult) {
    warnings.push(
      `Regresi beta hanya menjelaskan ${(betaResult.rSquared * 100).toFixed(
        0
      )}% variasi harga terhadap IHSG — terlalu lemah untuk dipercaya. Beta pasar 1,00 dipakai sebagai gantinya, bukan angka ${betaResult.rawBeta.toFixed(
        2
      )} dari regresi.`
    );
  } else {
    warnings.push('Beta tidak dapat diregresikan dari data harga — memakai 1,00 sebagai default.');
  }
  notes.push(`Entry multiple ${entryMultiple.toFixed(1)}x EV/EBITDA disetel dari harga pasar saat ini.`);

  if (translatedFrom) {
    const years = Object.entries(translatedFrom.ratesUsed)
      .map(([y, r]) => `${y}: ${r.toLocaleString('id-ID')}`)
      .join(', ');
    notes.push(
      `Emiten melapor dalam ${translatedFrom.currency}. Angka ditranslasikan ke IDR pada kurs rata-rata tahunan (${years}).`
    );
  }

  // A translation that could not be performed is a WARNING, not a note: the
  // numbers on screen are stamped rupiah while still being foreign currency, so
  // every derived figure — target price, EV/EBITDA, market cap comparison — is
  // out by the exchange rate. Silence here is what makes it dangerous.
  if (untranslated) {
    warnings.push(
      `Emiten melapor dalam ${untranslated.currency} dan angkanya BELUM ditranslasikan ke rupiah untuk tahun ${untranslated.years.join(', ')}. ${untranslated.reason} Sampai itu diperbaiki, seluruh angka turunan di layar ini salah sebesar kursnya — jangan dipakai.`
    );
  }

  if (!quality.suitableForUfcf) {
    warnings.push(
      'Emiten ini tidak melaporkan laba usaha dan modal kerja dalam format yang dibutuhkan model UFCF — umumnya bank, asuransi, dan multifinance. Valuasi yang tepat memakai residual income atau dividend discount, bukan DCF unlevered. Angka di bawah ini hanya indikatif.'
    );
  }
  if (quality.operatingProfitDerived) {
    warnings.push('EBIT diturunkan dari laba sebelum pajak karena laba usaha tidak dilaporkan terpisah.');
  }
  if (!quality.hasWorkingCapital) {
    warnings.push('Neraca tidak memisahkan aset/liabilitas lancar — perubahan modal kerja diasumsikan nol.');
  }
  if (!quality.hasGrossProfit) {
    warnings.push('Laba bruto tidak tersedia — margin bruto pada model tidak bermakna.');
  }
  if (report.historicalData.length < 3) {
    warnings.push(`Hanya ${report.historicalData.length} tahun data historis — CAGR dan rata-rata margin kurang andal.`);
  }

  return {
    emiten,
    report,
    calibrated,
    dcf,
    lbo,
    quality,
    beta,
    betaObservations: betaResult?.observations || 0,
    notes,
    warnings,
  };
}
