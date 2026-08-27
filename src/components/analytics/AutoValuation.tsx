import React, { useMemo, useState } from 'react';
import { AlertTriangle, Calculator, Info, Loader2 } from 'lucide-react';
import { MarketDatabase } from '../../data/marketRepository';
import { FundamentalsDatabase } from '../../data/fundamentalsRepository';
import { FactorSnapshot } from '../../types/market';
import { AutoValuationFilters, DEFAULT_AUTO_FILTERS, runAutoValuation } from '../../models/autoValuation';

interface Props {
  db: MarketDatabase;
  fundamentals: FundamentalsDatabase | null;
  factors: Map<string, FactorSnapshot> | null;
  onSelectEmiten: (code: string) => void;
  onModelEmiten: (code: string) => void;
}

const num = (v: number, d = 0) => (Number.isFinite(v) ? v.toLocaleString('id-ID', { maximumFractionDigits: d }) : '–');
const pct = (v: number, d = 1) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%` : '–');

export const AutoValuation: React.FC<Props> = ({ db, fundamentals, factors, onSelectEmiten, onModelEmiten }) => {
  const [filters, setFilters] = useState<Partial<AutoValuationFilters>>({});
  const [showAll, setShowAll] = useState(false);

  const run = useMemo(() => {
    if (!fundamentals || !factors) return null;
    return runAutoValuation(db, fundamentals, factors, { ...filters, onlyUsable: !showAll, limit: 40 });
  }, [db, fundamentals, factors, filters, showAll]);

  if (!run) {
    return (
      <div className="flex items-center justify-center gap-3 py-20 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
        <span className="text-sm">Menjalankan model DCF untuk seluruh emiten…</span>
      </div>
    );
  }

  const f: AutoValuationFilters = { ...DEFAULT_AUTO_FILTERS, ...filters };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <Calculator className="w-4 h-4 text-cyan-400" aria-hidden="true" />
          <h3 className="text-sm font-bold text-white">Pemodelan Keuangan Otomatis</h3>
        </div>
        <p className="text-[11px] text-slate-400 mt-2 leading-relaxed max-w-3xl">
          Model DCF yang sama yang dipakai di tab DCF, dijalankan atas setiap emiten yang punya laporan keuangan
          memadai. Asumsi dikalibrasi dari laporan masing-masing: CAGR historis, rata-rata margin, CapEx dan modal
          kerja, dengan beta diregresikan terhadap IHSG lalu disesuaikan Blume.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-5 pt-5 border-t border-slate-800">
          <Stat label="Lolos filter ukuran" value={num(run.attempted)} hint="emiten" />
          <Stat label="Berhasil dimodelkan" value={num(run.modelled)} />
          <Stat label="Layak dipakai" value={num(run.usable)} hint="tanpa error model" />
          <Stat
            label="Median upside"
            value={pct(run.medianUpside)}
            hint="seluruh model yang layak"
            valueClass={run.medianUpside >= 0 ? 'text-emerald-400' : 'text-rose-400'}
          />
          <Stat label="Bank & asuransi" value={num(run.excludedFinancials)} hint="dikecualikan" />
        </div>
      </div>

      <div className="rounded-2xl border border-amber-500/25 bg-amber-500/8 p-4 flex gap-2.5">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" aria-hidden="true" />
        <div className="text-[11px] text-amber-200/90 leading-relaxed space-y-1.5">
          <p>
            <strong>Ini penyaring, bukan valuasi.</strong> DCF otomatis mengekstrapolasi margin dan pertumbuhan
            historis lima tahun ke depan lalu menambahkan terminal value — untuk emiten dengan laba bergelombang
            seperti pengembang properti dan komoditas, hasilnya bisa jauh melenceng. Upside besar di sini artinya
            "layak diperiksa", bukan "murah".
          </p>
          <p>
            Bank, asuransi, dan multifinance dikeluarkan karena arus kas bebas unlevered tidak menggambarkan mereka.
            Model dengan error dari mesin DCF tidak diperingkat sama sekali.
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex flex-wrap items-end gap-4">
          <NumField
            label="Kapitalisasi min (Rp miliar)"
            value={f.minMarketCapIdrBn}
            step={500}
            onChange={(v) => setFilters((s) => ({ ...s, minMarketCapIdrBn: v }))}
          />
          <NumField
            label="Likuiditas min (Rp miliar/hari)"
            value={f.minLiquidityIdrBn}
            step={1}
            onChange={(v) => setFilters((s) => ({ ...s, minLiquidityIdrBn: v }))}
          />
          <div>
            <label className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold block mb-1.5">
              Sektor
            </label>
            <select
              value={f.sectors[0] || ''}
              onChange={(e) => setFilters((s) => ({ ...s, sectors: e.target.value ? [e.target.value] : [] }))}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-slate-200 cursor-pointer focus:outline-none"
            >
              <option value="">Semua sektor</option>
              {db.sectors.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={() => setShowAll((v) => !v)}
            className={`px-3 py-2 rounded-lg text-[11px] font-bold border transition-all cursor-pointer ${
              showAll
                ? 'bg-amber-600/20 text-amber-300 border-amber-500/40'
                : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
            }`}
          >
            {showAll ? 'Termasuk model bermasalah' : 'Hanya model layak'}
          </button>
        </div>

        <div className="overflow-x-auto scrollbar-thin max-h-[620px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-950 text-slate-400 sticky top-0 z-10">
              <tr>
                <th scope="col" className="text-left px-5 py-2.5 font-semibold">Emiten</th>
                <th scope="col" className="text-right px-3 py-2.5 font-semibold">Harga</th>
                <th scope="col" className="text-right px-3 py-2.5 font-semibold">Target</th>
                <th scope="col" className="text-right px-3 py-2.5 font-semibold">Upside</th>
                <th scope="col" className="text-right px-3 py-2.5 font-semibold">WACC</th>
                <th scope="col" className="text-right px-3 py-2.5 font-semibold">Beta</th>
                <th scope="col" className="text-right px-3 py-2.5 font-semibold">CAGR</th>
                <th scope="col" className="text-right px-3 py-2.5 font-semibold">TV %</th>
                <th scope="col" className="text-right px-3 py-2.5 font-semibold">Kap (Rp miliar)</th>
                <th scope="col" className="text-right px-5 py-2.5 font-semibold">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {run.results.map((r) => (
                <tr key={r.emiten.code} className="border-t border-slate-800/60 hover:bg-slate-800/40 transition-colors">
                  <td className="px-5 py-2">
                    <button
                      onClick={() => onSelectEmiten(r.emiten.code)}
                      className="font-bold text-slate-100 hover:text-blue-400 cursor-pointer transition-colors"
                    >
                      {r.emiten.code}
                    </button>
                    <div className="text-[10px] text-slate-500 truncate max-w-[190px]">{r.emiten.name}</div>
                    {r.flags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {r.flags.slice(0, 2).map((flag) => (
                          <span
                            key={flag}
                            className="px-1.5 py-0.5 text-[9px] rounded bg-amber-500/10 text-amber-400 border border-amber-500/20"
                          >
                            {flag}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-100 tabular-nums">{num(r.price)}</td>
                  <td className="px-3 py-2 text-right text-slate-100 font-semibold tabular-nums">
                    {num(r.targetBlended)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-bold tabular-nums ${
                      r.upside >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {pct(r.upside, 0)}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-300 tabular-nums">{pct(r.wacc, 1).replace('+', '')}</td>
                  <td className="px-3 py-2 text-right text-slate-300 tabular-nums">{r.beta.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right text-slate-300 tabular-nums">{pct(r.revenueCagr, 0)}</td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${
                      r.terminalValueShare > 0.85 ? 'text-amber-400' : 'text-slate-300'
                    }`}
                  >
                    {pct(r.terminalValueShare, 0).replace('+', '')}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-400 tabular-nums">{num(r.marketCapIdrBn)}</td>
                  <td className="px-5 py-2 text-right">
                    <button
                      onClick={() => onModelEmiten(r.emiten.code)}
                      className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold rounded transition-colors cursor-pointer"
                    >
                      Buka model
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!run.results.length && (
            <div className="py-12 text-center text-xs text-slate-500">
              Tidak ada emiten yang lolos filter ini.
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-800 flex gap-2 text-[10px] text-slate-500">
          <Info className="w-3 h-3 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            Target adalah rata-rata metode Gordon Growth dan Exit Multiple. Kolom TV% menunjukkan porsi nilai
            perusahaan yang berasal dari terminal value — di atas 85% berarti valuasinya hampir seluruhnya bergantung
            pada asumsi setelah tahun kelima.
          </span>
        </div>
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
    {hint && <div className="text-[10px] text-slate-500">{hint}</div>}
  </div>
);

const NumField: React.FC<{ label: string; value: number; step: number; onChange: (v: number) => void }> = ({
  label,
  value,
  step,
  onChange,
}) => (
  <div>
    <label className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold block mb-1.5">{label}</label>
    <input
      type="number"
      value={value}
      step={step}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-40 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-slate-100 tabular-nums focus:outline-none focus:border-blue-600"
    />
  </div>
);
