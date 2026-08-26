import React from 'react';
import { SensitivityMatrix } from '../../types/common';
import { formatPercent } from '../../utils/formatters';

interface HeatmapTableProps {
  data: SensitivityMatrix;
  valueFormatter?: (val: number) => string;
  isPercentage?: boolean;
}

export const HeatmapTable: React.FC<HeatmapTableProps> = ({
  data,
  isPercentage = false,
}) => {
  const flatValues = data.matrix.flatMap(row => row.map(c => c.resultValue));
  const minVal = Math.min(...flatValues);
  const maxVal = Math.max(...flatValues);
  const range = maxVal - minVal || 1;

  const getCellColor = (val: number, isBase?: boolean) => {
    if (isBase) {
      return 'bg-blue-600 text-white font-bold ring-2 ring-blue-400 ring-offset-1 ring-offset-slate-900 shadow-md';
    }
    const norm = (val - minVal) / range;
    if (norm > 0.75) return 'bg-emerald-950/80 text-emerald-200 border-emerald-700/50';
    if (norm > 0.5) return 'bg-emerald-900/40 text-emerald-300 border-emerald-800/40';
    if (norm > 0.3) return 'bg-slate-800 text-slate-200 border-slate-700';
    if (norm > 0.15) return 'bg-amber-950/40 text-amber-300 border-amber-800/40';
    return 'bg-rose-950/50 text-rose-300 border-rose-900/40';
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
          Sensitivity Analysis: {data.metricName}
        </h4>
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <span className="inline-block w-3 h-3 rounded bg-blue-600 ring-1 ring-blue-400"></span>
          <span>Base Case</span>
        </div>
      </div>

      <table className="w-full text-xs border-collapse">
        <thead>
          <tr>
            <th className="p-2 border border-slate-800 bg-slate-950 text-left font-semibold text-slate-400">
              {data.rowHeader} \ {data.colHeader}
            </th>
            {data.colValues.map((colVal, idx) => (
              <th key={idx} className="p-2 border border-slate-800 bg-slate-950 text-center font-mono font-semibold text-slate-300">
                {isPercentage ? formatPercent(colVal, 1) : colVal.toFixed(1) + (colVal > 20 ? '' : 'x')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.matrix.map((row, rIdx) => (
            <tr key={rIdx}>
              <td className="p-2 border border-slate-800 bg-slate-950 font-mono font-semibold text-slate-300 whitespace-nowrap">
                {isPercentage ? formatPercent(data.rowValues[rIdx], 1) : data.rowValues[rIdx].toFixed(1) + (data.rowValues[rIdx] > 20 ? '' : 'x')}
              </td>
              {row.map((cell, cIdx) => (
                <td
                  key={cIdx}
                  className={`p-2 border border-slate-800 text-center font-mono text-xs transition-all ${getCellColor(
                    cell.resultValue,
                    cell.isBaseCase
                  )}`}
                >
                  {cell.formattedResult}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
