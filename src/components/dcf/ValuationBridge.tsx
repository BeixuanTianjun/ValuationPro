import React from 'react';
import { DcfAssumptions, DcfValuationSummary } from '../../types/dcf';
import { formatCurrency, formatPercent } from '../../utils/formatters';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface ValuationBridgeProps {
  assumptions: DcfAssumptions;
  summary: DcfValuationSummary;
}

export const ValuationBridge: React.FC<ValuationBridgeProps> = ({
  assumptions,
  summary,
}) => {
  const isUpsideGordon = summary.upsideGordonPercent >= 0;
  const isUpsideMultiple = summary.upsideMultiplePercent >= 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      
      {/* METHOD 1: Gordon Growth Model */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div>
              <span className="text-[10px] font-bold tracking-wider text-blue-400 uppercase">Method 1</span>
              <h3 className="text-base font-bold text-white">Gordon Growth Valuation</h3>
            </div>
            <span className="text-xs px-2.5 py-1 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-md font-mono">
              g = {formatPercent(assumptions.perpetualGrowthRate, 2)}
            </span>
          </div>

          <div className="my-4 p-4 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-400 block font-medium">Implied Target Share Price</span>
              <div className="text-3xl font-extrabold font-mono text-white mt-0.5">
                {formatCurrency(summary.impliedSharePriceGordon, assumptions.currency, 2)}
              </div>
              <span className="text-xs text-slate-400">
                Market: {formatCurrency(assumptions.currentSharePrice, assumptions.currency, 2)}
              </span>
            </div>

            <div className={`flex items-center gap-1 px-3 py-1.5 rounded-lg font-mono font-bold text-sm border ${
              isUpsideGordon
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
            }`}>
              {isUpsideGordon ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
              <span>{formatPercent(summary.upsideGordonPercent, 1)}</span>
            </div>
          </div>

          <div className="space-y-2 text-xs font-mono">
            <div className="flex justify-between py-1.5 border-b border-slate-800/60">
              <span className="font-sans text-slate-400">PV of 5-Yr Discrete Cash Flows</span>
              <span className="text-slate-200">{formatCurrency(summary.pvDiscreteCashFlows, assumptions.currency, 1)}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-800/60">
              <span className="font-sans text-slate-400">PV of Terminal Growth Value</span>
              <span className="text-slate-200">{formatCurrency(summary.pvTerminalGrowthValue, assumptions.currency, 1)}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-800/60 font-bold">
              <span className="font-sans text-blue-300">Implied Enterprise Value (EV)</span>
              <span className="text-blue-300">{formatCurrency(summary.evGordonGrowth, assumptions.currency, 1)}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-800/60">
              <span className="font-sans text-slate-400">Plus: Cash & Equivalents</span>
              <span className="text-emerald-400">+{formatCurrency(assumptions.balanceSheetCash, assumptions.currency, 1)}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-800/60">
              <span className="font-sans text-slate-400">Less: Total Debt & Minority Int.</span>
              <span className="text-rose-400">- {formatCurrency(assumptions.balanceSheetDebt + assumptions.minorityInterest, assumptions.currency, 1)}</span>
            </div>
            <div className="flex justify-between py-2 bg-slate-950/60 px-2 rounded font-bold">
              <span className="font-sans text-white">Implied Equity Value</span>
              <span className="text-white">{formatCurrency(summary.equityValueGordonGrowth, assumptions.currency, 1)}</span>
            </div>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
          <span>Terminal Value % of EV:</span>
          <span className="font-mono font-bold text-slate-300">
            {summary.evGordonGrowth > 0 ? formatPercent(summary.pvTerminalGrowthValue / summary.evGordonGrowth, 1) : '-'}
          </span>
        </div>
      </div>

      {/* METHOD 2: Exit Multiple Method */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div>
              <span className="text-[10px] font-bold tracking-wider text-indigo-400 uppercase">Method 2</span>
              <h3 className="text-base font-bold text-white">Exit Multiple Valuation</h3>
            </div>
            <span className="text-xs px-2.5 py-1 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-md font-mono">
              {assumptions.exitMultiple.toFixed(1)}x EV/EBITDA
            </span>
          </div>

          <div className="my-4 p-4 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-400 block font-medium">Implied Target Share Price</span>
              <div className="text-3xl font-extrabold font-mono text-white mt-0.5">
                {formatCurrency(summary.impliedSharePriceMultiple, assumptions.currency, 2)}
              </div>
              <span className="text-xs text-slate-400">
                Market: {formatCurrency(assumptions.currentSharePrice, assumptions.currency, 2)}
              </span>
            </div>

            <div className={`flex items-center gap-1 px-3 py-1.5 rounded-lg font-mono font-bold text-sm border ${
              isUpsideMultiple
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
            }`}>
              {isUpsideMultiple ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
              <span>{formatPercent(summary.upsideMultiplePercent, 1)}</span>
            </div>
          </div>

          <div className="space-y-2 text-xs font-mono">
            <div className="flex justify-between py-1.5 border-b border-slate-800/60">
              <span className="font-sans text-slate-400">PV of 5-Yr Discrete Cash Flows</span>
              <span className="text-slate-200">{formatCurrency(summary.pvDiscreteCashFlows, assumptions.currency, 1)}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-800/60">
              <span className="font-sans text-slate-400">PV of Terminal Multiple Value</span>
              <span className="text-slate-200">{formatCurrency(summary.pvTerminalMultipleValue, assumptions.currency, 1)}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-800/60 font-bold">
              <span className="font-sans text-indigo-300">Implied Enterprise Value (EV)</span>
              <span className="text-indigo-300">{formatCurrency(summary.evExitMultiple, assumptions.currency, 1)}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-800/60">
              <span className="font-sans text-slate-400">Plus: Cash & Equivalents</span>
              <span className="text-emerald-400">+{formatCurrency(assumptions.balanceSheetCash, assumptions.currency, 1)}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-800/60">
              <span className="font-sans text-slate-400">Less: Total Debt & Minority Int.</span>
              <span className="text-rose-400">- {formatCurrency(assumptions.balanceSheetDebt + assumptions.minorityInterest, assumptions.currency, 1)}</span>
            </div>
            <div className="flex justify-between py-2 bg-slate-950/60 px-2 rounded font-bold">
              <span className="font-sans text-white">Implied Equity Value</span>
              <span className="text-white">{formatCurrency(summary.equityValueExitMultiple, assumptions.currency, 1)}</span>
            </div>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
          <span>Terminal Value % of EV:</span>
          <span className="font-mono font-bold text-slate-300">
            {summary.evExitMultiple > 0 ? formatPercent(summary.pvTerminalMultipleValue / summary.evExitMultiple, 1) : '-'}
          </span>
        </div>
      </div>

    </div>
  );
};
