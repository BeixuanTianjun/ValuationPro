import React from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { DcfDiagnostic, DcfValuationSummary } from '../../types/dcf';

interface Props {
  summary: DcfValuationSummary;
}

const STYLES: Record<DcfDiagnostic['level'], { wrap: string; icon: React.ElementType; tint: string; label: string }> = {
  error: {
    wrap: 'bg-rose-500/8 border-rose-500/30',
    icon: XCircle,
    tint: 'text-rose-400',
    label: 'Masalah',
  },
  warning: {
    wrap: 'bg-amber-500/8 border-amber-500/30',
    icon: AlertTriangle,
    tint: 'text-amber-400',
    label: 'Perhatian',
  },
  info: {
    wrap: 'bg-slate-800/40 border-slate-700/60',
    icon: Info,
    tint: 'text-slate-400',
    label: 'Catatan',
  },
};

/**
 * Model health, shown next to the valuation rather than buried.
 *
 * A DCF that silently produces a number on broken assumptions is more dangerous
 * than one that refuses — so anything that would distort the output is stated
 * here in plain language, next to the figure it affects.
 */
export const DcfDiagnostics: React.FC<Props> = ({ summary }) => {
  const errors = summary.diagnostics.filter((d) => d.level === 'error');
  const warnings = summary.diagnostics.filter((d) => d.level === 'warning');
  const infos = summary.diagnostics.filter((d) => d.level === 'info');
  const ordered = [...errors, ...warnings, ...infos];

  const tvShare = Math.max(summary.terminalValueShareGordon, summary.terminalValueShareMultiple);

  if (!ordered.length) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/8 px-4 py-3">
        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
        <div className="text-xs text-emerald-300">
          Pemeriksaan model lolos. Terminal value menyumbang {(tvShare * 100).toFixed(0)}% dari nilai perusahaan,
          pertumbuhan terminal {(summary.effectiveTerminalGrowth * 100).toFixed(2)}% berada di bawah WACC{' '}
          {(summary.wacc.wacc * 100).toFixed(2)}%.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wide">Pemeriksaan Model</h4>
        <div className="flex gap-2 text-[10px] font-semibold">
          {errors.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/25">
              {errors.length} masalah
            </span>
          )}
          {warnings.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/25">
              {warnings.length} perhatian
            </span>
          )}
        </div>
      </div>

      {ordered.map((d, i) => {
        const s = STYLES[d.level];
        const Icon = s.icon;
        return (
          <div key={i} className={`flex gap-2.5 rounded-xl border px-4 py-3 ${s.wrap}`}>
            <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${s.tint}`} aria-hidden="true" />
            <div className="min-w-0">
              <div className={`text-[10px] font-bold uppercase tracking-wide ${s.tint}`}>{s.label}</div>
              <p className="text-xs text-slate-300 leading-relaxed mt-0.5">{d.message}</p>
            </div>
          </div>
        );
      })}

      {(summary.equityFlooredGordon || summary.equityFlooredMultiple) && (
        <p className="text-[11px] text-slate-500 leading-relaxed px-1">
          Nilai ekuitas dan harga per saham tidak pernah ditampilkan di bawah nol: pemegang saham dapat kehilangan
          seluruh modalnya, tetapi tidak berutang melebihi itu.
        </p>
      )}
    </div>
  );
};
