import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Crosshair,
  Filter,
  Sparkles,
  Target,
  TrendingUp,
} from 'lucide-react';
import { FactorSnapshot, MarketBreadth, ScreenFilters, StockPick, StrategyId } from '../../types/market';
import { MarketDatabase } from '../../data/marketRepository';
import {
  DEFAULT_PLAN_SETTINGS,
  STRATEGY_PROFILES,
  buildDailyBriefing,
  runScreen,
} from '../../models/alphaScreener';

interface Props {
  db: MarketDatabase;
  factors: Map<string, FactorSnapshot> | null;
  breadth: MarketBreadth | null;
  onSelectEmiten: (code: string) => void;
  onModelEmiten: (code: string) => void;
}

const pct = (v: number, d = 1) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%` : '–');
const rp = (v: number, d = 0) => (Number.isFinite(v) ? v.toLocaleString('id-ID', { maximumFractionDigits: d }) : '–');

/** Broad indices worth screening inside; sector indices are covered by the sector filter. */
const BROAD_INDEX_FILTERS = ['LQ45', 'IDX30', 'IDX80', 'KOMPAS100', 'IDXBUMN20', 'JII', 'IDXHIDIV20', 'IDXQ30', 'IDXV30'];

const CONVICTION_STYLES: Record<StockPick['conviction'], string> = {
  high: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  medium: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  speculative: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
};
// The bottom tier catches two different things — a genuinely low score, and a
// good score on a risky security that was demoted — so it is labelled by
// conviction, not by security type. The risk flags say which case it is.
const CONVICTION_LABELS: Record<StockPick['conviction'], string> = {
  high: 'Konviksi Tinggi',
  medium: 'Konviksi Sedang',
  speculative: 'Konviksi Rendah',
};

export const AlphaScreener: React.FC<Props> = ({ db, factors, breadth, onSelectEmiten, onModelEmiten }) => {
  const [strategyId, setStrategyId] = useState<StrategyId>('balanced-alpha');
  const [showFilters, setShowFilters] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [riskBudget, setRiskBudget] = useState(DEFAULT_PLAN_SETTINGS.riskBudgetIdr);
  const [overrides, setOverrides] = useState<Partial<ScreenFilters>>({});

  const result = useMemo(
    () =>
      runScreen(db, {
        strategyId,
        filters: overrides,
        plan: { riskBudgetIdr: riskBudget },
        factors: factors || undefined,
      }),
    [db, factors, strategyId, overrides, riskBudget]
  );

  const briefing = useMemo(
    () => buildDailyBriefing(result, breadth?.advancers ?? 0, breadth?.decliners ?? 0),
    [result, breadth]
  );

  const filters = result.filters;
  const setFilter = (patch: Partial<ScreenFilters>) => setOverrides((o) => ({ ...o, ...patch }));

  return (
    <div className="space-y-5">
      {/* --- strategy picker */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {STRATEGY_PROFILES.map((s) => {
          const active = s.id === strategyId;
          return (
            <button
              key={s.id}
              onClick={() => setStrategyId(s.id)}
              className={`text-left p-4 rounded-xl border transition-all cursor-pointer ${
                active
                  ? 'bg-indigo-600/15 border-indigo-500/50 shadow-lg shadow-indigo-900/30'
                  : 'bg-slate-900 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <Sparkles className={`w-3.5 h-3.5 ${active ? 'text-indigo-300' : 'text-slate-500'}`} />
                <span className={`text-xs font-bold ${active ? 'text-white' : 'text-slate-200'}`}>{s.name}</span>
              </div>
              <div className="text-[11px] text-slate-400 mt-1.5 leading-snug">{s.tagline}</div>
              {active && <div className="text-[11px] text-slate-500 mt-2 leading-relaxed">{s.description}</div>}
            </button>
          );
        })}
      </div>

      {/* --- briefing */}
      <div className="bg-gradient-to-r from-blue-950/50 to-slate-900 border border-blue-800/40 rounded-2xl p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <TrendingUp className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="text-xs font-bold text-white mb-1">Ringkasan Harian — {result.session}</div>
            <p className="text-[12px] text-slate-300 leading-relaxed">{briefing}</p>
          </div>
          <button
            onClick={() => setShowFilters((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold rounded-lg border border-slate-700 transition-all cursor-pointer shrink-0"
          >
            <Filter className="w-3.5 h-3.5" />
            Filter
            {showFilters ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>

        {showFilters && (
          <div className="mt-4 pt-4 border-t border-blue-900/40 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            <NumField
              label="Harga minimum (Rp)"
              value={filters.minClose}
              onChange={(v) => setFilter({ minClose: v })}
              hint="Rp 50 adalah batas bawah auto-reject"
            />
            <NumField
              label="Likuiditas min (Rp miliar/hari)"
              value={filters.minMedianValueIdrBn}
              onChange={(v) => setFilter({ minMedianValueIdrBn: v })}
              hint="median nilai transaksi 20 sesi"
              step={0.5}
            />
            <NumField
              label="Kapitalisasi min (Rp miliar)"
              value={filters.minMarketCapIdrBn}
              onChange={(v) => setFilter({ minMarketCapIdrBn: v })}
              step={100}
            />
            <NumField
              label="Jumlah pilihan"
              value={filters.maxPicks}
              onChange={(v) => setFilter({ maxPicks: Math.max(1, Math.min(50, v)) })}
              step={5}
            />
            <NumField
              label="Anggaran risiko (Rp)"
              value={riskBudget}
              onChange={setRiskBudget}
              step={1_000_000}
              hint="rupiah yang siap hilang bila stop kena"
            />
            <div>
              <label className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold block mb-1.5">
                Sektor
              </label>
              <select
                value={filters.sectors[0] || ''}
                onChange={(e) => setFilter({ sectors: e.target.value ? [e.target.value] : [] })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-slate-200 cursor-pointer focus:outline-none"
              >
                <option value="">Semua sektor</option>
                {db.sectors.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold block mb-1.5">
                Papan pencatatan
              </label>
              <select
                value={filters.excludeBoards.join(',')}
                onChange={(e) => setFilter({ excludeBoards: e.target.value ? e.target.value.split(',') : [] })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-slate-200 cursor-pointer focus:outline-none"
              >
                <option value="Acceleration">Kecualikan Akselerasi</option>
                <option value="Acceleration,Development">Kecualikan Akselerasi + Pengembangan</option>
                <option value="">Sertakan semua papan</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold block mb-1.5">
                Batasi ke indeks
              </label>
              <select
                value={filters.indexFilter}
                onChange={(e) => setFilter({ indexFilter: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-slate-200 cursor-pointer focus:outline-none"
              >
                <option value="">Seluruh pasar</option>
                {BROAD_INDEX_FILTERS.filter((c) => db.indexSeries.has(c)).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <div className="text-[10px] text-slate-600 mt-1">
                Perkiraan: IDX tidak menerbitkan konstituen indeks secara terbuka, jadi keanggotaan didekati dari
                emiten paling likuid sebanyak jumlah anggota indeks.
              </div>
            </div>

            <div className="flex items-end">
              <button
                onClick={() => {
                  setOverrides({});
                  setRiskBudget(DEFAULT_PLAN_SETTINGS.riskBudgetIdr);
                }}
                className="text-[11px] font-bold text-slate-400 hover:text-slate-200 underline cursor-pointer"
              >
                Kembalikan ke default
              </button>
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-slate-500">
          <span>
            Semesta: <strong className="text-slate-300">{result.universeSize}</strong> emiten
          </span>
          <span>
            Lolos filter: <strong className="text-slate-300">{result.eligibleSize}</strong>
          </span>
          <span>
            Ditampilkan: <strong className="text-slate-300">{result.picks.length}</strong>
          </span>
          <span>
            Ambang likuiditas: <strong className="text-slate-300">Rp {filters.minMedianValueIdrBn} M/hari</strong>
          </span>
        </div>
      </div>

      {/* --- picks */}
      {result.picks.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-10 text-center">
          <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-3" />
          <div className="text-sm font-bold text-white">Tidak ada emiten yang lolos filter</div>
          <p className="text-xs text-slate-400 mt-2">Longgarkan ambang likuiditas atau kapitalisasi pasar.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {result.picks.map((pick) => (
            <PickCard
              key={pick.emiten.code}
              pick={pick}
              expanded={expanded === pick.emiten.code}
              onToggle={() => setExpanded((c) => (c === pick.emiten.code ? null : pick.emiten.code))}
              onSelect={() => onSelectEmiten(pick.emiten.code)}
              onModel={() => onModelEmiten(pick.emiten.code)}
            />
          ))}
        </div>
      )}

      {/* --- rejections */}
      <details className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        <summary className="px-5 py-3.5 text-xs font-bold text-slate-300 cursor-pointer hover:bg-slate-800/40">
          Mengapa {result.universeSize - result.eligibleSize} emiten tersaring keluar?
        </summary>
        <div className="px-5 pb-4 grid grid-cols-2 md:grid-cols-3 gap-2">
          {Object.entries(result.rejectedReasons)
            .sort((a, b) => b[1] - a[1])
            .map(([reason, count]) => (
              <div key={reason} className="flex items-center justify-between bg-slate-950 rounded-lg px-3 py-2">
                <span className="text-[11px] text-slate-400">{reason}</span>
                <span className="text-[11px] font-bold text-slate-200 tabular-nums">{count}</span>
              </div>
            ))}
        </div>
      </details>

      <p className="text-[11px] text-slate-500 leading-relaxed px-1">
        Skor bersifat lintas-emiten (cross-sectional) terhadap semesta yang lolos filter pada sesi yang sama, jadi +1,50
        berarti 1,5 simpangan baku di atas median kandidat hari itu — bukan prediksi return. Seluruh faktor dihitung dari
        harga, volume, nilai transaksi, dan arus dana asing yang dipublikasikan IDX; tidak ada faktor fundamental di
        dalam skor ini. Rencana perdagangan memakai ATR-14 dan sudah dibulatkan ke fraksi harga IDX. Ini alat riset,
        bukan rekomendasi investasi.
      </p>
    </div>
  );
};

const NumField: React.FC<{
  label: string;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
  step?: number;
}> = ({ label, value, onChange, hint, step = 1 }) => (
  <div>
    <label className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold block mb-1.5">{label}</label>
    <input
      type="number"
      value={value}
      step={step}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-slate-100 tabular-nums focus:outline-none focus:border-blue-600"
    />
    {hint && <div className="text-[10px] text-slate-600 mt-1">{hint}</div>}
  </div>
);

const PickCard: React.FC<{
  pick: StockPick;
  expanded: boolean;
  onToggle: () => void;
  onSelect: () => void;
  onModel: () => void;
}> = ({ pick, expanded, onToggle, onSelect, onModel }) => {
  const { emiten, factors: f, plan } = pick;
  const maxAbs = Math.max(...pick.contributions.map((c) => Math.abs(c.contribution)), 0.01);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden hover:border-slate-700 transition-colors">
      <div className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center shrink-0">
              <span className="text-sm font-extrabold text-slate-300 tabular-nums">#{pick.rank}</span>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={onSelect}
                  className="text-lg font-extrabold text-white hover:text-blue-400 transition-colors cursor-pointer"
                >
                  {emiten.code}
                </button>
                <span
                  className={`px-2 py-0.5 text-[10px] font-bold rounded-full border ${CONVICTION_STYLES[pick.conviction]}`}
                >
                  {CONVICTION_LABELS[pick.conviction]}
                </span>
                <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-slate-800 text-slate-400">
                  {emiten.sector}
                </span>
                {emiten.board !== 'Main' && (
                  <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    Papan {emiten.board}
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5 truncate max-w-md">{emiten.name}</div>
              <div className="text-[10px] text-slate-600 mt-0.5 truncate max-w-md">{emiten.subIndustry}</div>
            </div>
          </div>

          <div className="text-right shrink-0">
            <div className="text-[10px] uppercase text-slate-500 font-semibold">Skor Komposit</div>
            <div className="text-2xl font-extrabold text-white tabular-nums">{pick.compositeScore.toFixed(2)}</div>
            <div className="text-[10px] text-slate-500">persentil {(pick.percentile * 100).toFixed(0)}</div>
          </div>
        </div>

        {/* key metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mt-4 pt-4 border-t border-slate-800">
          <Metric label="Harga" value={`Rp ${rp(f.close)}`} />
          <Metric label="3 Bln" value={pct(f.return3m)} tone={f.return3m} />
          <Metric label="vs IHSG" value={pct(f.relativeStrength3m)} tone={f.relativeStrength3m} />
          <Metric label="vs MA200" value={pct(f.priceVsSma200)} tone={f.priceVsSma200} />
          <Metric label="RSI-14" value={Number.isFinite(f.rsi14) ? f.rsi14.toFixed(0) : '–'} />
          <Metric label="Asing 20H" value={`Rp ${rp(f.foreignNet20IdrBn, 1)} M`} tone={f.foreignNet20IdrBn} />
          <Metric label="Likuiditas" value={`Rp ${rp(f.medianValue20IdrBn, 1)} M`} />
        </div>

        {/* trade plan */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-3 bg-slate-950/70 border border-slate-800 rounded-xl p-3.5">
          <PlanCell icon={<Crosshair className="w-3 h-3" />} label="Entry" value={`Rp ${rp(plan.entry)}`} />
          <PlanCell
            label="Stop Loss"
            value={`Rp ${rp(plan.stopLoss)}`}
            sub={`-${(((plan.entry - plan.stopLoss) / plan.entry) * 100).toFixed(1)}%`}
            cls="text-rose-400"
          />
          <PlanCell
            icon={<Target className="w-3 h-3" />}
            label="Target 1"
            value={`Rp ${rp(plan.target1)}`}
            sub={`+${(((plan.target1 - plan.entry) / plan.entry) * 100).toFixed(1)}%`}
            cls="text-emerald-400"
          />
          <PlanCell
            label="Target 2"
            value={`Rp ${rp(plan.target2)}`}
            sub={`+${(((plan.target2 - plan.entry) / plan.entry) * 100).toFixed(1)}%`}
            cls="text-emerald-400"
          />
          <PlanCell label="Risk : Reward" value={`1 : ${plan.rewardRiskRatio.toFixed(2)}`} />
          <PlanCell
            label="Ukuran posisi"
            value={`${rp(plan.suggestedLots)} lot`}
            sub={
              plan.suggestedLots >= plan.liquidityCappedLots
                ? `Rp ${rp(plan.positionValueIdr)} · dibatasi likuiditas`
                : `Rp ${rp(plan.positionValueIdr)}`
            }
          />
        </div>

        {pick.flags.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {pick.flags.map((flag) => (
              <span
                key={flag}
                className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20"
              >
                <AlertTriangle className="w-2.5 h-2.5" />
                {flag}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 mt-4">
          <button
            onClick={onToggle}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold rounded-lg transition-all cursor-pointer"
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {expanded ? 'Sembunyikan alasan' : 'Lihat alasan & kontribusi faktor'}
          </button>
          <button
            onClick={onModel}
            className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold rounded-lg transition-all cursor-pointer"
          >
            Bangun Model DCF / LBO
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-800 bg-slate-950/50 p-4 sm:p-5 grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          <div>
            <div className="text-[11px] font-bold text-slate-300 uppercase tracking-wide mb-3">Kontribusi Faktor</div>
            <div className="space-y-2">
              {pick.contributions.map((c) => (
                <div key={c.block} className="flex items-center gap-3">
                  <span className="text-[11px] text-slate-400 w-44 shrink-0">{c.label}</span>
                  <div className="flex-1 h-2 bg-slate-800 rounded-full relative overflow-hidden">
                    <div
                      className={`absolute top-0 h-full rounded-full ${
                        c.contribution >= 0 ? 'bg-emerald-500 left-1/2' : 'bg-rose-500 right-1/2'
                      }`}
                      style={{ width: `${(Math.abs(c.contribution) / maxAbs) * 50}%` }}
                    />
                    <div className="absolute left-1/2 top-0 w-px h-full bg-slate-600" />
                  </div>
                  <span
                    className={`text-[11px] font-bold tabular-nums w-14 text-right ${
                      c.contribution >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {c.contribution >= 0 ? '+' : ''}
                    {c.contribution.toFixed(2)}
                  </span>
                  <span className="text-[10px] text-slate-600 w-12 text-right tabular-nums">
                    {(c.weight * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[11px] font-bold text-slate-300 uppercase tracking-wide mb-3">Alasan Pemilihan</div>
            <ul className="space-y-2">
              {pick.rationale.map((r, i) => (
                <li key={i} className="flex gap-2 text-[11px] text-slate-400 leading-relaxed">
                  <span className="text-blue-500 shrink-0">•</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

const Metric: React.FC<{ label: string; value: string; tone?: number }> = ({ label, value, tone }) => (
  <div>
    <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">{label}</div>
    <div
      className={`text-xs font-bold tabular-nums ${
        tone === undefined || !Number.isFinite(tone)
          ? 'text-slate-100'
          : tone > 0
            ? 'text-emerald-400'
            : tone < 0
              ? 'text-rose-400'
              : 'text-slate-100'
      }`}
    >
      {value}
    </div>
  </div>
);

const PlanCell: React.FC<{
  label: string;
  value: string;
  sub?: string;
  cls?: string;
  icon?: React.ReactNode;
}> = ({ label, value, sub, cls = 'text-slate-100', icon }) => (
  <div>
    <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500 font-semibold">
      {icon}
      {label}
    </div>
    <div className={`text-xs font-bold tabular-nums ${cls}`}>{value}</div>
    {sub && <div className="text-[10px] text-slate-500 tabular-nums">{sub}</div>}
  </div>
);
