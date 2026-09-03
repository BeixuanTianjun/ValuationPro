import React, { useState } from 'react';
import { LboAssumptions, LboReturnsSummary } from '../../types/lbo';
import { generateLboSensitivityEntryVsExit, generateLboSensitivityLeverageVsExit } from '../../models/lboEngine';
import { HeatmapTable } from '../common/HeatmapTable';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';
import { amountLabel, formatCurrency } from '../../utils/formatters';
import { CHART } from '../../theme/chart';

/**
 * Skala model, dengan default yang dinyatakan.
 *
 * `units` opsional pada LboAssumptions supaya model lama tetap terbaca, jadi
 * defaultnya harus ada di SATU tempat — sebuah default yang ditulis ulang di
 * tiap layar adalah default yang akan berbeda di salah satunya.
 */
const lboUnits = (a: { units?: string }) => a.units ?? 'billions';

interface LboSensitivityProps {
  assumptions: LboAssumptions;
  summary: LboReturnsSummary;
}

export const LboSensitivity: React.FC<LboSensitivityProps> = ({
  assumptions,
  summary,
}) => {
  const [activeTab, setActiveTab] = useState<'irr' | 'moic' | 'leverage'>('irr');

  const irrMatrix = generateLboSensitivityEntryVsExit(assumptions, 'irr');
  const moicMatrix = generateLboSensitivityEntryVsExit(assumptions, 'moic');
  const leverageMatrix = generateLboSensitivityLeverageVsExit(assumptions);

  const chartData = [
    {
      name: 'Entry (t=0)',
      SeniorDebt: summary.sourcesAndUses.seniorDebtAmount,
      SubDebt: summary.sourcesAndUses.subDebtAmount,
      SponsorEquity: summary.sourcesAndUses.sponsorEquity,
    },
    ...summary.schedules.map(s => ({
      name: `Yr ${s.year}`,
      SeniorDebt: s.seniorDebt.endingBalance,
      SubDebt: s.subDebt.endingBalance,
      SponsorEquity: s.year === summary.exitYear ? summary.exitEquityValue : summary.initialSponsorEquity,
    }))
  ];

  return (
    <div className="space-y-6">
      
      {/* Visual Debt Paydown Chart */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200">
            Capital Structure Evolution & Equity Value Growth
          </h3>
          <span className="text-xs text-slate-400 font-mono">
            {amountLabel('Amounts', assumptions.currency, lboUnits(assumptions))}
          </span>
        </div>

        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} opacity={0.5} />
              <XAxis dataKey="name" stroke={CHART.axis} fontSize={11} />
              <YAxis stroke={CHART.axis} fontSize={11} />
              <Tooltip
                contentStyle={{ backgroundColor: CHART.tooltipBg, borderColor: CHART.grid, borderRadius: '8px' }}
                formatter={(value: any) => [formatCurrency(Number(value), '$', 1), '']}
              />
              <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
              <Area type="monotone" dataKey="SeniorDebt" stackId="1" stroke={CHART.blue} fill={CHART.blue} name="Senior Debt" fillOpacity={0.6} />
              <Area type="monotone" dataKey="SubDebt" stackId="1" stroke={CHART.amber} fill={CHART.amber} name="Subordinated Debt" fillOpacity={0.6} />
              <Area type="monotone" dataKey="SponsorEquity" stackId="1" stroke={CHART.green} fill={CHART.green} name="Sponsor Equity Value" fillOpacity={0.6} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 2D Sensitivity Tables */}
      <div className="space-y-4">
        <div className="flex max-w-full overflow-x-auto scrollbar-thin bg-slate-950 p-1 rounded-lg border border-slate-800 w-full sm:w-fit">
          <button
            onClick={() => setActiveTab('irr')}
            className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all ${
              activeTab === 'irr'
                ? 'bg-emerald-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Entry Multiple vs Exit Multiple (IRR)
          </button>
          <button
            onClick={() => setActiveTab('moic')}
            className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all ${
              activeTab === 'moic'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Entry Multiple vs Exit Multiple (MoIC)
          </button>
          <button
            onClick={() => setActiveTab('leverage')}
            className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all ${
              activeTab === 'leverage'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Senior Leverage vs Exit Multiple (IRR)
          </button>
        </div>

        {activeTab === 'irr' && <HeatmapTable data={irrMatrix} isPercentage={false} />}
        {activeTab === 'moic' && <HeatmapTable data={moicMatrix} isPercentage={false} />}
        {activeTab === 'leverage' && <HeatmapTable data={leverageMatrix} isPercentage={false} />}
      </div>

    </div>
  );
};
