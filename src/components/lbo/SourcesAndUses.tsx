import React from 'react';
import { SourcesAndUses } from '../../types/lbo';
import { formatCurrency, formatPercent } from '../../utils/formatters';
import { CheckCircle2, AlertCircle } from 'lucide-react';

interface SourcesAndUsesProps {
  sourcesAndUses: SourcesAndUses;
  currency: string;
}

export const SourcesAndUsesComponent: React.FC<SourcesAndUsesProps> = ({
  sourcesAndUses: su,
  currency,
}) => {
  const isBalanced = Math.abs(su.totalSources - su.totalUses) < 0.01;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl">
      <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200">
          Sources & Uses of Funds
        </h3>
        <div className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-md border ${
          isBalanced
            ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
            : 'bg-rose-500/10 text-rose-300 border-rose-500/20'
        }`}>
          {isBalanced ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
          <span>{isBalanced ? 'Balanced (100%)' : 'Unbalanced'}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* USES OF FUNDS */}
        <div className="bg-slate-950 rounded-xl border border-slate-800 p-4">
          <div className="flex justify-between items-center text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-slate-800 pb-2 mb-3">
            <span>Uses of Funds</span>
            <span>Amount ({currency.trim()}) / %</span>
          </div>

          <div className="space-y-2 text-xs font-mono">
            <div className="flex justify-between items-center py-1 border-b border-slate-800/40">
              <span className="font-sans text-slate-300">Target Enterprise Value</span>
              <div className="text-right">
                <span className="font-bold text-slate-100">{formatCurrency(su.enterpriseValue, currency, 1)}</span>
                <span className="text-[11px] text-slate-500 ml-2">({formatPercent(su.enterpriseValue / su.totalUses, 1)})</span>
              </div>
            </div>

            <div className="flex justify-between items-center py-1 border-b border-slate-800/40">
              <span className="font-sans text-slate-300">M&A Advisory & Legal Fees</span>
              <div className="text-right">
                <span className="text-slate-200">{formatCurrency(su.advisoryFees, currency, 1)}</span>
                <span className="text-[11px] text-slate-500 ml-2">({formatPercent(su.advisoryFees / su.totalUses, 1)})</span>
              </div>
            </div>

            <div className="flex justify-between items-center py-1 border-b border-slate-800/40">
              <span className="font-sans text-slate-300">Financing & Arrangement Fees</span>
              <div className="text-right">
                <span className="text-slate-200">{formatCurrency(su.financingFees, currency, 1)}</span>
                <span className="text-[11px] text-slate-500 ml-2">({formatPercent(su.financingFees / su.totalUses, 1)})</span>
              </div>
            </div>

            <div className="flex justify-between items-center pt-2 font-bold text-white">
              <span className="font-sans uppercase text-blue-400">Total Uses of Funds</span>
              <div className="text-right">
                <span className="text-sm text-blue-400">{formatCurrency(su.totalUses, currency, 1)}</span>
                <span className="text-[11px] text-blue-400 ml-2">(100.0%)</span>
              </div>
            </div>
          </div>
        </div>

        {/* SOURCES OF FUNDS */}
        <div className="bg-slate-950 rounded-xl border border-slate-800 p-4">
          <div className="flex justify-between items-center text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-slate-800 pb-2 mb-3">
            <span>Sources of Funds</span>
            <span>Amount ({currency.trim()}) / %</span>
          </div>

          <div className="space-y-2 text-xs font-mono">
            <div className="flex justify-between items-center py-1 border-b border-slate-800/40">
              <span className="font-sans text-slate-300">Senior Secured Debt (Tranche A)</span>
              <div className="text-right">
                <span className="font-bold text-blue-300">{formatCurrency(su.seniorDebtAmount, currency, 1)}</span>
                <span className="text-[11px] text-slate-500 ml-2">({formatPercent(su.seniorDebtAmount / su.totalSources, 1)})</span>
              </div>
            </div>

            <div className="flex justify-between items-center py-1 border-b border-slate-800/40">
              <span className="font-sans text-slate-300">Subordinated Debt (Tranche B)</span>
              <div className="text-right">
                <span className="font-bold text-amber-300">{formatCurrency(su.subDebtAmount, currency, 1)}</span>
                <span className="text-[11px] text-slate-500 ml-2">({formatPercent(su.subDebtAmount / su.totalSources, 1)})</span>
              </div>
            </div>

            <div className="flex justify-between items-center py-1 border-b border-slate-800/40 bg-indigo-950/20 px-1 rounded">
              <span className="font-sans font-semibold text-indigo-300">Sponsor Equity Contribution (Plug)</span>
              <div className="text-right">
                <span className="font-bold text-indigo-200">{formatCurrency(su.sponsorEquity, currency, 1)}</span>
                <span className="text-[11px] text-indigo-400 ml-2 font-bold">({formatPercent(su.sponsorEquityPercent, 1)})</span>
              </div>
            </div>

            <div className="flex justify-between items-center pt-2 font-bold text-white">
              <span className="font-sans uppercase text-emerald-400">Total Sources of Funds</span>
              <div className="text-right">
                <span className="text-sm text-emerald-400">{formatCurrency(su.totalSources, currency, 1)}</span>
                <span className="text-[11px] text-emerald-400 ml-2">(100.0%)</span>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* Leverage Overview Bar */}
      <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
        <div className="flex items-center gap-4">
          <span>Total Leverage: <strong className="text-white font-mono">{su.totalDebtMultiple.toFixed(2)}x EBITDA</strong></span>
          <span>Debt / Total Capital: <strong className="text-blue-400 font-mono">{formatPercent(su.totalDebtRaised / su.totalSources, 1)}</strong></span>
          <span>Sponsor Equity %: <strong className="text-indigo-400 font-mono">{formatPercent(su.sponsorEquityPercent, 1)}</strong></span>
        </div>
      </div>
    </div>
  );
};
