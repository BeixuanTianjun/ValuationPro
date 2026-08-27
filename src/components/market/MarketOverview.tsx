import React, { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, ArrowDownRight, ArrowUpRight, Globe2, Layers3, RefreshCw } from 'lucide-react';
import { IndexQuote, MarketBreadth } from '../../types/market';
import { MarketDatabase } from '../../data/marketRepository';
import { GROUP_LABELS } from '../../data/idxIndexCatalog';

interface Props {
  db: MarketDatabase;
  indices: IndexQuote[];
  breadth: MarketBreadth | null;
  onReload: () => void;
  onSelectEmiten: (code: string) => void;
}

const pct = (v: number, d = 2) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%` : '–');
const idr = (v: number, d = 0) => (Number.isFinite(v) ? v.toLocaleString('id-ID', { maximumFractionDigits: d }) : '–');
const tone = (v: number) => (v > 0 ? 'text-emerald-400' : v < 0 ? 'text-rose-400' : 'text-slate-400');

const GROUP_ORDER: IndexQuote['group'][] = ['headline', 'sector', 'factor', 'thematic', 'sharia'];

export const MarketOverview: React.FC<Props> = ({ db, indices, breadth, onReload, onSelectEmiten }) => {
  const [group, setGroup] = useState<IndexQuote['group']>('headline');

  const composite = indices.find((i) => i.code === 'COMPOSITE');
  const shown = useMemo(
    () => indices.filter((i) => i.group === group).sort((a, b) => b.return3m - a.return3m),
    [indices, group]
  );

  const sectorChart = useMemo(
    () =>
      indices
        .filter((i) => i.group === 'sector')
        .map((i) => ({
          name: i.name.replace('IDX Sector ', ''),
          code: i.code,
          value: Number.isFinite(i.return3m) ? i.return3m * 100 : 0,
        }))
        .sort((a, b) => b.value - a.value),
    [indices]
  );

  const movers = useMemo(() => {
    const rows = db.emiten
      .map((e) => ({ emiten: e, quote: db.daily.get(e.code) }))
      .filter((r) => r.quote && r.quote.volume > 0 && r.quote.close > 0);

    const byChange = [...rows].sort((a, b) => b.quote!.change - a.quote!.change);
    const byValue = [...rows].sort((a, b) => b.quote!.value - a.quote!.value);
    const byForeign = [...rows].sort((a, b) => b.quote!.foreignNet - a.quote!.foreignNet);

    return {
      gainers: byChange.slice(0, 8),
      losers: byChange.slice(-8).reverse(),
      active: byValue.slice(0, 8),
      inflow: byForeign.slice(0, 8),
      outflow: byForeign.slice(-8).reverse(),
    };
  }, [db]);

  return (
    <div className="space-y-6">
      {/* --- headline strip */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-900/40 border border-slate-800 rounded-2xl p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="flex items-center gap-5">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                IHSG · Indeks Harga Saham Gabungan
              </div>
              <div className="flex items-baseline gap-3 mt-1">
                <span className="text-3xl font-extrabold text-white tabular-nums">
                  {composite ? idr(composite.close, 2) : '–'}
                </span>
                <span className={`text-sm font-bold ${tone(composite?.changePercent ?? 0)}`}>
                  {pct(composite?.changePercent ?? NaN)}
                </span>
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                Sesi {db.meta.latestSession} · {db.meta.sessions} sesi riwayat sejak {db.meta.firstSession}
              </div>
            </div>

            {composite && (
              <div className="hidden md:grid grid-cols-4 gap-4 pl-5 border-l border-slate-800">
                {[
                  ['1 Bln', composite.return1m],
                  ['3 Bln', composite.return3m],
                  ['6 Bln', composite.return6m],
                  ['YTD', composite.ytd],
                ].map(([label, v]) => (
                  <div key={label as string}>
                    <div className="text-[10px] uppercase text-slate-500 font-semibold">{label as string}</div>
                    <div className={`text-sm font-bold tabular-nums ${tone(v as number)}`}>{pct(v as number, 1)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            {breadth && (
              <div className="flex items-center gap-4 bg-slate-950/70 border border-slate-800 rounded-xl px-4 py-2.5">
                <div className="text-center">
                  <div className="text-lg font-bold text-emerald-400 tabular-nums">{breadth.advancers}</div>
                  <div className="text-[10px] text-slate-500 font-semibold">NAIK</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-rose-400 tabular-nums">{breadth.decliners}</div>
                  <div className="text-[10px] text-slate-500 font-semibold">TURUN</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-slate-300 tabular-nums">{breadth.unchanged}</div>
                  <div className="text-[10px] text-slate-500 font-semibold">TETAP</div>
                </div>
              </div>
            )}
            <button
              onClick={onReload}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-lg border border-slate-700 transition-all cursor-pointer"
              title="Muat ulang database dari public/data/idx"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Muat Ulang
            </button>
          </div>
        </div>

        {breadth && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-5 pt-5 border-t border-slate-800">
            <Stat label="Emiten tercatat" value={idr(db.meta.emitenListed)} hint={`${db.meta.indexCount} indeks`} />
            <Stat
              label="Nilai transaksi"
              value={`Rp ${breadth.totalTurnoverIdrTn.toFixed(2)} T`}
              hint="seluruh pasar reguler"
            />
            <Stat
              label="Net asing"
              value={`Rp ${breadth.netForeignIdrBn.toFixed(0)} miliar`}
              hint={`${breadth.netForeignIdrBn >= 0 ? 'net beli' : 'net jual'} · sesi ${
                db.live?.foreignFlowAsOf || db.meta.latestSession
              }`}
              valueClass={tone(breadth.netForeignIdrBn)}
            />
            <Stat
              label="Di atas MA200"
              value={`${(breadth.percentAboveSma200 * 100).toFixed(0)}%`}
              hint={`MA50: ${(breadth.percentAboveSma50 * 100).toFixed(0)}%`}
            />
            <Stat
              label="High / Low 52 mgg"
              value={`${breadth.newHighs52w} / ${breadth.newLows52w}`}
              hint="puncak vs dasar baru"
            />
          </div>
        )}
      </div>

      {/* --- sector performance */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-4">
          <Layers3 className="w-4 h-4 text-blue-400" />
          <h3 className="text-sm font-bold text-white">Kinerja 11 Sektor IDX-IC — Return 3 Bulan</h3>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={sectorChart} margin={{ top: 5, right: 10, left: -10, bottom: 55 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis
                dataKey="name"
                angle={-35}
                textAnchor="end"
                interval={0}
                tick={{ fill: '#94a3b8', fontSize: 10 }}
                height={60}
              />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
              <Tooltip
                contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                formatter={(v: number) => [`${v.toFixed(2)}%`, 'Return 3 bulan']}
              />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {sectorChart.map((d) => (
                  <Cell key={d.code} fill={d.value >= 0 ? '#10b981' : '#f43f5e'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* --- index board */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-indigo-400" />
            <h3 className="text-sm font-bold text-white">Papan Indeks IDX — {indices.length} indeks</h3>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {GROUP_ORDER.map((g) => (
              <button
                key={g}
                onClick={() => setGroup(g)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer touch-target ${
                  group === g ? 'bg-indigo-600 text-white' : 'bg-slate-950 text-slate-400 hover:text-slate-200'
                }`}
              >
                {GROUP_LABELS[g]}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-xs">
            <thead className="bg-slate-950/60 text-slate-400">
              <tr>
                <th className="text-left px-5 py-2.5 font-semibold">Indeks</th>
                <th className="text-right px-3 py-2.5 font-semibold">Anggota</th>
                <th className="text-right px-3 py-2.5 font-semibold">Penutupan</th>
                <th className="text-right px-3 py-2.5 font-semibold">Harian</th>
                <th className="text-right px-3 py-2.5 font-semibold">1 Bln</th>
                <th className="text-right px-3 py-2.5 font-semibold">3 Bln</th>
                <th className="text-right px-3 py-2.5 font-semibold">12 Bln</th>
                <th className="text-right px-3 py-2.5 font-semibold">YTD</th>
                <th className="text-right px-5 py-2.5 font-semibold">Nilai (Rp miliar)</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((i) => (
                <tr key={i.code} className="border-t border-slate-800/60 hover:bg-slate-800/30">
                  <td className="px-5 py-2.5">
                    <div className="font-bold text-slate-100">{i.code}</div>
                    <div className="text-[10px] text-slate-500">{i.name}</div>
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-400 tabular-nums">{i.members || '–'}</td>
                  <td className="px-3 py-2.5 text-right text-slate-100 font-semibold tabular-nums">
                    {idr(i.close, 2)}
                  </td>
                  <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${tone(i.changePercent)}`}>
                    {pct(i.changePercent)}
                  </td>
                  <td className={`px-3 py-2.5 text-right tabular-nums ${tone(i.return1m)}`}>{pct(i.return1m, 1)}</td>
                  <td className={`px-3 py-2.5 text-right tabular-nums ${tone(i.return3m)}`}>{pct(i.return3m, 1)}</td>
                  <td className={`px-3 py-2.5 text-right tabular-nums ${tone(i.return12m)}`}>{pct(i.return12m, 1)}</td>
                  <td className={`px-3 py-2.5 text-right tabular-nums ${tone(i.ytd)}`}>{pct(i.ytd, 1)}</td>
                  <td className="px-5 py-2.5 text-right text-slate-400 tabular-nums">{idr(i.turnoverIdrBn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* --- movers */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <MoverCard
          title="Top Gainers"
          icon={<ArrowUpRight className="w-4 h-4 text-emerald-400" />}
          rows={movers.gainers}
          render={(q) => ({ primary: `${q.change >= 0 ? '+' : ''}${q.change.toFixed(2)}%`, cls: tone(q.change) })}
          onSelect={onSelectEmiten}
        />
        <MoverCard
          title="Top Losers"
          icon={<ArrowDownRight className="w-4 h-4 text-rose-400" />}
          rows={movers.losers}
          render={(q) => ({ primary: `${q.change.toFixed(2)}%`, cls: tone(q.change) })}
          onSelect={onSelectEmiten}
        />
        <MoverCard
          title="Teraktif (Nilai)"
          icon={<Activity className="w-4 h-4 text-blue-400" />}
          rows={movers.active}
          render={(q) => ({ primary: `Rp ${(q.value / 1e9).toFixed(1)} miliar`, cls: 'text-slate-200' })}
          onSelect={onSelectEmiten}
        />
        <MoverCard
          title={`Net Beli Asing Terbesar · ${db.live?.foreignFlowAsOf || db.meta.latestSession}`}
          icon={<Globe2 className="w-4 h-4 text-emerald-400" />}
          rows={movers.inflow}
          render={(q) => ({ primary: `+Rp ${(q.foreignNet / 1e9).toFixed(1)} miliar`, cls: 'text-emerald-400' })}
          onSelect={onSelectEmiten}
        />
        <MoverCard
          title={`Net Jual Asing Terbesar · ${db.live?.foreignFlowAsOf || db.meta.latestSession}`}
          icon={<Globe2 className="w-4 h-4 text-rose-400" />}
          rows={movers.outflow}
          render={(q) => ({ primary: `Rp ${(q.foreignNet / 1e9).toFixed(1)} miliar`, cls: 'text-rose-400' })}
          onSelect={onSelectEmiten}
        />
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 text-[11px] text-slate-400 space-y-2">
          <div className="text-sm font-bold text-white mb-2">Sumber Data</div>
          {db.meta.sources.map((s) => (
            <div key={s} className="font-mono text-[10px] text-slate-500">
              {s}
            </div>
          ))}
          <div className="pt-3 mt-3 border-t border-slate-800">
            Snapshot dibuat {new Date(db.meta.generatedAt).toLocaleString('id-ID')}. Jalankan{' '}
            <code className="text-blue-400">npm run data:refresh</code> untuk menarik sesi terbaru.
          </div>
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
    <div className={`text-base font-bold tabular-nums ${valueClass}`}>{value}</div>
    {hint && <div className="text-[10px] text-slate-500">{hint}</div>}
  </div>
);

interface MoverRow {
  emiten: { code: string; name: string };
  quote?: { change: number; value: number; foreignNet: number; close: number };
}

const MoverCard: React.FC<{
  title: string;
  icon: React.ReactNode;
  rows: MoverRow[];
  render: (q: NonNullable<MoverRow['quote']>) => { primary: string; cls: string };
  onSelect: (code: string) => void;
}> = ({ title, icon, rows, render, onSelect }) => (
  <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
    <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800">
      {icon}
      <h4 className="text-xs font-bold text-white">{title}</h4>
    </div>
    <div className="divide-y divide-slate-800/60">
      {rows.map(({ emiten, quote }) => {
        if (!quote) return null;
        const { primary, cls } = render(quote);
        return (
          <button
            key={emiten.code}
            onClick={() => onSelect(emiten.code)}
            className="w-full flex items-center justify-between px-4 py-2 hover:bg-slate-800/40 transition-colors cursor-pointer text-left"
          >
            <div className="min-w-0">
              <div className="text-xs font-bold text-slate-100">{emiten.code}</div>
              <div className="text-[10px] text-slate-500 truncate max-w-[170px]">{emiten.name}</div>
            </div>
            <div className="text-right shrink-0">
              <div className={`text-xs font-bold tabular-nums ${cls}`}>{primary}</div>
              <div className="text-[10px] text-slate-500 tabular-nums">Rp {idr(quote.close)}</div>
            </div>
          </button>
        );
      })}
    </div>
  </div>
);
