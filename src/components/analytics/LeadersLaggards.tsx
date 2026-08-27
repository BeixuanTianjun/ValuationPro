import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Info, Scale } from 'lucide-react';
import { MarketDatabase } from '../../data/marketRepository';
import {
  AttributionPeriod,
  Contribution,
  PERIOD_LABELS,
  computeAttribution,
} from '../../models/indexAttribution';

interface Props {
  db: MarketDatabase;
  onSelectEmiten: (code: string) => void;
}

const PERIODS: AttributionPeriod[] = ['1d', '1w', '1m', '3m', 'ytd'];

const num = (v: number, d = 2) =>
  Number.isFinite(v) ? v.toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–';
const pct = (v: number, d = 1) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%` : '–');
const pts = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;

/**
 * Index point attribution — the "who actually moved IHSG" board.
 *
 * The reconciliation line is shown, not hidden: an attribution you cannot
 * audit against the published index is decoration.
 */
export const LeadersLaggards: React.FC<Props> = ({ db, onSelectEmiten }) => {
  const [period, setPeriod] = useState<AttributionPeriod>('1d');
  const result = useMemo(() => computeAttribution(db, period, 12), [db, period]);

  if (!result) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center text-sm text-slate-400">
        Atribusi indeks membutuhkan bobot free-float dari sesi IDX terakhir. Jalankan{' '}
        <code className="text-blue-400">npm run data:refresh</code>.
      </div>
    );
  }

  const maxAbs = Math.max(
    ...result.leaders.map((c) => Math.abs(c.points)),
    ...result.laggards.map((c) => Math.abs(c.points)),
    0.01
  );
  const maxSector = Math.max(...result.sectors.map((s) => Math.abs(s.points)), 0.01);

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Scale className="w-4 h-4 text-blue-400" aria-hidden="true" />
              <h3 className="text-sm font-bold text-white">Penggerak IHSG — kontribusi poin indeks</h3>
            </div>
            <p className="text-[11px] text-slate-500 mt-1.5 max-w-2xl leading-relaxed">
              Berapa poin indeks yang disumbang tiap emiten, dihitung dari perubahan harga dikali jumlah saham
              free-float yang dipakai IDX untuk membobot indeks. Ini perhitungan yang sama dengan fungsi atribusi
              indeks di terminal Bloomberg.
            </p>
          </div>

          <div className="flex max-w-full gap-1 overflow-x-auto scrollbar-thin bg-slate-950 p-1 rounded-lg border border-slate-800" role="group" aria-label="Periode">
            {PERIODS.map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                aria-pressed={period === p}
                className={`px-3 py-1.5 rounded text-[11px] font-bold transition-all duration-200 cursor-pointer ${
                  period === p ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-5 pt-5 border-t border-slate-800">
          <Stat label="IHSG sekarang" value={num(result.indexNow)} />
          <Stat label={`Pada ${result.fromDate}`} value={num(result.indexThen)} />
          <Stat
            label="Perubahan"
            value={pts(result.indexPoints)}
            hint={pct(result.indexPercent, 2)}
            valueClass={result.indexPoints >= 0 ? 'text-emerald-400' : 'text-rose-400'}
          />
          <Stat
            label="Naik / turun"
            value={`${result.breadth.advancers} / ${result.breadth.decliners}`}
            hint={`${result.breadth.unchanged} tetap`}
          />
          <Stat
            label="Jumlah kontribusi"
            value={pts(result.reconciliation.summedPoints)}
            hint={`sisa ${result.reconciliation.residualPoints.toFixed(2)} poin`}
            valueClass={result.reconciliation.ok ? 'text-slate-100' : 'text-amber-400'}
          />
        </div>

        {result.reconciliation.note && (
          <div className="flex gap-2 mt-4 rounded-xl border border-slate-700/60 bg-slate-800/30 px-4 py-3">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-500" aria-hidden="true" />
            <p className="text-[11px] text-slate-400 leading-relaxed">{result.reconciliation.note}</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ContributionPanel
          title="Top Leaders"
          subtitle="Menambah poin indeks paling banyak"
          icon={<ArrowUp className="w-4 h-4 text-emerald-400" aria-hidden="true" />}
          rows={result.leaders}
          maxAbs={maxAbs}
          positive
          onSelect={onSelectEmiten}
        />
        <ContributionPanel
          title="Top Laggards"
          subtitle="Menekan indeks paling dalam"
          icon={<ArrowDown className="w-4 h-4 text-rose-400" aria-hidden="true" />}
          rows={result.laggards}
          maxAbs={maxAbs}
          positive={false}
          onSelect={onSelectEmiten}
        />
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
        <h4 className="text-xs font-bold text-white mb-4">Kontribusi per Sektor IDX-IC</h4>
        <div className="space-y-2">
          {result.sectors.map((s) => (
            <div key={s.sector} className="flex items-center gap-3">
              <span className="text-[11px] text-slate-400 w-48 shrink-0 truncate">{s.sector}</span>
              <div className="flex-1 h-3 bg-slate-950 rounded relative overflow-hidden">
                <div className="absolute left-1/2 top-0 w-px h-full bg-slate-700" aria-hidden="true" />
                <div
                  className={`absolute top-0 h-full ${s.points >= 0 ? 'bg-emerald-500/70 left-1/2' : 'bg-rose-500/70 right-1/2'}`}
                  style={{ width: `${(Math.abs(s.points) / maxSector) * 50}%` }}
                />
              </div>
              <span
                className={`text-[11px] font-bold tabular-nums w-16 text-right ${
                  s.points >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {pts(s.points)}
              </span>
              <span className="text-[10px] text-slate-600 w-14 text-right tabular-nums">
                {(s.weight * 100).toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-slate-600 mt-4">
          Kolom terakhir adalah bobot free-float sektor di dalam IHSG.
        </p>
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; hint?: string; valueClass?: string }> = ({
  label,
  value,
  hint,
  valueClass = 'text-white',
}) => (
  <div>
    <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">{label}</div>
    <div className={`text-lg font-bold tabular-nums ${valueClass}`}>{value}</div>
    {hint && <div className="text-[10px] text-slate-500 tabular-nums">{hint}</div>}
  </div>
);

const ContributionPanel: React.FC<{
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  rows: Contribution[];
  maxAbs: number;
  positive: boolean;
  onSelect: (code: string) => void;
}> = ({ title, subtitle, icon, rows, maxAbs, positive, onSelect }) => (
  <div className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden">
    <div className="px-5 py-3.5 border-b border-slate-800">
      <div className="flex items-center gap-2">
        {icon}
        <h4 className="text-xs font-bold text-white">{title}</h4>
      </div>
      <p className="text-[10px] text-slate-500 mt-0.5">{subtitle}</p>
    </div>
    <div className="divide-y divide-slate-800/60">
      {rows.map((c) => (
        <button
          key={c.emiten.code}
          onClick={() => onSelect(c.emiten.code)}
          className="w-full px-5 py-2.5 hover:bg-slate-800/40 transition-colors cursor-pointer text-left"
        >
          <div className="flex items-center gap-3">
            <div className="w-16 shrink-0">
              <div className="text-xs font-bold text-slate-100">{c.emiten.code}</div>
              <div className="text-[9px] text-slate-600 tabular-nums">{(c.indexWeight * 100).toFixed(2)}%</div>
            </div>

            <div className="flex-1 h-2 bg-slate-950 rounded overflow-hidden">
              <div
                className={`h-full rounded ${positive ? 'bg-emerald-500' : 'bg-rose-500'}`}
                style={{ width: `${(Math.abs(c.points) / maxAbs) * 100}%` }}
              />
            </div>

            <div className="text-right shrink-0 w-[70px]">
              <div className={`text-xs font-bold tabular-nums ${c.points >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {pts(c.points)}
              </div>
              <div className="text-[9px] text-slate-500 tabular-nums">{pct(c.returnPercent)}</div>
            </div>
          </div>
          <div className="text-[10px] text-slate-600 truncate mt-0.5 ml-[76px]">{c.emiten.name}</div>
        </button>
      ))}
    </div>
  </div>
);
