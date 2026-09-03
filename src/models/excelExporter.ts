import ExcelJS from 'exceljs';
import { DcfAssumptions, DcfValuationSummary } from '../types/dcf';
import { LboAssumptions, LboReturnsSummary } from '../types/lbo';

const COLORS = {
  NAVY_HEADER: '1B365D',
  NAVY_SUBHEADER: '2E5B88',
  INPUT_BLUE: '002060',
  FORMULA_BLACK: '000000',
  HIGHLIGHT_GREEN: 'D4EDDA',
  HIGHLIGHT_GOLD: 'FFF3CD',
};

/**
 * Number formats throughout this file are authored with a `$` placeholder.
 * Rewrite them to the model's actual currency right before the workbook is
 * serialised, so a rupiah model does not export with dollar signs.
 */
function applyCurrencySymbol(workbook: ExcelJS.Workbook, currency: string) {
  const symbol = currency.trim();
  if (!symbol || symbol === '$') return;
  const literal = `"${symbol} "`;
  workbook.eachSheet((sheet) => {
    sheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (typeof cell.numFmt === 'string' && cell.numFmt.includes('$')) {
          cell.numFmt = cell.numFmt.split('$').join(literal);
        }
      });
    });
  });
}

/**
 * Susun workbook DCF + LBO, TANPA menyimpan.
 *
 * Alasannya sama seperti di pickReport.ts: `saveAs` butuh DOM, jadi selama
 * penyusunan dan penyimpanan menyatu, isi berkas ini hanya bisa diperiksa
 * dengan mengunduh lalu membukanya — yang berarti tidak pernah diperiksa.
 */
export async function buildFinancialModelWorkbook(
  dcfAssumptions: DcfAssumptions,
  dcfSummary: DcfValuationSummary,
  lboAssumptions: LboAssumptions,
  lboSummary: LboReturnsSummary
): Promise<ExcelJS.Workbook> {
  // Column headers carry the currency and scale the model is actually in.
  const UNIT_TAG = `(${[
    dcfAssumptions.currency.trim(),
    ({ billions: 'bn', millions: 'm', thousands: 'k', exact: '' } as Record<string, string>)[dcfAssumptions.units] ?? '',
  ]
    .filter(Boolean)
    .join(' ')})`;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ValuationPro Financial Modeler';
  workbook.created = new Date();

  // SHEET 1: DCF Valuation Model
  const dcfSheet = workbook.addWorksheet('DCF Model', {
    views: [{ showGridLines: true }]
  });

  dcfSheet.mergeCells('B2:H2');
  const titleCell = dcfSheet.getCell('B2');
  titleCell.value = `${dcfAssumptions.companyName.toUpperCase()} - DISCOUNTED CASH FLOW (DCF) VALUATION`;
  titleCell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.NAVY_HEADER } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  dcfSheet.getRow(2).height = 28;

  dcfSheet.getCell('B3').value = `Currency: ${dcfAssumptions.currency} in ${dcfAssumptions.units} | Valuation Date: ${new Date().toLocaleDateString()}`;
  dcfSheet.getCell('B3').font = { name: 'Calibri', size: 10, italic: true, color: { argb: '555555' } };

  dcfSheet.getCell('B5').value = 'I. KEY VALUATION ASSUMPTIONS & WACC';
  dcfSheet.getCell('B5').font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFF' } };
  dcfSheet.getCell('B5').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.NAVY_SUBHEADER } };
  dcfSheet.mergeCells('B5:D5');

  const dcfAssumpRows = [
    ['Current Market Share Price', dcfAssumptions.currentSharePrice, '$#,##0.00'],
    ['Diluted Shares Outstanding (m)', dcfAssumptions.sharesOutstanding, '#,##0.0'],
    ['Balance Sheet Cash & Equivalents', dcfAssumptions.balanceSheetCash, '$#,##0.0'],
    ['Total Debt Outstanding', dcfAssumptions.balanceSheetDebt, '$#,##0.0'],
    ['Minority Interest / Pref. Equity', dcfAssumptions.minorityInterest, '$#,##0.0'],
    ['Risk-Free Rate (Rf)', dcfAssumptions.riskFreeRate, '0.00%'],
    ['Equity Beta (β)', dcfAssumptions.beta, '0.00'],
    ['Equity Risk Premium (ERP)', dcfAssumptions.equityRiskPremium, '0.00%'],
    ['Size / Specific Risk Premium', dcfAssumptions.sizePremium, '0.00%'],
    ['Cost of Equity (Ke = Rf + β*ERP + SP)', dcfSummary.wacc.costOfEquity, '0.00%'],
    ['Pre-Tax Cost of Debt (Kd)', dcfAssumptions.preTaxCostOfDebt, '0.00%'],
    ['Marginal Effective Tax Rate', dcfAssumptions.taxRate, '0.00%'],
    ['After-Tax Cost of Debt [Kd*(1-t)]', dcfSummary.wacc.afterTaxCostOfDebt, '0.00%'],
    ['Target Debt Weight (D/V)', dcfAssumptions.targetDebtWeight, '0.00%'],
    ['Target Equity Weight (E/V)', 1 - dcfAssumptions.targetDebtWeight, '0.00%'],
    ['Weighted Average Cost of Capital (WACC)', dcfSummary.wacc.wacc, '0.00%'],
    ['Perpetual Terminal Growth Rate (g)', dcfAssumptions.perpetualGrowthRate, '0.00%'],
    ['Terminal Exit EV/EBITDA Multiple', dcfAssumptions.exitMultiple, '0.0"x"'],
  ];

  dcfAssumpRows.forEach((row, idx) => {
    const rowNum = 6 + idx;
    const labelCell = dcfSheet.getCell(`B${rowNum}`);
    const valCell = dcfSheet.getCell(`C${rowNum}`);
    labelCell.value = row[0];
    valCell.value = row[1];
    valCell.numFmt = row[2] as string;

    const isCalc = [9, 12, 14, 15].includes(idx);
    valCell.font = { name: 'Calibri', size: 10, bold: isCalc, color: { argb: isCalc ? COLORS.FORMULA_BLACK : COLORS.INPUT_BLUE } };
    if (idx === 15) {
      labelCell.font = { bold: true };
      valCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.HIGHLIGHT_GOLD } };
    }
  });

  // UFCF Schedule
  dcfSheet.getCell('F5').value = 'II. UNLEVERED FREE CASH FLOW (UFCF) PROJECTIONS';
  dcfSheet.getCell('F5').font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFF' } };
  dcfSheet.getCell('F5').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.NAVY_SUBHEADER } };
  dcfSheet.mergeCells('F5:L5');

  const headers = ['Line Item', 'Base Year', ...dcfSummary.cashFlows.map(c => `Year ${c.year}`)];
  headers.forEach((h, colIdx) => {
    const colLetter = String.fromCharCode(70 + colIdx);
    const cell = dcfSheet.getCell(`${colLetter}6`);
    cell.value = h;
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.NAVY_HEADER } };
    cell.alignment = { horizontal: colIdx === 0 ? 'left' : 'right' };
  });

  const ufcfRows = [
    { label: 'Revenue', base: dcfAssumptions.baseRevenue, getVal: (c: any) => c.revenue, fmt: '$#,##0.0' },
    { label: 'Revenue Growth Rate (%)', base: '-', getVal: (c: any) => c.revenueGrowth, fmt: '0.0%' },
    { label: 'Gross Profit', base: dcfAssumptions.baseRevenue * 0.65, getVal: (c: any) => c.grossProfit, fmt: '$#,##0.0' },
    { label: 'EBITDA', base: dcfAssumptions.baseRevenue * 0.25, getVal: (c: any) => c.ebitda, fmt: '$#,##0.0' },
    { label: 'Less: Depreciation & Amortization (D&A)', base: '-', getVal: (c: any) => -c.da, fmt: '($#,##0.0)' },
    { label: 'Operating Income (EBIT)', base: '-', getVal: (c: any) => c.ebit, fmt: '$#,##0.0' },
    { label: 'Less: Taxes on EBIT', base: '-', getVal: (c: any) => -c.taxesOnEbit, fmt: '($#,##0.0)' },
    { label: 'Net Operating Profit After Tax (NOPAT)', base: '-', getVal: (c: any) => c.nopat, fmt: '$#,##0.0' },
    { label: 'Plus: D&A (Non-Cash Addback)', base: '-', getVal: (c: any) => c.da, fmt: '$#,##0.0' },
    { label: 'Less: Capital Expenditures (CapEx)', base: '-', getVal: (c: any) => -c.capex, fmt: '($#,##0.0)' },
    { label: 'Less: Change in Net Working Capital (ΔNWC)', base: '-', getVal: (c: any) => -c.deltaNwc, fmt: '($#,##0.0)' },
    { label: 'Unlevered Free Cash Flow (UFCF)', base: '-', getVal: (c: any) => c.ufcf, fmt: '$#,##0.0', highlight: true },
    { label: 'Discount Period (Mid-Year)', base: '-', getVal: (c: any) => c.discountPeriod, fmt: '0.0' },
    { label: 'Discount Factor', base: '-', getVal: (c: any) => c.discountFactor, fmt: '0.0000' },
    { label: 'Present Value of UFCF', base: '-', getVal: (c: any) => c.presentValueUfcf, fmt: '$#,##0.0', bold: true },
  ];

  ufcfRows.forEach((row, rIdx) => {
    const rowNum = 7 + rIdx;
    const labelCell = dcfSheet.getCell(`F${rowNum}`);
    labelCell.value = row.label;
    labelCell.font = { name: 'Calibri', size: 10, bold: row.bold || row.highlight };

    const baseCell = dcfSheet.getCell(`G${rowNum}`);
    baseCell.value = row.base;
    if (typeof row.base === 'number') baseCell.numFmt = row.fmt;
    baseCell.alignment = { horizontal: 'right' };

    dcfSummary.cashFlows.forEach((cf, cIdx) => {
      const colLetter = String.fromCharCode(72 + cIdx);
      const cell = dcfSheet.getCell(`${colLetter}${rowNum}`);
      const val = row.getVal(cf);
      cell.value = val;
      cell.numFmt = row.fmt;
      cell.font = { name: 'Calibri', size: 10, bold: row.bold || row.highlight };
      cell.alignment = { horizontal: 'right' };

      if (row.highlight) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.HIGHLIGHT_GOLD } };
      }
    });
  });

  // Bridge
  const bridgeStartRow = 25;
  dcfSheet.getCell(`F${bridgeStartRow}`).value = 'III. VALUATION OUTPUT & IMPLIED SHARE PRICE';
  dcfSheet.getCell(`F${bridgeStartRow}`).font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFF' } };
  dcfSheet.getCell(`F${bridgeStartRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.NAVY_SUBHEADER } };
  dcfSheet.mergeCells(`F${bridgeStartRow}:L${bridgeStartRow}`);

  const bridgeHeaders = ['Metric', 'Gordon Growth Method', 'Exit Multiple Method'];
  dcfSheet.getCell(`F${bridgeStartRow + 1}`).value = bridgeHeaders[0];
  dcfSheet.getCell(`H${bridgeStartRow + 1}`).value = bridgeHeaders[1];
  dcfSheet.getCell(`K${bridgeStartRow + 1}`).value = bridgeHeaders[2];
  dcfSheet.mergeCells(`F${bridgeStartRow + 1}:G${bridgeStartRow + 1}`);
  dcfSheet.mergeCells(`H${bridgeStartRow + 1}:J${bridgeStartRow + 1}`);
  dcfSheet.mergeCells(`K${bridgeStartRow + 1}:L${bridgeStartRow + 1}`);

  [`F${bridgeStartRow + 1}`, `H${bridgeStartRow + 1}`, `K${bridgeStartRow + 1}`].forEach(c => {
    dcfSheet.getCell(c).font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFF' } };
    dcfSheet.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.NAVY_HEADER } };
  });

  const bridgeItems = [
    ['Cumulative PV of Discrete Cash Flows', dcfSummary.pvDiscreteCashFlows, dcfSummary.pvDiscreteCashFlows, '$#,##0.0'],
    ['Terminal Value (Undiscounted)', dcfSummary.terminalGrowthValue, dcfSummary.terminalMultipleValue, '$#,##0.0'],
    ['PV of Terminal Value', dcfSummary.pvTerminalGrowthValue, dcfSummary.pvTerminalMultipleValue, '$#,##0.0'],
    ['Implied Enterprise Value (EV)', dcfSummary.evGordonGrowth, dcfSummary.evExitMultiple, '$#,##0.0', true],
    ['Plus: Cash & Cash Equivalents', dcfAssumptions.balanceSheetCash, dcfAssumptions.balanceSheetCash, '$#,##0.0'],
    ['Less: Total Debt', -dcfAssumptions.balanceSheetDebt, -dcfAssumptions.balanceSheetDebt, '($#,##0.0)'],
    ['Less: Minority Interest & Others', -dcfAssumptions.minorityInterest, -dcfAssumptions.minorityInterest, '($#,##0.0)'],
    ['Implied Equity Value', dcfSummary.equityValueGordonGrowth, dcfSummary.equityValueExitMultiple, '$#,##0.0', true],
    ['Diluted Shares Outstanding', dcfAssumptions.sharesOutstanding, dcfAssumptions.sharesOutstanding, '#,##0.0'],
    ['Implied Target Share Price', dcfSummary.impliedSharePriceGordon, dcfSummary.impliedSharePriceMultiple, '$#,##0.00', true, true],
    ['Current Market Share Price', dcfAssumptions.currentSharePrice, dcfAssumptions.currentSharePrice, '$#,##0.00'],
    ['Implied Upside / (Downside) %', dcfSummary.upsideGordonPercent, dcfSummary.upsideMultiplePercent, '0.0%', true],
  ];

  bridgeItems.forEach((item, idx) => {
    const rowNum = bridgeStartRow + 2 + idx;
    dcfSheet.mergeCells(`F${rowNum}:G${rowNum}`);
    dcfSheet.mergeCells(`H${rowNum}:J${rowNum}`);
    dcfSheet.mergeCells(`K${rowNum}:L${rowNum}`);

    const labelCell = dcfSheet.getCell(`F${rowNum}`);
    const gordonCell = dcfSheet.getCell(`H${rowNum}`);
    const multCell = dcfSheet.getCell(`K${rowNum}`);

    labelCell.value = item[0];
    gordonCell.value = item[1];
    multCell.value = item[2];

    const fmt = item[3] as string;
    gordonCell.numFmt = fmt;
    multCell.numFmt = fmt;

    const isBold = item[4] as boolean;
    const isBig = item[5] as boolean;

    labelCell.font = { name: 'Calibri', size: isBig ? 11 : 10, bold: isBold };
    gordonCell.font = { name: 'Calibri', size: isBig ? 11 : 10, bold: isBold };
    multCell.font = { name: 'Calibri', size: isBig ? 11 : 10, bold: isBold };

    if (isBig) {
      gordonCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.HIGHLIGHT_GREEN } };
      multCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.HIGHLIGHT_GREEN } };
    }
  });

  dcfSheet.columns = [
    { width: 4 },
    { width: 34 },
    { width: 16 },
    { width: 14 },
    { width: 4 },
    { width: 36 },
    { width: 15 },
    { width: 15 },
    { width: 15 },
    { width: 15 },
    { width: 15 },
    { width: 15 },
  ];

  // SHEET 2: LBO Model
  const lboSheet = workbook.addWorksheet('LBO Model', {
    views: [{ showGridLines: true }]
  });

  lboSheet.mergeCells('B2:H2');
  const lboTitle = lboSheet.getCell('B2');
  lboTitle.value = `${lboAssumptions.dealName.toUpperCase()} - LEVERAGED BUYOUT (LBO) TRANSACTION MODEL`;
  lboTitle.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFF' } };
  lboTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.NAVY_HEADER } };
  lboTitle.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  lboSheet.getRow(2).height = 28;

  // Skala dibaca dari modelnya, tidak ditulis tetap. Baris ini sempat berbunyi
  // "in Millions" untuk tiap model yang pernah diekspor dari sini, dan semuanya
  // berskala miliar — sebuah workbook hidup lebih lama daripada layar asalnya,
  // jadi keterangan satuan yang salah di dalamnya akan dikutip orang nanti.
  const lboScale = ({ billions: 'Billions', millions: 'Millions', thousands: 'Thousands', exact: 'units' } as Record<string, string>)[
    lboAssumptions.units ?? 'billions'
  ];
  lboSheet.getCell('B3').value = `Holding Period: ${lboAssumptions.holdPeriodYears} Years | Currency: ${lboAssumptions.currency} in ${lboScale}`;
  lboSheet.getCell('B3').font = { name: 'Calibri', size: 10, italic: true, color: { argb: '555555' } };

  lboSheet.getCell('B5').value = 'I. SOURCES & USES OF FUNDS';
  lboSheet.getCell('B5').font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFF' } };
  lboSheet.getCell('B5').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.NAVY_SUBHEADER } };
  lboSheet.mergeCells('B5:D5');

  const suHeaders = ['Sources of Funds', `Amount ${UNIT_TAG}`, '% Total', 'Uses of Funds', `Amount ${UNIT_TAG}`, '% Total'];
  ['B', 'C', 'D'].forEach((col, idx) => {
    const cell = lboSheet.getCell(`${col}6`);
    cell.value = suHeaders[idx];
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.NAVY_HEADER } };
  });
  ['F', 'G', 'H'].forEach((col, idx) => {
    const cell = lboSheet.getCell(`${col}6`);
    cell.value = suHeaders[idx + 3];
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.NAVY_HEADER } };
  });

  const su = lboSummary.sourcesAndUses;
  const sourcesData = [
    [`Senior Secured Term Loan (${lboAssumptions.seniorDebtMultiple.toFixed(1)}x EBITDA)`, su.seniorDebtAmount, su.seniorDebtAmount / su.totalSources],
    [`Subordinated / Mezzanine Debt (${lboAssumptions.subDebtMultiple.toFixed(1)}x EBITDA)`, su.subDebtAmount, su.subDebtAmount / su.totalSources],
    ['Sponsor Equity Contribution (Plug)', su.sponsorEquity, su.sponsorEquityPercent, true],
    ['Total Sources of Funds', su.totalSources, 1.0, true],
  ];

  const usesData = [
    [`Target Enterprise Value (${lboAssumptions.entryEvEbitdaMultiple.toFixed(1)}x EBITDA)`, su.enterpriseValue, su.enterpriseValue / su.totalUses],
    ['M&A Advisory & Legal Fees', su.advisoryFees, su.advisoryFees / su.totalUses],
    ['Financing & Debt Arrangement Fees', su.financingFees, su.financingFees / su.totalUses],
    ['Total Uses of Funds', su.totalUses, 1.0, true],
  ];

  sourcesData.forEach((row, idx) => {
    const rowNum = 7 + idx;
    lboSheet.getCell(`B${rowNum}`).value = row[0];
    lboSheet.getCell(`C${rowNum}`).value = row[1];
    lboSheet.getCell(`D${rowNum}`).value = row[2];

    lboSheet.getCell(`C${rowNum}`).numFmt = '$#,##0.0';
    lboSheet.getCell(`D${rowNum}`).numFmt = '0.0%';

    const isBold = row[3] as boolean;
    if (isBold) {
      lboSheet.getCell(`B${rowNum}`).font = { bold: true };
      lboSheet.getCell(`C${rowNum}`).font = { bold: true };
      lboSheet.getCell(`D${rowNum}`).font = { bold: true };
    }
  });

  usesData.forEach((row, idx) => {
    const rowNum = 7 + idx;
    lboSheet.getCell(`F${rowNum}`).value = row[0];
    lboSheet.getCell(`G${rowNum}`).value = row[1];
    lboSheet.getCell(`H${rowNum}`).value = row[2];

    lboSheet.getCell(`G${rowNum}`).numFmt = '$#,##0.0';
    lboSheet.getCell(`H${rowNum}`).numFmt = '0.0%';

    const isBold = row[3] as boolean;
    if (isBold) {
      lboSheet.getCell(`F${rowNum}`).font = { bold: true };
      lboSheet.getCell(`G${rowNum}`).font = { bold: true };
      lboSheet.getCell(`H${rowNum}`).font = { bold: true };
    }
  });

  // Debt Schedule
  const debtStartRow = 13;
  lboSheet.getCell(`B${debtStartRow}`).value = 'II. OPERATIONAL FORECAST & DEBT PAYDOWN WATERFALL';
  lboSheet.getCell(`B${debtStartRow}`).font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFF' } };
  lboSheet.getCell(`B${debtStartRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.NAVY_SUBHEADER } };
  lboSheet.mergeCells(`B${debtStartRow}:I${debtStartRow}`);

  const lboHeaders = [`Line Item ${UNIT_TAG}`, 'LTM Base', ...lboSummary.schedules.map(s => `Year ${s.year}`)];
  lboHeaders.forEach((h, colIdx) => {
    const colLetter = String.fromCharCode(66 + colIdx);
    const cell = lboSheet.getCell(`${colLetter}${debtStartRow + 1}`);
    cell.value = h;
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.NAVY_HEADER } };
    cell.alignment = { horizontal: colIdx === 0 ? 'left' : 'right' };
  });

  const lboRows = [
    { label: 'Revenue', base: lboAssumptions.targetLtmRevenue, getVal: (s: any) => s.revenue, fmt: '$#,##0.0' },
    { label: 'EBITDA', base: lboAssumptions.targetLtmEbitda, getVal: (s: any) => s.ebitda, fmt: '$#,##0.0', bold: true },
    { label: 'Less: D&A', base: '-', getVal: (s: any) => -s.da, fmt: '($#,##0.0)' },
    { label: 'Operating Income (EBIT)', base: '-', getVal: (s: any) => s.ebit, fmt: '$#,##0.0' },
    { label: 'Less: Total Interest Expense', base: '-', getVal: (s: any) => -s.totalInterestExpense, fmt: '($#,##0.0)' },
    { label: 'Earnings Before Taxes (EBT)', base: '-', getVal: (s: any) => s.ebt, fmt: '$#,##0.0' },
    { label: 'Less: Taxes', base: '-', getVal: (s: any) => -s.tax, fmt: '($#,##0.0)' },
    { label: 'Net Income', base: '-', getVal: (s: any) => s.netIncome, fmt: '$#,##0.0' },
    { label: 'Plus: D&A Non-Cash', base: '-', getVal: (s: any) => s.da, fmt: '$#,##0.0' },
    { label: 'Less: CapEx', base: '-', getVal: (s: any) => -s.capex, fmt: '($#,##0.0)' },
    { label: 'Less: ΔNWC', base: '-', getVal: (s: any) => -s.deltaNwc, fmt: '($#,##0.0)' },
    { label: 'Free Cash Flow Before Debt Service (CFADS)', base: '-', getVal: (s: any) => s.freeCashFlowBeforeDebt, fmt: '$#,##0.0', highlight: true },
    { label: '--- SENIOR DEBT SCHEDULE ---', base: '', getVal: () => '', fmt: '', section: true },
    { label: '  Senior Debt Beginning Balance', base: su.seniorDebtAmount, getVal: (s: any) => s.seniorDebt.beginningBalance, fmt: '$#,##0.0' },
    { label: '  Less: Mandatory Amortization', base: '-', getVal: (s: any) => -s.seniorDebt.mandatoryAmortization, fmt: '($#,##0.0)' },
    { label: '  Less: Optional Cash Sweep Prepayment', base: '-', getVal: (s: any) => -s.seniorDebt.optionalPrepayment, fmt: '($#,##0.0)' },
    { label: '  Senior Debt Ending Balance', base: '-', getVal: (s: any) => s.seniorDebt.endingBalance, fmt: '$#,##0.0', bold: true },
    { label: '--- SUBORDINATED DEBT SCHEDULE ---', base: '', getVal: () => '', fmt: '', section: true },
    { label: '  Sub Debt Beginning Balance', base: su.subDebtAmount, getVal: (s: any) => s.subDebt.beginningBalance, fmt: '$#,##0.0' },
    { label: '  Less: Mandatory Amortization', base: '-', getVal: (s: any) => -s.subDebt.mandatoryAmortization, fmt: '($#,##0.0)' },
    { label: '  Sub Debt Ending Balance', base: '-', getVal: (s: any) => s.subDebt.endingBalance, fmt: '$#,##0.0', bold: true },
    { label: '--- SUMMARY DEBT & RATIOS ---', base: '', getVal: () => '', fmt: '', section: true },
    { label: 'Total Ending Debt Outstanding', base: su.totalDebtRaised, getVal: (s: any) => s.totalEndingDebt, fmt: '$#,##0.0', bold: true },
    { label: 'Ending Cash Balance', base: lboAssumptions.minCashBalance, getVal: (s: any) => s.cashEnding, fmt: '$#,##0.0' },
    { label: 'Ending Net Debt', base: su.totalDebtRaised, getVal: (s: any) => s.netDebt, fmt: '$#,##0.0', bold: true },
    { label: 'Leverage Ratio (Net Debt / EBITDA)', base: su.totalDebtMultiple, getVal: (s: any) => s.leverageRatio, fmt: '0.0"x"' },
    { label: 'Interest Coverage Ratio (EBITDA / Interest)', base: '-', getVal: (s: any) => s.interestCoverageRatio, fmt: '0.0"x"' },
  ];

  lboRows.forEach((row, rIdx) => {
    const rowNum = debtStartRow + 2 + rIdx;
    const labelCell = lboSheet.getCell(`B${rowNum}`);
    labelCell.value = row.label;

    if (row.section) {
      labelCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: '777777' } };
      return;
    }

    labelCell.font = { name: 'Calibri', size: 10, bold: row.bold || row.highlight };

    const baseCell = lboSheet.getCell(`C${rowNum}`);
    baseCell.value = row.base;
    if (typeof row.base === 'number') baseCell.numFmt = row.fmt;
    baseCell.alignment = { horizontal: 'right' };

    lboSummary.schedules.forEach((s, cIdx) => {
      const colLetter = String.fromCharCode(68 + cIdx);
      const cell = lboSheet.getCell(`${colLetter}${rowNum}`);
      const val = row.getVal(s);
      cell.value = val;
      cell.numFmt = row.fmt;
      cell.font = { name: 'Calibri', size: 10, bold: row.bold || row.highlight };
      cell.alignment = { horizontal: 'right' };

      if (row.highlight) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.HIGHLIGHT_GOLD } };
      }
    });
  });

  // Returns Summary
  const retStartRow = debtStartRow + 2 + lboRows.length + 2;
  lboSheet.getCell(`B${retStartRow}`).value = 'III. EXIT VALUATION & SPONSOR RETURNS (IRR & MoIC)';
  lboSheet.getCell(`B${retStartRow}`).font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFF' } };
  lboSheet.getCell(`B${retStartRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.NAVY_SUBHEADER } };
  lboSheet.mergeCells(`B${retStartRow}:D${retStartRow}`);

  const returnItems = [
    ['Exit Year', `Year ${lboSummary.exitYear}`, '@'],
    [`Exit EBITDA ${UNIT_TAG}`, lboSummary.exitEbitda, '$#,##0.0'],
    ['Exit EV / EBITDA Multiple', lboAssumptions.exitEvEbitdaMultiple, '0.0"x"'],
    [`Exit Enterprise Value ${UNIT_TAG}`, lboSummary.exitEnterpriseValue, '$#,##0.0'],
    [`Less: Ending Net Debt ${UNIT_TAG}`, -lboSummary.endingNetDebt, '($#,##0.0)'],
    [`Ending Equity Value to Sponsor ${UNIT_TAG}`, lboSummary.exitEquityValue, '$#,##0.0', true],
    [`Initial Sponsor Equity Invested ${UNIT_TAG}`, -lboSummary.initialSponsorEquity, '($#,##0.0)'],
    ['Multiple on Invested Capital (MoIC / CoC)', lboSummary.sponsorMoIC, '0.00"x"', true, true],
    ['Sponsor Internal Rate of Return (IRR % p.a.)', lboSummary.sponsorIRR, '0.0%', true, true],
  ];

  returnItems.forEach((item, idx) => {
    const rowNum = retStartRow + 1 + idx;
    const labelCell = lboSheet.getCell(`B${rowNum}`);
    const valCell = lboSheet.getCell(`C${rowNum}`);

    labelCell.value = item[0];
    valCell.value = item[1];
    valCell.numFmt = item[2] as string;

    const isBold = item[3] as boolean;
    const isBig = item[4] as boolean;

    labelCell.font = { name: 'Calibri', size: isBig ? 11 : 10, bold: isBold };
    valCell.font = { name: 'Calibri', size: isBig ? 11 : 10, bold: isBold };

    if (isBig) {
      valCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.HIGHLIGHT_GREEN } };
    }
  });

  lboSheet.columns = [
    { width: 4 },
    { width: 38 },
    { width: 16 },
    { width: 16 },
    { width: 4 },
    { width: 36 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
  ];

  applyCurrencySymbol(workbook, dcfAssumptions.currency);
  return workbook;
}

/** Nama berkas unduhan. Diekspor supaya bisa diuji tanpa menyentuh DOM. */
export function financialModelFilename(companyName: string): string {
  return `Financial_Model_${companyName.replace(/\s+/g, '_')}_DCF_LBO.xlsx`;
}

export async function exportFinancialModelToExcel(
  dcfAssumptions: DcfAssumptions,
  dcfSummary: DcfValuationSummary,
  lboAssumptions: LboAssumptions,
  lboSummary: LboReturnsSummary
) {
  const workbook = await buildFinancialModelWorkbook(dcfAssumptions, dcfSummary, lboAssumptions, lboSummary);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  // Diimpor di sini, bukan di puncak berkas — lihat catatan yang sama di
  // pickReport.ts.
  const { saveAs } = await import('file-saver');
  saveAs(blob, financialModelFilename(dcfAssumptions.companyName));
}
