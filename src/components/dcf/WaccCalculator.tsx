import React from 'react';
import { WaccBreakdown } from '../../types/dcf';
import { formatPercent } from '../../utils/formatters';
import { PieChart, ShieldCheck } from 'lucide-react';

interface WaccCalculatorProps {
  wacc: WaccBreakdown;
  taxRate: number;
}

export const WaccCalculatorComponent: React.FC<WaccCalculatorProps> = ({
  wacc,
  taxRate,
}) => {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
      <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-2">
        <div className="flex items-center gap-2 text-blue-400">
          <PieChart className="w-4 h-4" />
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200">WACC Engine Summary</h3>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-semibold bg-emerald-500/10 px-2.5 py-1 rounded-md border border-emerald-500/20">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>CAPM Validated</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
        <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
          <span className="text-[11px] font-semibold text-slate-400 uppercase">Cost of Equity (Ke)</span>
          <div className="text-xl font-bold font-mono text-blue-400 mt-1">{formatPercent(wacc.costOfEquity, 2)}</div>
          <span className="text-[10px] text-slate-500 mt-0.5 block">Weight: {formatPercent(wacc.equityWeight, 0)}</span>
        </div>

        <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
          <span className="text-[11px] font-semibold text-slate-400 uppercase">After-Tax Cost of Debt</span>
          <div className="text-xl font-bold font-mono text-indigo-400 mt-1">{formatPercent(wacc.afterTaxCostOfDebt, 2)}</div>
          <span className="text-[10px] text-slate-500 mt-0.5 block">Kd*(1-{formatPercent(taxRate, 0)})</span>
        </div>

        <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
          <span className="text-[11px] font-semibold text-slate-400 uppercase">Debt Weight (D/V)</span>
          <div className="text-xl font-bold font-mono text-slate-200 mt-1">{formatPercent(wacc.debtWeight, 0)}</div>
          <span className="text-[10px] text-slate-500 mt-0.5 block">Target capital structure</span>
        </div>

        <div className="p-3 bg-gradient-to-br from-blue-950/60 to-slate-950 rounded-lg border border-blue-500/40">
          <span className="text-[11px] font-bold text-blue-300 uppercase">Calculated WACC</span>
          <div className="text-2xl font-black font-mono text-white mt-1">{formatPercent(wacc.wacc, 2)}</div>
          <span className="text-[10px] text-blue-300/80 mt-0.5 block">Discount benchmark</span>
        </div>
      </div>

      {/* Interactive Capital Structure Bar */}
      <div>
        <div className="flex justify-between text-xs text-slate-400 mb-1">
          <span>Equity: {formatPercent(wacc.equityWeight, 1)}</span>
          <span>Debt: {formatPercent(wacc.debtWeight, 1)}</span>
        </div>
        <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden flex border border-slate-800">
          <div
            className="bg-blue-500 h-full transition-all duration-300"
            style={{ width: `${wacc.equityWeight * 100}%` }}
          />
          <div
            className="bg-indigo-500 h-full transition-all duration-300"
            style={{ width: `${wacc.debtWeight * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
};
