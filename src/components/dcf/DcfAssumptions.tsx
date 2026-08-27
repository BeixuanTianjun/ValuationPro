import { amountLabel, unitSuffix } from '../../utils/formatters';
import React from 'react';
import { DcfAssumptions } from '../../types/dcf';
import { NumberInput } from '../common/NumberInput';
import { Building2, Percent, Sliders } from 'lucide-react';

interface DcfAssumptionsProps {
  assumptions: DcfAssumptions;
  onChange: (updated: DcfAssumptions) => void;
}

export const DcfAssumptionsComponent: React.FC<DcfAssumptionsProps> = ({
  assumptions,
  onChange,
}) => {
  const updateField = <K extends keyof DcfAssumptions>(field: K, value: DcfAssumptions[K]) => {
    onChange({ ...assumptions, [field]: value });
  };

  const updateGrowth = (index: number, val: number) => {
    const arr = [...assumptions.revenueGrowthRates];
    arr[index] = val;
    onChange({ ...assumptions, revenueGrowthRates: arr });
  };

  const updateEbitdaMargin = (index: number, val: number) => {
    const arr = [...assumptions.ebitdaMargins];
    arr[index] = val;
    onChange({ ...assumptions, ebitdaMargins: arr });
  };

  return (
    <div className="space-y-6">
      
      {/* 1. Market Profile & Balance Sheet */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
        <div className="flex items-center gap-2 mb-4 text-blue-400 border-b border-slate-800 pb-2">
          <Building2 className="w-4 h-4" />
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200">Company & Market Inputs</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-300">Company Name</label>
            <input
              type="text"
              value={assumptions.companyName}
              onChange={(e) => updateField('companyName', e.target.value)}
              className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3 py-2 sm:py-1.5 text-xs font-medium text-slate-100 focus:outline-none focus:border-blue-500 touch-target"
            />
          </div>

          <NumberInput
            label="Current Share Price"
            value={assumptions.currentSharePrice}
            onChange={(v) => updateField('currentSharePrice', v)}
            type="currency"
            step={0.5}
            decimals={2}
          />

          <NumberInput
            label={`Diluted Shares Out. (${unitSuffix(assumptions.units)} shares)`}
            value={assumptions.sharesOutstanding}
            onChange={(v) => updateField('sharesOutstanding', v)}
            step={1}
            decimals={1}
          />

          <NumberInput
            label={amountLabel('Base Revenue', assumptions.currency, assumptions.units)}
            value={assumptions.baseRevenue}
            onChange={(v) => updateField('baseRevenue', v)}
            type="currency"
            step={10}
            decimals={1}
          />

          <NumberInput
            label={amountLabel('Cash & Equivalents', assumptions.currency, assumptions.units)}
            value={assumptions.balanceSheetCash}
            onChange={(v) => updateField('balanceSheetCash', v)}
            type="currency"
            step={5}
            decimals={1}
          />

          <NumberInput
            label={amountLabel('Total Debt', assumptions.currency, assumptions.units)}
            value={assumptions.balanceSheetDebt}
            onChange={(v) => updateField('balanceSheetDebt', v)}
            type="currency"
            step={10}
            decimals={1}
          />

          <NumberInput
            label={amountLabel('Minority Interest', assumptions.currency, assumptions.units)}
            value={assumptions.minorityInterest}
            onChange={(v) => updateField('minorityInterest', v)}
            type="currency"
            step={1}
            decimals={1}
          />

          <NumberInput
            label="Tax Rate (%)"
            value={assumptions.taxRate}
            onChange={(v) => updateField('taxRate', v)}
            type="percent"
            step={0.01}
            decimals={1}
          />
        </div>
      </div>

      {/* 2. Forecast Operating Assumptions (5 Years) */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
        <div className="flex items-center gap-2 mb-4 text-emerald-400 border-b border-slate-800 pb-2">
          <Sliders className="w-4 h-4" />
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200">5-Year Operating Projections</h3>
        </div>

        <div className="space-y-4">
          <div>
            <span className="text-xs font-bold text-slate-300 block mb-2">Revenue Growth Rate (%)</span>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              {assumptions.revenueGrowthRates.map((g, i) => (
                <NumberInput
                  key={i}
                  label={`Yr ${i + 1}`}
                  value={g}
                  onChange={(v) => updateGrowth(i, v)}
                  type="percent"
                  step={0.01}
                  decimals={1}
                />
              ))}
            </div>
          </div>

          <div>
            <span className="text-xs font-bold text-slate-300 block mb-2">EBITDA Margin (%)</span>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              {assumptions.ebitdaMargins.map((m, i) => (
                <NumberInput
                  key={i}
                  label={`Yr ${i + 1}`}
                  value={m}
                  onChange={(v) => updateEbitdaMargin(i, v)}
                  type="percent"
                  step={0.01}
                  decimals={1}
                />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-slate-800">
            <NumberInput
              label="CapEx (% of Rev)"
              value={assumptions.capexPercentOfRev[0] || 0.03}
              onChange={(v) => updateField('capexPercentOfRev', assumptions.capexPercentOfRev.map(() => v))}
              type="percent"
              step={0.005}
              decimals={1}
            />
            <NumberInput
              label="ΔNWC (% of Rev)"
              value={assumptions.nwcPercentOfRev[0] || 0.05}
              onChange={(v) => updateField('nwcPercentOfRev', assumptions.nwcPercentOfRev.map(() => v))}
              type="percent"
              step={0.005}
              decimals={1}
            />
            <NumberInput
              label="D&A (% of Rev)"
              value={assumptions.daPercentOfRev[0] || 0.06}
              onChange={(v) => updateField('daPercentOfRev', assumptions.daPercentOfRev.map(() => v))}
              type="percent"
              step={0.005}
              decimals={1}
            />
          </div>
        </div>
      </div>

      {/* 3. WACC & Terminal Value Inputs */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
        <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-2">
          <div className="flex items-center gap-2 text-indigo-400">
            <Percent className="w-4 h-4" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200">WACC & Terminal Value Settings</h3>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={assumptions.useManualWacc}
              onChange={(e) => updateField('useManualWacc', e.target.checked)}
              className="h-4 w-4 shrink-0 rounded bg-slate-950 border-slate-700 text-blue-600 focus:ring-0"
            />
            <span>Manual WACC Override</span>
          </label>
        </div>

        {assumptions.useManualWacc ? (
          <div className="p-4 bg-slate-950 rounded-lg border border-slate-800">
            <NumberInput
              label="Manual WACC Rate (%)"
              value={assumptions.manualWacc}
              onChange={(v) => updateField('manualWacc', v)}
              type="percent"
              step={0.0025}
              decimals={2}
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <NumberInput
              label="Risk-Free Rate (Rf)"
              value={assumptions.riskFreeRate}
              onChange={(v) => updateField('riskFreeRate', v)}
              type="percent"
              step={0.0025}
              decimals={2}
            />
            <NumberInput
              label="Equity Beta (β)"
              value={assumptions.beta}
              onChange={(v) => updateField('beta', v)}
              step={0.05}
              decimals={2}
            />
            <NumberInput
              label="Equity Risk Premium (ERP)"
              value={assumptions.equityRiskPremium}
              onChange={(v) => updateField('equityRiskPremium', v)}
              type="percent"
              step={0.0025}
              decimals={2}
            />
            <NumberInput
              label="Pre-Tax Cost of Debt (Kd)"
              value={assumptions.preTaxCostOfDebt}
              onChange={(v) => updateField('preTaxCostOfDebt', v)}
              type="percent"
              step={0.0025}
              decimals={2}
            />
            <NumberInput
              label="Target Debt Weight (D/V)"
              value={assumptions.targetDebtWeight}
              onChange={(v) => updateField('targetDebtWeight', v)}
              type="percent"
              step={0.05}
              decimals={1}
            />
            <NumberInput
              label="Size / Specific Premium"
              value={assumptions.sizePremium}
              onChange={(v) => updateField('sizePremium', v)}
              type="percent"
              step={0.0025}
              decimals={2}
            />
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 pt-4 border-t border-slate-800">
          <NumberInput
            label="Terminal Growth Rate (g)"
            value={assumptions.perpetualGrowthRate}
            onChange={(v) => updateField('perpetualGrowthRate', v)}
            type="percent"
            step={0.0025}
            decimals={2}
            helperText="Gordon Growth model"
          />
          <NumberInput
            label="Exit EV/EBITDA Multiple"
            value={assumptions.exitMultiple}
            onChange={(v) => updateField('exitMultiple', v)}
            type="multiple"
            step={0.5}
            decimals={1}
            helperText="Exit multiple method"
          />
        </div>
      </div>

    </div>
  );
};
