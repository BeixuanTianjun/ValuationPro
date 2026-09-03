import React, { useState } from 'react';
import { DcfAssumptions, DcfValuationSummary } from '../../types/dcf';
import { generateDcfSensitivityWaccVsGrowth, generateDcfSensitivityWaccVsMultiple } from '../../models/dcfEngine';
import { HeatmapTable } from '../common/HeatmapTable';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';
import { amountLabel, formatCurrency } from '../../utils/formatters';
import { CHART } from '../../theme/chart';

interface DcfSensitivityProps {
  assumptions: DcfAssumptions;
  summary: DcfValuationSummary;
}

export const DcfSensitivity: React.FC<DcfSensitivityProps> = ({
  assumptions,
  summary,
}) => {
  const [activeTab, setActiveTab] = useState<'growth' | 'multiple'>('growth');

  const waccVsGrowthMatrix = generateDcfSensitivityWaccVsGrowth(assumptions);
  const waccVsMultipleMatrix = generateDcfSensitivityWaccVsMultiple(assumptions);

  const chartData = summary.cashFlows.map(cf => ({
    name: cf.yearLabel,
    EBITDA: cf.ebitda,
    UFCF: cf.ufcf,
    PV_UFCF: cf.presentValueUfcf,
  }));

  return (
    <div className="space-y-6">
      
      {/* Visual Chart */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200">
            Projected Cash Flow Trajectory (EBITDA vs UFCF vs PV)
          </h3>
          <span className="text-xs text-slate-400 font-mono">
            {amountLabel('Amounts', assumptions.currency, assumptions.units)}
          </span>
        </div>

        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} opacity={0.5} />
              <XAxis dataKey="name" stroke={CHART.axis} fontSize={11} />
              <YAxis stroke={CHART.axis} fontSize={11} />
              <Tooltip
                contentStyle={{ backgroundColor: CHART.tooltipBg, borderColor: CHART.grid, borderRadius: '8px' }}
                formatter={(value: any) => [formatCurrency(Number(value), '$', 1), '']}
              />
              <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
              <Bar dataKey="EBITDA" fill={CHART.blue} radius={[4, 4, 0, 0]} name="EBITDA" />
              <Bar dataKey="UFCF" fill={CHART.green} radius={[4, 4, 0, 0]} name="Unlevered Free Cash Flow" />
              <Bar dataKey="PV_UFCF" fill={CHART.violet} radius={[4, 4, 0, 0]} name="Present Value of UFCF" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 2D Sensitivity Tables */}
      <div className="space-y-4">
        <div className="flex max-w-full overflow-x-auto scrollbar-thin bg-slate-950 p-1 rounded-lg border border-slate-800 w-full sm:w-fit">
          <button
            onClick={() => setActiveTab('growth')}
            className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all ${
              activeTab === 'growth'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            WACC vs Terminal Growth Rate (g)
          </button>
          <button
            onClick={() => setActiveTab('multiple')}
            className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all ${
              activeTab === 'multiple'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            WACC vs Exit EV/EBITDA Multiple
          </button>
        </div>

        {activeTab === 'growth' ? (
          <HeatmapTable data={waccVsGrowthMatrix} isPercentage={true} />
        ) : (
          <HeatmapTable data={waccVsMultipleMatrix} isPercentage={false} />
        )}
      </div>

    </div>
  );
};
