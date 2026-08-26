import React from 'react';
import { LboReturnsSummary } from '../../types/lbo';
import { formatCurrency, formatPercent, formatMultiple } from '../../utils/formatters';
import { Award, Zap, PieChart } from 'lucide-react';

interface ReturnsSummaryProps {
  summary: LboReturnsSummary;
  currency: string;
}

export const ReturnsSummaryComponent: React.FC<ReturnsSummaryProps> = ({
  summary,
  currency,
}) => {
  const totalValueCreation = summary.ebitdaGrowthImpact + summary.multipleExpansionImpact + summary.debtPaydownImpact;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      
      {/* 1. Main Return KPI Card */}
      <div className="bg-gradient-to-br from-indigo-950/80 via-slate-900 to-slate-900 border border-indigo-500/40 rounded-xl p-5 shadow-xl flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between pb-3 border-b border-indigo-500/20">
            <div className="flex items-center gap-2 text-indigo-400">
              <Award className="w-5 h-5" />
              <h3 className="text-sm font-bold uppercase tracking-wider text-white">Sponsor Returns</h3>
            </div>
            <span className="text-xs px-2.5 py-1 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-md font-mono">
              Hold: {summary.exitYear} Years
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 my-4">
            <div className="p-3 bg-slate-950/80 rounded-xl border border-indigo-500/30">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Sponsor IRR</span>
              <div className="text-3xl font-black font-mono text-emerald-400 mt-1">
                {formatPercent(summary.sponsorIRR, 1)}
              </div>
              <span className="text-[10px] text-slate-500 mt-0.5 block">% per annum</span>
            </div>

            <div className="p-3 bg-slate-950/80 rounded-xl border border-indigo-500/30">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Sponsor MoIC</span>
              <div className="text-3xl font-black font-mono text-blue-400 mt-1">
                {formatMultiple(summary.sponsorMoIC, 2)}
              </div>
              <span className="text-[10px] text-slate-500 mt-0.5 block">Cash-on-Cash multiple</span>
            </div>
          </div>

          <div className="space-y-2 text-xs font-mono">
            <div className="flex justify-between py-1 border-b border-slate-800/60">
              <span className="font-sans text-slate-400">Initial Sponsor Equity</span>
              <span className="text-slate-200">{formatCurrency(summary.initialSponsorEquity, currency, 1)}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-800/60">
              <span className="font-sans text-slate-400">Exit Enterprise Value</span>
              <span className="text-slate-200">{formatCurrency(summary.exitEnterpriseValue, currency, 1)}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-800/60">
              <span className="font-sans text-slate-400">Less: Ending Net Debt</span>
              <span className="text-rose-400">- {formatCurrency(summary.endingNetDebt, currency, 1)}</span>
            </div>
            <div className="flex justify-between py-1.5 bg-indigo-950/40 px-2 rounded font-bold">
              <span className="font-sans text-white">Exit Equity Value</span>
              <span className="text-emerald-300">{formatCurrency(summary.exitEquityValue, currency, 1)}</span>
            </div>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
          <span>Net Profit Generated:</span>
          <span className="font-mono font-bold text-emerald-400">
            +{formatCurrency(summary.exitEquityValue - summary.initialSponsorEquity, currency, 1)}
          </span>
        </div>
      </div>

      {/* 2. Value Creation & Returns Attribution */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-2 pb-3 border-b border-slate-800 text-blue-400">
            <PieChart className="w-4 h-4" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200">Value Creation Drivers</h3>
          </div>

          <div className="space-y-4 my-4">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-300 font-semibold">1. EBITDA Growth</span>
                <span className="font-mono text-blue-400 font-bold">{formatCurrency(summary.ebitdaGrowthImpact, currency, 1)}</span>
              </div>
              <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden">
                <div
                  className="bg-blue-500 h-full rounded-full"
                  style={{ width: `${Math.min(Math.max((summary.ebitdaGrowthImpact / (totalValueCreation || 1)) * 100, 0), 100)}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-300 font-semibold">2. Multiple Expansion</span>
                <span className="font-mono text-amber-400 font-bold">{formatCurrency(summary.multipleExpansionImpact, currency, 1)}</span>
              </div>
              <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden">
                <div
                  className="bg-amber-500 h-full rounded-full"
                  style={{ width: `${Math.min(Math.max((summary.multipleExpansionImpact / (totalValueCreation || 1)) * 100, 0), 100)}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-300 font-semibold">3. Debt Paydown / De-leveraging</span>
                <span className="font-mono text-emerald-400 font-bold">{formatCurrency(summary.debtPaydownImpact, currency, 1)}</span>
              </div>
              <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden">
                <div
                  className="bg-emerald-500 h-full rounded-full"
                  style={{ width: `${Math.min(Math.max((summary.debtPaydownImpact / (totalValueCreation || 1)) * 100, 0), 100)}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-xs text-slate-400 flex justify-between items-center">
          <span>Exit Multiple vs Entry:</span>
          <span className="font-mono font-bold text-slate-200">
            {summary.exitMultiple.toFixed(1)}x vs {summary.sourcesAndUses.enterpriseValue / (summary.exitEbitda || 1) > 0 ? (summary.sourcesAndUses.enterpriseValue / summary.exitEbitda).toFixed(1) : '-'}x
          </span>
        </div>
      </div>

      {/* 3. Exit Multiples & Deal Multipliers */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-2 pb-3 border-b border-slate-800 text-emerald-400">
            <Zap className="w-4 h-4" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200">Exit Profile & Valuation</h3>
          </div>

          <div className="space-y-3 my-4 text-xs font-mono">
            <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 flex justify-between items-center">
              <span className="font-sans text-slate-400">Exit Year EBITDA</span>
              <span className="text-sm font-bold text-slate-100">{formatCurrency(summary.exitEbitda, currency, 1)}</span>
            </div>

            <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 flex justify-between items-center">
              <span className="font-sans text-slate-400">Exit EV / EBITDA</span>
              <span className="text-sm font-bold text-indigo-400">{summary.exitMultiple.toFixed(1)}x</span>
            </div>

            <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 flex justify-between items-center">
              <span className="font-sans text-slate-400">Deleveraging Achieved</span>
              <span className="text-sm font-bold text-emerald-400">
                {formatCurrency(summary.sourcesAndUses.totalDebtRaised - summary.endingNetDebt, currency, 1)}
              </span>
            </div>
          </div>
        </div>

        <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-[11px] text-slate-400 flex justify-between items-center">
          <span>Exit Equity % of Exit EV:</span>
          <span className="font-mono font-bold text-slate-200">
            {summary.exitEnterpriseValue > 0 ? formatPercent(summary.exitEquityValue / summary.exitEnterpriseValue, 1) : '-'}
          </span>
        </div>
      </div>

    </div>
  );
};
