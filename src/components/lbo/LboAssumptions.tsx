import React from 'react';
import { LboAssumptions } from '../../types/lbo';
import { NumberInput } from '../common/NumberInput';
import { DollarSign, Sliders, Layers } from 'lucide-react';

interface LboAssumptionsProps {
  assumptions: LboAssumptions;
  onChange: (updated: LboAssumptions) => void;
}

export const LboAssumptionsComponent: React.FC<LboAssumptionsProps> = ({
  assumptions,
  onChange,
}) => {
  const updateField = <K extends keyof LboAssumptions>(field: K, value: LboAssumptions[K]) => {
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
      
      {/* 1. Transaction Entry & Exit Parameters */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
        <div className="flex items-center gap-2 mb-4 text-indigo-400 border-b border-slate-800 pb-2">
          <DollarSign className="w-4 h-4" />
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200">Transaction Entry & Exit Parameters</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-300">Deal Name</label>
            <input
              type="text"
              value={assumptions.dealName}
              onChange={(e) => updateField('dealName', e.target.value)}
              className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3 py-2 sm:py-1.5 text-xs font-medium text-slate-100 focus:outline-none focus:border-indigo-500 touch-target"
            />
          </div>

          <NumberInput
            label={`Target LTM Revenue (${assumptions.currency.trim()})`}
            value={assumptions.targetLtmRevenue}
            onChange={(v) => updateField('targetLtmRevenue', v)}
            type="currency"
            currency={assumptions.currency}
            step={10}
            decimals={1}
          />

          <NumberInput
            label={`Target LTM EBITDA (${assumptions.currency.trim()})`}
            value={assumptions.targetLtmEbitda}
            onChange={(v) => updateField('targetLtmEbitda', v)}
            type="currency"
            currency={assumptions.currency}
            step={5}
            decimals={1}
          />

          <NumberInput
            label="Holding Period (Years)"
            value={assumptions.holdPeriodYears}
            onChange={(v) => updateField('holdPeriodYears', Math.min(Math.max(Math.round(v), 1), 7))}
            step={1}
            min={1}
            max={7}
            decimals={0}
          />

          <NumberInput
            label="Entry EV / EBITDA Multiple"
            value={assumptions.entryEvEbitdaMultiple}
            onChange={(v) => updateField('entryEvEbitdaMultiple', v)}
            type="multiple"
            step={0.5}
            decimals={1}
          />

          <NumberInput
            label="Exit EV / EBITDA Multiple"
            value={assumptions.exitEvEbitdaMultiple}
            onChange={(v) => updateField('exitEvEbitdaMultiple', v)}
            type="multiple"
            step={0.5}
            decimals={1}
          />

          <NumberInput
            label="M&A Advisory Fee (%)"
            value={assumptions.advisoryFeePercent}
            onChange={(v) => updateField('advisoryFeePercent', v)}
            type="percent"
            step={0.005}
            decimals={2}
          />

          <NumberInput
            label="Financing Fee (% Debt)"
            value={assumptions.financingFeePercent}
            onChange={(v) => updateField('financingFeePercent', v)}
            type="percent"
            step={0.005}
            decimals={2}
          />
        </div>
      </div>

      {/* 2. Debt Financing Tranches */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
        <div className="flex items-center gap-2 mb-4 text-blue-400 border-b border-slate-800 pb-2">
          <Layers className="w-4 h-4" />
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200">Debt Financing Structure & Pricing</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-blue-400 uppercase">Tranche A: Senior Secured Debt</span>
              <span className="text-[10px] text-slate-500 font-mono">1st Lien Term Loan</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <NumberInput
                label="Leverage"
                value={assumptions.seniorDebtMultiple}
                onChange={(v) => updateField('seniorDebtMultiple', v)}
                type="multiple"
                step={0.25}
                decimals={2}
              />
              <NumberInput
                label="Interest"
                value={assumptions.seniorDebtInterest}
                onChange={(v) => updateField('seniorDebtInterest', v)}
                type="percent"
                step={0.0025}
                decimals={2}
              />
              <NumberInput
                label="Amort./Yr"
                value={assumptions.seniorDebtAmort}
                onChange={(v) => updateField('seniorDebtAmort', v)}
                type="percent"
                step={0.01}
                decimals={1}
              />
            </div>
          </div>

          <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-400 uppercase">Tranche B: Subordinated / Mezzanine</span>
              <span className="text-[10px] text-slate-500 font-mono">2nd Lien / Mezzanine</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <NumberInput
                label="Leverage"
                value={assumptions.subDebtMultiple}
                onChange={(v) => updateField('subDebtMultiple', v)}
                type="multiple"
                step={0.25}
                decimals={2}
              />
              <NumberInput
                label="Interest"
                value={assumptions.subDebtInterest}
                onChange={(v) => updateField('subDebtInterest', v)}
                type="percent"
                step={0.0025}
                decimals={2}
              />
              <NumberInput
                label="Amort./Yr"
                value={assumptions.subDebtAmort}
                onChange={(v) => updateField('subDebtAmort', v)}
                type="percent"
                step={0.01}
                decimals={1}
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4 pt-4 border-t border-slate-800">
          <NumberInput
            label="Cash Sweep (% of Excess Cash)"
            value={assumptions.cashSweepPercent}
            onChange={(v) => updateField('cashSweepPercent', v)}
            type="percent"
            step={0.05}
            decimals={0}
            helperText="Prepay Senior Debt"
          />
          <NumberInput
            label={`Minimum Cash Balance (${assumptions.currency.trim()})`}
            value={assumptions.minCashBalance}
            onChange={(v) => updateField('minCashBalance', v)}
            type="currency"
            currency={assumptions.currency}
            step={5}
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

      {/* 3. Operational Projections */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
        <div className="flex items-center gap-2 mb-4 text-emerald-400 border-b border-slate-800 pb-2">
          <Sliders className="w-4 h-4" />
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200">Operating Projections During Hold</h3>
        </div>

        <div className="space-y-4">
          <div>
            <span className="text-xs font-bold text-slate-300 block mb-2">Revenue Growth Rate (%)</span>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              {assumptions.revenueGrowthRates.slice(0, 5).map((g, i) => (
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
              {assumptions.ebitdaMargins.slice(0, 5).map((m, i) => (
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

    </div>
  );
};
