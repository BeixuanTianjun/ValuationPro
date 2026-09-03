import React from 'react';
import { DcfAssumptions, UfcfYearData } from '../../types/dcf';
import { amountLabel, formatCurrency, formatPercent } from '../../utils/formatters';

interface CashFlowTableProps {
  cashFlows: UfcfYearData[];
  currency: string;
  /** Skala model. DcfAssumptions selalu membawanya, jadi tidak perlu ditebak. */
  units: DcfAssumptions['units'];
}

export const CashFlowTable: React.FC<CashFlowTableProps> = ({
  cashFlows,
  currency,
  units,
}) => {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
      <div className="p-4 border-b border-slate-800 flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200">
          Unlevered Free Cash Flow (UFCF) Projections
        </h3>
        <span className="text-xs text-slate-400 font-mono">
          {amountLabel('Currency', currency, units)}
        </span>
      </div>

      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-xs text-left border-collapse">
          <thead>
            <tr className="bg-slate-950 border-b border-slate-800 text-slate-400 font-semibold">
              <th className="p-3 pl-4">Line Item ({currency.trim()})</th>
              {cashFlows.map((cf) => (
                <th key={cf.year} className="p-3 text-right font-mono text-slate-200">
                  {cf.yearLabel}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-mono">
            <tr className="hover:bg-slate-800/40">
              <td className="p-2.5 pl-4 font-sans font-semibold text-slate-200">Revenue</td>
              {cashFlows.map(cf => (
                <td key={cf.year} className="p-2.5 text-right font-bold text-slate-100">
                  {formatCurrency(cf.revenue, currency, 1)}
                </td>
              ))}
            </tr>

            <tr className="hover:bg-slate-800/40 text-slate-400">
              <td className="p-2 pl-6 font-sans italic text-slate-400">Growth YoY (%)</td>
              {cashFlows.map(cf => (
                <td key={cf.year} className="p-2 text-right text-slate-400">
                  {formatPercent(cf.revenueGrowth, 1)}
                </td>
              ))}
            </tr>

            <tr className="hover:bg-slate-800/40">
              <td className="p-2.5 pl-4 font-sans font-semibold text-slate-200">EBITDA</td>
              {cashFlows.map(cf => (
                <td key={cf.year} className="p-2.5 text-right font-bold text-blue-300">
                  {formatCurrency(cf.ebitda, currency, 1)}
                </td>
              ))}
            </tr>

            <tr className="hover:bg-slate-800/40 text-slate-400">
              <td className="p-2 pl-6 font-sans text-slate-400">Less: D&A</td>
              {cashFlows.map(cf => (
                <td key={cf.year} className="p-2 text-right text-slate-400">
                  ({formatCurrency(cf.da, currency, 1)})
                </td>
              ))}
            </tr>

            <tr className="hover:bg-slate-800/40">
              <td className="p-2.5 pl-4 font-sans font-semibold text-slate-200">Operating Income (EBIT)</td>
              {cashFlows.map(cf => (
                <td key={cf.year} className="p-2.5 text-right text-slate-200">
                  {formatCurrency(cf.ebit, currency, 1)}
                </td>
              ))}
            </tr>

            <tr className="hover:bg-slate-800/40 text-slate-400">
              <td className="p-2 pl-6 font-sans text-slate-400">Less: Taxes on EBIT</td>
              {cashFlows.map(cf => (
                <td key={cf.year} className="p-2 text-right text-rose-400">
                  ({formatCurrency(cf.taxesOnEbit, currency, 1)})
                </td>
              ))}
            </tr>

            <tr className="hover:bg-slate-800/40 bg-slate-950/30">
              <td className="p-2.5 pl-4 font-sans font-semibold text-slate-200">Net Operating Profit After Tax (NOPAT)</td>
              {cashFlows.map(cf => (
                <td key={cf.year} className="p-2.5 text-right font-semibold text-slate-200">
                  {formatCurrency(cf.nopat, currency, 1)}
                </td>
              ))}
            </tr>

            <tr className="hover:bg-slate-800/40 text-slate-400">
              <td className="p-2 pl-6 font-sans text-slate-400">Plus: D&A Addback</td>
              {cashFlows.map(cf => (
                <td key={cf.year} className="p-2 text-right text-slate-400">
                  {formatCurrency(cf.da, currency, 1)}
                </td>
              ))}
            </tr>

            <tr className="hover:bg-slate-800/40 text-slate-400">
              <td className="p-2 pl-6 font-sans text-slate-400">Less: CapEx</td>
              {cashFlows.map(cf => (
                <td key={cf.year} className="p-2 text-right text-amber-400">
                  ({formatCurrency(cf.capex, currency, 1)})
                </td>
              ))}
            </tr>

            <tr className="hover:bg-slate-800/40 text-slate-400">
              <td className="p-2 pl-6 font-sans text-slate-400">Less: ΔNWC</td>
              {cashFlows.map(cf => (
                <td key={cf.year} className="p-2 text-right text-slate-400">
                  ({formatCurrency(cf.deltaNwc, currency, 1)})
                </td>
              ))}
            </tr>

            <tr className="bg-emerald-950/40 border-y border-emerald-500/30">
              <td className="p-3 pl-4 font-sans font-bold text-emerald-300">Unlevered Free Cash Flow (UFCF)</td>
              {cashFlows.map(cf => (
                <td key={cf.year} className="p-3 text-right font-bold text-emerald-300 text-sm">
                  {formatCurrency(cf.ufcf, currency, 1)}
                </td>
              ))}
            </tr>

            <tr className="text-slate-400">
              <td className="p-2 pl-4 font-sans text-slate-400">Discount Factor (Mid-Year)</td>
              {cashFlows.map(cf => (
                <td key={cf.year} className="p-2 text-right text-slate-400">
                  {cf.discountFactor.toFixed(4)}
                </td>
              ))}
            </tr>

            <tr className="bg-slate-950/70">
              <td className="p-2.5 pl-4 font-sans font-bold text-blue-400">PV of UFCF</td>
              {cashFlows.map(cf => (
                <td key={cf.year} className="p-2.5 text-right font-bold text-blue-400">
                  {formatCurrency(cf.presentValueUfcf, currency, 1)}
                </td>
              ))}
            </tr>

          </tbody>
        </table>
      </div>
    </div>
  );
};
