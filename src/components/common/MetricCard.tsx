import React from 'react';
import { LucideIcon } from 'lucide-react';

interface MetricCardProps {
  title: string;
  value: string;
  subValue?: string;
  badge?: {
    text: string;
    type: 'positive' | 'negative' | 'neutral' | 'info' | 'warning';
  };
  icon?: LucideIcon;
  variant?: 'default' | 'primary' | 'success' | 'warning';
}

export const MetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  subValue,
  badge,
  icon: Icon,
  variant = 'default',
}) => {
  const getBorderColor = () => {
    switch (variant) {
      case 'primary': return 'border-blue-500/40 bg-gradient-to-br from-blue-950/40 to-slate-900';
      case 'success': return 'border-emerald-500/40 bg-gradient-to-br from-emerald-950/40 to-slate-900';
      case 'warning': return 'border-amber-500/40 bg-gradient-to-br from-amber-950/40 to-slate-900';
      default: return 'border-slate-800 bg-slate-900';
    }
  };

  const getBadgeClass = (type: string) => {
    switch (type) {
      case 'positive': return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
      case 'negative': return 'bg-rose-500/20 text-rose-300 border-rose-500/30';
      case 'warning': return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
      case 'info': return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
      default: return 'bg-slate-700/50 text-slate-300 border-slate-600';
    }
  };

  return (
    <div className={`p-4 rounded-xl border ${getBorderColor()} shadow-lg flex flex-col justify-between`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">{title}</span>
        {Icon && <Icon className="w-4 h-4 text-slate-400" />}
      </div>

      <div className="my-2">
        <div className="text-2xl font-bold font-mono text-white tracking-tight">{value}</div>
        {subValue && <div className="text-xs text-slate-400 mt-0.5">{subValue}</div>}
      </div>

      {badge && (
        <div className="pt-2 border-t border-slate-800/60">
          <span className={`inline-block px-2 py-0.5 text-[11px] font-semibold rounded-md border ${getBadgeClass(badge.type)}`}>
            {badge.text}
          </span>
        </div>
      )}
    </div>
  );
};
