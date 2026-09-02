import { LboAssumptions, LboReturnsSummary, LboYearSchedule, SourcesAndUses, DebtTrancheSchedule } from '../types/lbo';
import { SensitivityMatrix } from '../types/common';
import { calculateIRR } from '../utils/financialMath';
import { formatPercent, formatMultiple } from '../utils/formatters';

export function calculateSourcesAndUses(assumptions: LboAssumptions): SourcesAndUses {
  const enterpriseValue = assumptions.targetLtmEbitda * assumptions.entryEvEbitdaMultiple;
  const seniorDebtAmount = assumptions.targetLtmEbitda * assumptions.seniorDebtMultiple;
  const subDebtAmount = assumptions.targetLtmEbitda * assumptions.subDebtMultiple;
  const totalDebtRaised = seniorDebtAmount + subDebtAmount;

  const advisoryFees = enterpriseValue * assumptions.advisoryFeePercent;
  const financingFees = totalDebtRaised * assumptions.financingFeePercent;
  const totalUses = enterpriseValue + advisoryFees + financingFees;

  const sponsorEquity = Math.max(0, totalUses - totalDebtRaised);
  const totalSources = totalDebtRaised + sponsorEquity;
  const sponsorEquityPercent = totalSources > 0 ? sponsorEquity / totalSources : 0;
  const totalDebtMultiple = assumptions.targetLtmEbitda > 0 ? totalDebtRaised / assumptions.targetLtmEbitda : 0;

  return {
    enterpriseValue,
    refinanceOldDebt: 0,
    advisoryFees,
    financingFees,
    totalUses,
    seniorDebtAmount,
    subDebtAmount,
    totalDebtRaised,
    sponsorEquity,
    totalSources,
    sponsorEquityPercent,
    totalDebtMultiple,
  };
}

export function runLboModel(assumptions: LboAssumptions): LboReturnsSummary {
  const su = calculateSourcesAndUses(assumptions);
  const holdYears = Math.min(Math.max(assumptions.holdPeriodYears, 1), assumptions.revenueGrowthRates.length);

  let currentSeniorDebt = su.seniorDebtAmount;
  let currentSubDebt = su.subDebtAmount;
  let prevRevenue = assumptions.targetLtmRevenue;
  let prevNwc = assumptions.targetLtmRevenue * (assumptions.nwcPercentOfRev[0] || 0.08);
  let currentCash = assumptions.minCashBalance;

  const schedules: LboYearSchedule[] = [];

  for (let i = 0; i < holdYears; i++) {
    const year = i + 1;
    const growth = assumptions.revenueGrowthRates[i] ?? 0.05;
    const rev = prevRevenue * (1 + growth);
    const ebitdaMargin = assumptions.ebitdaMargins[i] ?? 0.25;
    const ebitda = rev * ebitdaMargin;
    const daMargin = assumptions.daPercentOfRev[i] ?? 0.05;
    const da = rev * daMargin;
    const ebit = ebitda - da;

    const seniorBeginning = currentSeniorDebt;
    const subBeginning = currentSubDebt;

    const seniorInterest = seniorBeginning * assumptions.seniorDebtInterest;
    const subInterest = subBeginning * assumptions.subDebtInterest;
    const totalInterestExpense = seniorInterest + subInterest;

    const ebt = ebit - totalInterestExpense;
    const tax = Math.max(0, ebt * assumptions.taxRate);
    const netIncome = ebt - tax;

    const capex = rev * (assumptions.capexPercentOfRev[i] ?? 0.04);
    const currentNwc = rev * (assumptions.nwcPercentOfRev[i] ?? 0.08);
    const deltaNwc = currentNwc - prevNwc;

    const freeCashFlowBeforeDebt = netIncome + da - capex - deltaNwc;

    const seniorMandatoryAmort = Math.min(seniorBeginning, su.seniorDebtAmount * assumptions.seniorDebtAmort);
    const subMandatoryAmort = Math.min(subBeginning, su.subDebtAmount * assumptions.subDebtAmort);

    const cashAfterMandatory = Math.max(0, freeCashFlowBeforeDebt - seniorMandatoryAmort - subMandatoryAmort);

    const remainingSenior = seniorBeginning - seniorMandatoryAmort;
    const seniorSweep = Math.min(remainingSenior, cashAfterMandatory * assumptions.cashSweepPercent);

    const seniorEnding = Math.max(0, seniorBeginning - seniorMandatoryAmort - seniorSweep);
    const subEnding = Math.max(0, subBeginning - subMandatoryAmort);
    const totalEndingDebt = seniorEnding + subEnding;

    const unspentCash = cashAfterMandatory - seniorSweep;
    const cashEnding = assumptions.minCashBalance + unspentCash;
    const netDebt = totalEndingDebt - (cashEnding - assumptions.minCashBalance);

    const seniorSchedule: DebtTrancheSchedule = {
      beginningBalance: seniorBeginning,
      mandatoryAmortization: seniorMandatoryAmort,
      optionalPrepayment: seniorSweep,
      endingBalance: seniorEnding,
      interestExpense: seniorInterest,
      effectiveRate: assumptions.seniorDebtInterest,
    };

    const subSchedule: DebtTrancheSchedule = {
      beginningBalance: subBeginning,
      mandatoryAmortization: subMandatoryAmort,
      optionalPrepayment: 0,
      endingBalance: subEnding,
      interestExpense: subInterest,
      effectiveRate: assumptions.subDebtInterest,
    };

    schedules.push({
      year,
      revenue: rev,
      ebitda,
      da,
      ebit,
      totalInterestExpense,
      ebt,
      tax,
      netIncome,
      capex,
      deltaNwc,
      freeCashFlowBeforeDebt,
      seniorDebt: seniorSchedule,
      subDebt: subSchedule,
      totalEndingDebt,
      cashBeginning: currentCash,
      cashGenerated: freeCashFlowBeforeDebt,
      totalDebtService: seniorMandatoryAmort + subMandatoryAmort + seniorSweep + totalInterestExpense,
      cashEnding,
      netDebt,
      leverageRatio: ebitda > 0 ? netDebt / ebitda : 0,
      interestCoverageRatio: totalInterestExpense > 0 ? ebitda / totalInterestExpense : 999,
    });

    currentSeniorDebt = seniorEnding;
    currentSubDebt = subEnding;
    prevRevenue = rev;
    prevNwc = currentNwc;
    currentCash = cashEnding;
  }

  const lastSchedule = schedules[schedules.length - 1];
  const exitEbitda = lastSchedule ? lastSchedule.ebitda : assumptions.targetLtmEbitda;
  const exitMultiple = assumptions.exitEvEbitdaMultiple;
  const exitEnterpriseValue = exitEbitda * exitMultiple;
  const endingNetDebt = lastSchedule ? Math.max(0, lastSchedule.netDebt) : 0;
  const exitEquityValue = Math.max(0, exitEnterpriseValue - endingNetDebt);

  const initialSponsorEquity = su.sponsorEquity;
  const sponsorMoIC = initialSponsorEquity > 0 ? exitEquityValue / initialSponsorEquity : 0;

  const irrCashFlows = [-initialSponsorEquity];
  for (let y = 1; y < holdYears; y++) {
    irrCashFlows.push(0);
  }
  irrCashFlows.push(exitEquityValue);

  const sponsorIRR = calculateIRR(irrCashFlows);

  const initialEbitda = assumptions.targetLtmEbitda;
  const entryMultiple = assumptions.entryEvEbitdaMultiple;
  const initialNetDebt = su.totalDebtRaised;

  const ebitdaGrowthImpact = (exitEbitda - initialEbitda) * entryMultiple;
  const multipleExpansionImpact = (exitMultiple - entryMultiple) * exitEbitda;
  const debtPaydownImpact = initialNetDebt - endingNetDebt;
  // Komponen keempat, tanpa ini jembatannya tidak pernah menutup.
  //
  // `initialSponsorEquity` sudah memuat biaya penutupan — sponsor menyetor
  // nilai perusahaan DITAMBAH fee — sementara ketiga komponen di atas hanya
  // berbicara tentang nilai perusahaan. Selisihnya persis sebesar fee itu, dan
  // sampai commit ini ia lenyap tanpa jejak: layar Value Creation Drivers
  // menormalkan panjang batangnya terhadap jumlah tiga komponen, sehingga tiap
  // batang tampil lebih besar daripada porsinya yang sebenarnya.
  const transactionFeeImpact = -(su.advisoryFees + su.financingFees);

  return {
    sourcesAndUses: su,
    schedules,
    exitYear: holdYears,
    exitEbitda,
    exitMultiple,
    exitEnterpriseValue,
    endingNetDebt,
    exitEquityValue,
    initialSponsorEquity,
    sponsorMoIC,
    sponsorIRR,
    ebitdaGrowthImpact,
    multipleExpansionImpact,
    debtPaydownImpact,
    transactionFeeImpact,
  };
}

export function generateLboSensitivityEntryVsExit(assumptions: LboAssumptions, metric: 'irr' | 'moic' = 'irr'): SensitivityMatrix {
  const baseEntry = assumptions.entryEvEbitdaMultiple;
  const baseExit = assumptions.exitEvEbitdaMultiple;

  const entryOffsets = [-2.0, -1.0, -0.5, 0, 0.5, 1.0, 2.0];
  const exitOffsets = [-2.0, -1.0, -0.5, 0, 0.5, 1.0, 2.0];

  const rowValues = entryOffsets.map(o => Math.max(1.0, baseEntry + o));
  const colValues = exitOffsets.map(o => Math.max(1.0, baseExit + o));

  const matrix = rowValues.map((entryM, rIdx) => {
    return colValues.map((exitM, cIdx) => {
      const cloned: LboAssumptions = {
        ...assumptions,
        entryEvEbitdaMultiple: entryM,
        exitEvEbitdaMultiple: exitM,
      };
      const res = runLboModel(cloned);
      const isBase = entryOffsets[rIdx] === 0 && exitOffsets[cIdx] === 0;
      const val = metric === 'irr' ? res.sponsorIRR : res.sponsorMoIC;
      const formatted = metric === 'irr' ? formatPercent(val, 1) : formatMultiple(val, 2);

      return {
        rowValue: entryM,
        colValue: exitM,
        resultValue: val,
        formattedResult: formatted,
        isBaseCase: isBase,
      };
    });
  });

  return {
    rowHeader: 'Entry EV/EBITDA Multiple',
    colHeader: 'Exit EV/EBITDA Multiple',
    rowValues,
    colValues,
    matrix,
    metricName: metric === 'irr' ? 'Sponsor IRR (% p.a.)' : 'Sponsor MoIC (Multiple)',
  };
}

export function generateLboSensitivityLeverageVsExit(assumptions: LboAssumptions): SensitivityMatrix {
  const baseSenior = assumptions.seniorDebtMultiple;
  const baseExit = assumptions.exitEvEbitdaMultiple;

  const leverageVariants = [2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0];
  const exitOffsets = [-2.0, -1.0, 0, 1.0, 2.0];
  const exitValues = exitOffsets.map(o => Math.max(1.0, baseExit + o));

  const matrix = leverageVariants.map((lev) => {
    return exitValues.map((exitM, cIdx) => {
      const cloned: LboAssumptions = {
        ...assumptions,
        seniorDebtMultiple: lev,
        exitEvEbitdaMultiple: exitM,
      };
      const res = runLboModel(cloned);
      const isBase = Math.abs(lev - baseSenior) < 0.01 && exitOffsets[cIdx] === 0;
      return {
        rowValue: lev,
        colValue: exitM,
        resultValue: res.sponsorIRR,
        formattedResult: formatPercent(res.sponsorIRR, 1),
        isBaseCase: isBase,
      };
    });
  });

  return {
    rowHeader: 'Senior Debt Leverage Multiple (x EBITDA)',
    colHeader: 'Exit EV/EBITDA Multiple',
    rowValues: leverageVariants,
    colValues: exitValues,
    matrix,
    metricName: 'Sponsor IRR by Leverage & Exit',
  };
}
