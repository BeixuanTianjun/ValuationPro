import React, { useMemo, useState } from 'react';
import { Building2, Search, SlidersHorizontal } from 'lucide-react';
import { Emiten, FactorSnapshot } from '../../types/market';
import { MarketDatabase } from '../../data/marketRepository';
import { FundamentalsDatabase } from '../../data/fundamentalsRepository';

interface Props {
  db: MarketDatabase;
  factors: Map<string, FactorSnapshot> | null;
  fundamentals: FundamentalsDatabase | null;
  selectedCode: string | null;
  onSelect: (code: string) => void;
}

type SortKey =
  | 'code'
  | 'marketCap'
  | 'change'
  | 'return1m'
  | 'return3m'
  | 'return12m'
  | 'liquidity'
  | 'pe'
  | 'pbv'
  | 'foreign20';

const pct = (v: number | null | undefined, d = 1) =>
  Number.isFinite(v as number) ? `${(v as number) >= 0 ? '+' : ''}${((v as number) * 100).toFixed(d)}%` : '–';
const num = (v: number | null | undefined, d = 1) =>
  Number.isFinite(v as number) ? (v as number).toLocaleString('id-ID', { maximumFractionDigits: d }) : '–';
const tone = (v: number | null | undefined) =>
  !Number.isFinite(v as number) ? 'text-slate-500' : (v as number) > 0 ? 'text-emerald-400' : (v as number) < 0 ? 'text-rose-400' : 'text-slate-400';

const PAGE = 60;

export const EmitenBrowser: React.FC<Props> = ({ db, factors, fundamentals, selectedCode, onSelect }) => {
  const [query, setQuery] = useState('');
  const [sector, setSector] = useState('');
  const [board, setBoard] = useState('');
  const [onlyWithStatements, setOnlyWithStatements] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('marketCap');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [limit, setLimit] = useState(PAGE);

  const rows = useMemo(() => {
    const q = query.trim().toUpperCase();
    const quotes = fundamentals?.quotes?.quotes;
    const statements = fundamentals?.fundamentals?.companies;

    const built = db.emiten
      .filter((e) => {
        if (sector && e.sector !== sector) return false;
        if (board && e.board !== board) return false;
        if (onlyWithStatements && !statements?.[e.code]) return false;
        if (!q) return true;
        return `${e.code} ${e.name} ${e.fullName} ${e.subIndustry} ${e.industry}`.toUpperCase().includes(q);
      })
      .map((e) => {
        const d = db.daily.get(e.code);
        const f = factors?.get(e.code);
        const qt = quotes?.[e.code];
        return {
          emiten: e,
          close: d?.close || d?.prev || 0,
          change: d ? d.change / 100 : NaN,
          marketCap: d ? d.marketCap / 1e9 : NaN,
          return1m: f?.return1m ?? NaN,
          return3m: f?.return3m ?? NaN,
          return12m: f?.return12m ?? NaN,
          liquidity: f?.medianValue20IdrBn ?? NaN,
          foreign20: f?.foreignNet20IdrBn ?? NaN,
          pe: qt?.trailingPE ?? NaN,
          pbv: qt?.priceToBook ?? NaN,
          hasStatements: !!statements?.[e.code],
          ufcfOk: statements?.[e.code]?.quality?.suitableForUfcf ?? false,
        };
      });

    const dir = sortDir === 'asc' ? 1 : -1;
    built.sort((a, b) => {
      if (sortKey === 'code') return dir * a.emiten.code.localeCompare(b.emiten.code);
      const av = a[sortKey] as number;
      const bv = b[sortKey] as number;
      const aOk = Number.isFinite(av);
      const bOk = Number.isFinite(bv);
      if (!aOk && !bOk) return 0;
      if (!aOk) return 1; // blanks always sink, regardless of direction
      if (!bOk) return -1;
      return dir * (av - bv);
    });
    return built;
  }, [db, factors, fundamentals, query, sector, board, onlyWithStatements, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(key === 'code' ? 'asc' : 'desc');
    }
    setLimit(PAGE);
  };

  const header = (key: SortKey, label: string, align: 'left' | 'right' = 'right') => (
    <th
      onClick={() => toggleSort(key)}
      className={`px-3 py-2.5 font-semibold cursor-pointer select-none hover:text-slate-100 whitespace-nowrap text-${align}`}
    >
      {label}
      {sortKey === key && <span className="ml-1 text-blue-400">{sortDir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  );

  const covered = fundamentals?.fundamentals?.covered ?? 0;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-800 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-blue-400" />
            <h3 className="text-sm font-bold text-white">
              Basis Data Emiten IDX — {db.emiten.length} emiten tercatat
            </h3>
            {covered > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold">
                {covered} dengan laporan keuangan
              </span>
            )}
          </div>
          <span className="text-[11px] text-slate-500">{rows.length} hasil</span>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 flex-1 min-w-[220px]">
            <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(PAGE);
              }}
              placeholder="Cari kode, nama, atau sub-industri… (mis. BBCA, batu bara, menara)"
              className="bg-transparent text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none w-full"
            />
          </div>

          <select
            value={sector}
            onChange={(e) => {
              setSector(e.target.value);
              setLimit(PAGE);
            }}
            className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 cursor-pointer focus:outline-none"
          >
            <option value="">Semua sektor</option>
            {db.sectors.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <select
            value={board}
            onChange={(e) => {
              setBoard(e.target.value);
              setLimit(PAGE);
            }}
            className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 cursor-pointer focus:outline-none"
          >
            <option value="">Semua papan</option>
            {db.boards.map((b) => (
              <option key={b} value={b}>
                Papan {b}
              </option>
            ))}
          </select>

          <button
            onClick={() => {
              setOnlyWithStatements((v) => !v);
              setLimit(PAGE);
            }}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-bold border transition-all cursor-pointer ${
              onlyWithStatements
                ? 'bg-emerald-600/20 text-emerald-300 border-emerald-500/40'
                : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Hanya yang ada laporan keuangan
          </button>
        </div>
      </div>

      <div className="overflow-x-auto scrollbar-thin max-h-[640px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-950/90 text-slate-400 sticky top-0 z-10">
            <tr>
              {header('code', 'Emiten', 'left')}
              <th className="px-3 py-2.5 font-semibold text-left">Sektor</th>
              <th className="px-3 py-2.5 font-semibold text-right">Harga</th>
              {header('change', 'Harian')}
              {header('return1m', '1 Bln')}
              {header('return3m', '3 Bln')}
              {header('return12m', '12 Bln')}
              {header('marketCap', 'Kap. (Rp miliar)')}
              {header('liquidity', 'Likuiditas')}
              {header('foreign20', 'Asing 20H')}
              {header('pe', 'P/E')}
              {header('pbv', 'P/BV')}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((r) => (
              <tr
                key={r.emiten.code}
                onClick={() => onSelect(r.emiten.code)}
                className={`border-t border-slate-800/60 cursor-pointer transition-colors ${
                  selectedCode === r.emiten.code ? 'bg-blue-600/15' : 'hover:bg-slate-800/40'
                }`}
              >
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-slate-100">{r.emiten.code}</span>
                    {r.hasStatements && (
                      <span
                        title={r.ufcfOk ? 'Laporan keuangan lengkap untuk DCF' : 'Laporan ada, tetapi tidak cocok untuk DCF unlevered'}
                        className={`w-1.5 h-1.5 rounded-full ${r.ufcfOk ? 'bg-emerald-400' : 'bg-amber-400'}`}
                      />
                    )}
                  </div>
                  <div className="text-[10px] text-slate-500 truncate max-w-[190px]">{r.emiten.name}</div>
                </td>
                <td className="px-3 py-2 text-slate-400">
                  <div className="text-[10px]">{r.emiten.sector}</div>
                  <div className="text-[10px] text-slate-600 truncate max-w-[150px]">{r.emiten.subIndustry}</div>
                </td>
                <td className="px-3 py-2 text-right text-slate-100 font-semibold tabular-nums">{num(r.close, 0)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${tone(r.change)}`}>{pct(r.change, 2)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${tone(r.return1m)}`}>{pct(r.return1m)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${tone(r.return3m)}`}>{pct(r.return3m)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${tone(r.return12m)}`}>{pct(r.return12m)}</td>
                <td className="px-3 py-2 text-right text-slate-300 tabular-nums">{num(r.marketCap, 0)}</td>
                <td className="px-3 py-2 text-right text-slate-400 tabular-nums">{num(r.liquidity, 1)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${tone(r.foreign20)}`}>{num(r.foreign20, 1)}</td>
                <td className="px-3 py-2 text-right text-slate-300 tabular-nums">{num(r.pe, 1)}</td>
                <td className="px-3 py-2 text-right text-slate-300 tabular-nums">{num(r.pbv, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {rows.length > limit && (
          <button
            onClick={() => setLimit((l) => l + PAGE * 2)}
            className="w-full py-3 text-xs font-bold text-blue-400 hover:bg-slate-800/40 transition-colors cursor-pointer border-t border-slate-800"
          >
            Tampilkan {Math.min(PAGE * 2, rows.length - limit)} emiten lagi ({rows.length - limit} tersisa)
          </button>
        )}
        {!rows.length && (
          <div className="py-12 text-center text-xs text-slate-500">Tidak ada emiten yang cocok dengan filter ini.</div>
        )}
      </div>
    </div>
  );
};

export type { Emiten };
