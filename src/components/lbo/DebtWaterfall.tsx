import React from 'react';
import { LboYearSchedule, SourcesAndUses } from '../../types/lbo';
import { formatCurrency, formatMultiple } from '../../utils/formatters';

interface DebtWaterfallProps {
  schedules: LboYearSchedule[];
  sourcesAndUses: SourcesAndUses;
  currency: string;
}

export const DebtWaterfallComponent: React.FC<DebtWaterfallProps> = ({
  schedules,
  sourcesAndUses: su,
  currency,
}) => {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
      <div className="p-4 border-b border-slate-800 flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200">
          Operational Forecast & Debt Paydown Schedule
        </h3>
        <span className="text-xs text-slate-400 font-mono">Currency: {currency} (Millions)</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left border-collapse">
          <thead>
            <tr className="bg-slate-950 border-b border-slate-800 text-slate-400 font-semibold">
              <th className="p-3 pl-4">Line Item ({currency.trim()})</th>
              <th className="p-3 text-right font-mono text-slate-400">Entry / LTM</th>
              {schedules.map((s) => (
                <th key={s.year} className="p-3 text-right font-mono text-slate-200">
                  Year {s.year}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-mono">
            
            {/* Operating Performance */}
            <tr className="hover:bg-slate-800/40">
              <td className="p-2.5 pl-4 font-sans font-semibold text-slate-200">Revenue</td>
              <td className="p-2.5 text-right text-slate-400">-</td>
              {schedules.map(s => (
                <td key={s.year} className="p-2.5 text-right font-bold text-slate-100">
                  {formatCurrency(s.revenue, currency, 1)}
                </td>
              ))}
            </tr>

            <tr className="hover:bg-slate-800/40 bg-slate-950/20">
              <td className="p-2.5 pl-4 font-sans font-bold text-blue-300">EBITDA</td>
              <td className="p-2.5 text-right text-blue-400 font-bold">-</td>
              {schedules.map(s => (
                <td key={s.year} className="p-2.5 text-right font-bold text-blue-300">
                  {formatCurrency(s.ebitda, currency, 1)}
                </td>
              ))}
            </tr>

            <tr className="hover:bg-slate-800/40 text-slate-400">
              <td className="p-2 pl-6 font-sans text-slate-400">Less: Total Interest Expense</td>
              <td className="p-2 text-right text-slate-400">-</td>
              {schedules.map(s => (
                <td key={s.year} className="p-2 text-right text-rose-400">
                  ({formatCurrency(s.totalInterestExpense, currency, 1)})
                </td>
              ))}
            </tr>

            <tr className="hover:bg-slate-800/40 text-slate-400">
              <td className="p-2 pl-6 font-sans text-slate-400">Less: Taxes Paid</td>
              <td className="p-2 text-right text-slate-400">-</td>
              {schedules.map(s => (
                <td key={s.year} className="p-2 text-right text-rose-400">
                  ({formatCurrency(s.tax, currency, 1)})
                </td>
              ))}
            </tr>

            <tr className="hover:bg-slate-800/40 bg-emerald-950/30">
              <td className="p-2.5 pl-4 font-sans font-bold text-emerald-300">Cash Flow Avail. for Debt (CFADS)</td>
              <td className="p-2.5 text-right text-slate-400">-</td>
              {schedules.map(s => (
                <td key={s.year} className="p-2.5 text-right font-bold text-emerald-300">
                  {formatCurrency(s.freeCashFlowBeforeDebt, currency, 1)}
                </td>
              ))}
            </tr>

            {/* TRANCHE A: Senior Debt */}
            <tr className="bg-slate-950/80">
              <td colSpan={schedules.length + 2} className="p-2 pl-4 font-sans text-[11px] font-bold text-blue-400 uppercase tracking-wider">
                Tranche A: Senior Secured Debt Schedule
              </td>
            </tr>

            <tr className="hover:bg-slate-800/40 text-slate-300">
              <td className="p-2 pl-6 font-sans">Beginning Senior Debt</td>
              <td className="p-2 text-right text-blue-300 font-bold">{formatCurrency(su.seniorDebtAmount, currency, 1)}</td>
              {schedules.map(s => (
                <td key={s.year} className="p-2 text-right">{formatCurrency(s.seniorDebt.beginningBalance, currency, 1)}</td>
              ))}
            </tr>

            <tr className="hover:bg-slate-800/40 text-slate-400">
              <td className="p-2 pl-8 font-sans">Less: Mandatory Amortization</td>
              <td className="p-2 text-right text-slate-400">-</td>
              {schedules.map(s => (
                <td key={s.year} className="p-2 text-right text-amber-400">({formatCurrency(s.seniorDebt.mandatoryAmortization, currency, 1)})</td>
              ))}
            </tr>

            <tr className="hover:bg-slate-800/40 text-slate-400">
              <td className="p-2 pl-8 font-sans">Less: Optional Cash Sweep Prepayment</td>
              <td className="p-2 text-right text-slate-400">-</td>
              {schedules.map(s => (
                <td key={s.year} className="p-2 text-right text-emerald-400">({formatCurrency(s.seniorDebt.optionalPrepayment, currency, 1)})</td>
              ))}
            </tr>

            <tr className="hover:bg-slate-800/40 font-bold text-slate-100">
              <td className="p-2 pl-6 font-sans">Ending Senior Debt</td>
              <td className="p-2 text-right text-slate-400">-</td>
              {schedules.map(s => (
                <td key={s.year} className="p-2 text-right text-blue-300">{formatCurrency(s.seniorDebt.endingBalance, currency, 1)}</td>
              ))}
            </tr>

            {/* TRANCHE B: Sub Debt */}
            <tr className="bg-slate-950/80">
              <td colSpan={schedules.length + 2} className="p-2 pl-4 font-sans text-[11px] font-bold text-amber-400 uppercase tracking-wider">
                Tranche B: Subordinated Debt Schedule
              </td>
            </tr>

            <tr className="hover:bg-slate-800/40 text-slate-300">
              <td className="p-2 pl-6 font-sans">Beginning Subordinated Debt</td>
              <td className="p-2 text-right text-amber-300 font-bold">{formatCurrency(su.subDebtAmount, currency, 1)}</td>
              {schedules.map(s => (
                <td key={s.year} className="p-2 text-right">{formatCurrency(s.subDebt.beginningBalance, currency, 1)}</td>
              ))}
            </tr>

            <tr className="hover:bg-slate-800/40 font-bold text-slate-100">
              <td className="p-2 pl-6 font-sans">Ending Subordinated Debt</td>
              <td className="p-2 text-right text-slate-400">-</td>
              {schedules.map(s => (
                <td key={s.year} className="p-2 text-right text-amber-300">{formatCurrency(s.subDebt.endingBalance, currency, 1)}</td>
              ))}
            </tr>

            {/* Summary Ratios */}
            <tr className="bg-slate-950 border-t border-slate-800">
              <td className="p-2.5 pl-4 font-sans font-bold text-slate-200">Total Ending Debt</td>
              <td className="p-2.5 text-right font-bold text-slate-200">{formatCurrency(su.totalDebtRaised, currency, 1)}</td>
              {schedules.map(s => (
                <td key={s.year} className="p-2.5 text-right font-bold text-slate-200">
                  {formatCurrency(s.totalEndingDebt, currency, 1)}
                </td>
              ))}
            </tr>

            <tr className="hover:bg-slate-800/40">
              <td className="p-2 pl-4 font-sans text-slate-300">Ending Net Debt</td>
              <td className="p-2 text-right text-slate-300">{formatCurrency(su.totalDebtRaised, currency, 1)}</td>
              {schedules.map(s => (
                <td key={s.year} className="p-2 text-right font-bold text-indigo-300">
                  {formatCurrency(s.netDebt, currency, 1)}
                </td>
              ))}
            </tr>

            <tr className="hover:bg-slate-800/40">
              <td className="p-2 pl-4 font-sans text-slate-400">Leverage (Net Debt / EBITDA)</td>
              <td className="p-2 text-right text-slate-400">{formatMultiple(su.totalDebtMultiple, 2)}</td>
              {schedules.map(s => (
                <td key={s.year} className="p-2 text-right text-slate-300">
                  {formatMultiple(s.leverageRatio, 2)}
                </td>
              ))}
            </tr>

            <tr className="hover:bg-slate-800/40">
              <td className="p-2 pl-4 font-sans text-slate-400">Interest Coverage (EBITDA / Int.)</td>
              <td className="p-2 text-right text-slate-400">-</td>
              {schedules.map(s => (
                <td key={s.year} className="p-2 text-right text-emerald-400">
                  {s.interestCoverageRatio.toFixed(1)}x
                </td>
              ))}
            </tr>

          </tbody>
        </table>
      </div>
    </div>
  );
};
