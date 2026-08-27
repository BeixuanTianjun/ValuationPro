import React, { useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, ExternalLink, Info, X } from 'lucide-react';
import { FactorSnapshot } from '../../types/market';
import { MarketDatabase } from '../../data/marketRepository';
import { FundamentalsDatabase } from '../../data/fundamentalsRepository';
import { buildEmitenModel } from '../../models/idxCompanyBridge';

interface Props {
  code: string;
  db: MarketDatabase;
  fundamentals: FundamentalsDatabase | null;
  factors: Map<string, FactorSnapshot> | null;
  onClose: () => void;
  onApplyToModels: (code: string) => void;
}

const pct = (v: number | undefined, d = 1) =>
  Number.isFinite(v as number) ? `${(v as number) >= 0 ? '+' : ''}${((v as number) * 100).toFixed(d)}%` : '–';
/** For readings that have no direction — volatility, yields — a leading + is noise. */
const plainPct = (v: number | undefined, d = 1) =>
  Number.isFinite(v as number) ? `${((v as number) * 100).toFixed(d)}%` : '–';
const rp = (v: number | undefined, d = 0) =>
  Number.isFinite(v as number) ? (v as number).toLocaleString('id-ID', { maximumFractionDigits: d }) : '–';
const tone = (v: number | undefined) =>
  !Number.isFinite(v as number) ? 'text-slate-400' : (v as number) > 0 ? 'text-emerald-400' : (v as number) < 0 ? 'text-rose-400' : 'text-slate-400';

export const EmitenDetail: React.FC<Props> = ({ code, db, fundamentals, factors, onClose, onApplyToModels }) => {
  const emiten = db.byCode.get(code);
  const quote = db.daily.get(code);
  const f = factors?.get(code);

  const chart = useMemo(() => {
    const s = db.series.get(code);
    if (!s) return [];
    const out: { date: string; close: number; foreign: number }[] = [];
    let last = NaN;
    let cumulative = 0;
    for (let i = 0; i < db.dates.length; i++) {
      const c = s.close[i];
      if (Number.isFinite(c) && c > 0) last = c;
      if (!Number.isFinite(last)) continue;
      if (Number.isFinite(s.foreignNet[i])) cumulative += s.foreignNet[i];
      out.push({ date: db.dates[i], close: last, foreign: Math.round(cumulative / 1e3) });
    }
    return out;
  }, [db, code]);

  const bundle = useMemo(
    () => (emiten && fundamentals ? buildEmitenModel(emiten, db, fundamentals) : null),
    [emiten, db, fundamentals]
  );

  if (!emiten) return null;

  const yahooQuote = fundamentals?.quotes?.quotes?.[code];

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
      <div className="flex items-start justify-between px-5 py-4 border-b border-slate-800 gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-lg font-extrabold text-white">{emiten.code}</h3>
            <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-slate-800 text-slate-400">
              {emiten.sector}
            </span>
            <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-slate-800 text-slate-400">
              Papan {emiten.board}
            </span>
            {emiten.website && (
              <a
                href={emiten.website.startsWith('http') ? emiten.website : `https://${emiten.website}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300"
              >
                <ExternalLink className="w-2.5 h-2.5" />
                situs
              </a>
            )}
          </div>
          <div className="text-xs text-slate-300 mt-0.5">{emiten.fullName}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {emiten.industry} · {emiten.subIndustry} · tercatat {emiten.listingDate}
          </div>
        </div>
        <div className="flex items-start gap-4 shrink-0">
          <div className="text-right">
            <div className="text-2xl font-extrabold text-white tabular-nums">Rp {rp(quote?.close)}</div>
            <div className={`text-xs font-bold tabular-nums ${tone(quote ? quote.change / 100 : undefined)}`}>
              {pct(quote ? quote.change / 100 : undefined, 2)} · sesi {db.meta.latestSession}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-500 hover:text-slate-200 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="p-5 space-y-5">
        {emiten.business && <p className="text-[11px] text-slate-400 leading-relaxed">{emiten.business}</p>}

        {/* price + cumulative foreign flow */}
        <div className="h-56 bg-slate-950/50 border border-slate-800 rounded-xl p-3">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chart} margin={{ top: 5, right: 5, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="px" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 9 }} minTickGap={50} />
              <YAxis
                yAxisId="price"
                tick={{ fill: '#64748b', fontSize: 9 }}
                domain={['dataMin', 'dataMax']}
                width={55}
              />
              <YAxis yAxisId="flow" orientation="right" tick={{ fill: '#475569', fontSize: 9 }} width={45} />
              <Tooltip
                contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }}
                formatter={(v: number, name: string) =>
                  name === 'close' ? [`Rp ${rp(v)}`, 'Harga'] : [`Rp ${rp(v)} miliar`, 'Akumulasi asing']
                }
              />
              <Area
                yAxisId="price"
                type="monotone"
                dataKey="close"
                stroke="#3b82f6"
                strokeWidth={1.8}
                fill="url(#px)"
              />
              <Area
                yAxisId="flow"
                type="monotone"
                dataKey="foreign"
                stroke="#f59e0b"
                strokeWidth={1.2}
                fill="none"
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* factor grid */}
        {f && (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            <Cell label="Return 1 bln" value={pct(f.return1m)} tone={f.return1m} />
            <Cell label="Return 3 bln" value={pct(f.return3m)} tone={f.return3m} />
            <Cell label="Return 12 bln" value={pct(f.return12m)} tone={f.return12m} />
            <Cell label="vs MA50" value={pct(f.priceVsSma50)} tone={f.priceVsSma50} />
            <Cell label="vs MA200" value={pct(f.priceVsSma200)} tone={f.priceVsSma200} />
            <Cell label="Dari puncak 52 mgg" value={pct(f.distanceFrom52wHigh)} tone={f.distanceFrom52wHigh} />
            <Cell label="RSI-14" value={Number.isFinite(f.rsi14) ? f.rsi14.toFixed(0) : '–'} />
            <Cell label="Volatilitas thn" value={plainPct(f.annualisedVol, 0)} />
            <Cell label="ATR-14" value={`Rp ${rp(f.atr14, 1)}`} />
            <Cell label="Likuiditas 20H" value={`Rp ${rp(f.medianValue20IdrBn, 1)} miliar`} />
            <Cell label="Asing 20H" value={`Rp ${rp(f.foreignNet20IdrBn, 1)} miliar`} tone={f.foreignNet20IdrBn} />
            <Cell label="Kapitalisasi" value={`Rp ${rp(f.marketCapIdrBn)} miliar`} />
            {yahooQuote?.trailingPE != null && <Cell label="P/E (TTM)" value={rp(yahooQuote.trailingPE, 2)} />}
            {yahooQuote?.priceToBook != null && <Cell label="P/BV" value={rp(yahooQuote.priceToBook, 2)} />}
            {!!yahooQuote?.dividendYield && (
              <Cell label="Dividend yield" value={plainPct(yahooQuote.dividendYield, 2)} />
            )}
            {bundle && <Cell label="Beta vs IHSG" value={bundle.beta.toFixed(2)} />}
          </div>
        )}

        {/* statements + model handoff */}
        {bundle ? (
          <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="text-xs font-bold text-white">
                Laporan Keuangan Tahunan — {bundle.report.years.join(', ')}
              </div>
              <button
                onClick={() => onApplyToModels(code)}
                className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold rounded-lg transition-all cursor-pointer"
              >
                Kalibrasi Model DCF &amp; LBO
              </button>
            </div>

            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-[11px]">
                <thead className="text-slate-500">
                  <tr>
                    <th className="text-left py-1.5 font-semibold">Rp miliar</th>
                    {bundle.report.years.map((y) => (
                      <th key={y} className="text-right py-1.5 px-2 font-semibold">
                        {y}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {(
                    [
                      ['Pendapatan', 'revenue'],
                      ['EBITDA', 'ebitda'],
                      ['EBIT', 'ebit'],
                      ['Laba bersih', 'netIncome'],
                      ['CapEx', 'capex'],
                      ['Kas', 'cash'],
                      ['Total utang', 'totalDebt'],
                    ] as const
                  ).map(([label, key]) => (
                    <tr key={key} className="border-t border-slate-800/60">
                      <td className="py-1.5 text-slate-400">{label}</td>
                      {bundle.report.historicalData.map((r) => (
                        <td key={r.year} className="text-right py-1.5 px-2 tabular-nums">
                          {rp(r[key] as number)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {bundle.notes.map((n, i) => (
              <div key={i} className="flex gap-2 text-[10px] text-slate-500 leading-relaxed">
                <Info className="w-3 h-3 shrink-0 mt-0.5 text-slate-600" />
                <span>{n}</span>
              </div>
            ))}
            {bundle.warnings.map((w, i) => (
              <div key={i} className="flex gap-2 text-[10px] text-amber-400/90 leading-relaxed">
                <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                <span>{w}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex gap-2 bg-slate-950/60 border border-slate-800 rounded-xl p-4 text-[11px] text-slate-500">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
            <span>
              Laporan keuangan tahunan untuk {emiten.code} belum tersedia di database. Anda tetap bisa memodelkannya
              lewat <strong className="text-slate-300">Import Laporan Keuangan</strong> di header, atau jalankan{' '}
              <code className="text-blue-400">npm run data:fundamentals</code> untuk mencoba menariknya ulang.
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

const Cell: React.FC<{ label: string; value: string; tone?: number }> = ({ label, value, tone: t }) => (
  <div className="bg-slate-950/50 border border-slate-800 rounded-lg px-3 py-2">
    <div className="text-[9px] uppercase tracking-wide text-slate-500 font-semibold">{label}</div>
    <div className={`text-xs font-bold tabular-nums ${tone(t)}`}>{value}</div>
  </div>
);
