import React, { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Crosshair, Filter, Info, RotateCcw, Search, SlidersHorizontal, Target, X } from 'lucide-react';
import { MarketDatabase } from '../../data/marketRepository';
import { FactorSnapshot } from '../../types/market';
import { TradingViewChart } from './TradingViewChart';
import {
  DEFAULT_SCREENER_SETTINGS,
  SCREENER_MODES,
  ScreenerMode,
  ScreenerRow,
  ScreenerSettings,
  convictionScore,
  runStockScreener,
} from '../../models/stockScreener';
import { TradeSetup, buildTradeSetup } from '../../models/tradeSetup';
import {
  EmptyState,
  Panel,
  PanelHeader,
  Pill,
  Segmented,
  SourceNote,
  Stat,
  StatGrid,
  TableScroll,
  Td,
  Th,
  cx,
} from '../common/ui';

interface Props {
  db: MarketDatabase;
  factors: Map<string, FactorSnapshot> | null;
  onSelectEmiten: (code: string) => void;
}

/** How many rows show by default — the rest are one click away, never gone. */
const DEFAULT_SHOWN = 5;

const rp = (v: number, d = 0) => (Number.isFinite(v) ? v.toLocaleString('id-ID', { maximumFractionDigits: d }) : '–');
const pct = (v: number, d = 1) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%` : '–');
const pp = (v: number, d = 1) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(d)} pp` : '–');
const shares = (v: number) => {
  if (!Number.isFinite(v)) return '–';
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)} mr`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)} jt`;
  return `${(v / 1e3).toFixed(0)} rb`;
};
const bn = (v: number, d = 1) => (Number.isFinite(v) ? `${(v / 1e9).toFixed(d)}` : '–');

/**
 * Green when early, amber when it has run, red when it has already flown.
 *
 * The thresholds are deliberately the same ones the conviction score fades
 * over, so a row that looks red here is a row the ranking has already pushed
 * down — the colour explains the order rather than contradicting it.
 */
const lateTone = (v: number, warn: number, bad: number) =>
  !Number.isFinite(v) ? 'text-slate-500' : v >= bad ? 'text-rose-400' : v >= warn ? 'text-amber-300' : 'text-emerald-300';

type SortKey =
  | 'conviction'
  | 'valueIdr'
  | 'changePercent'
  | 'volumeShares'
  | 'premiumToMaLong'
  | 'volumeSurge'
  | 'sessionsAboveMaLong'
  | 'foreignNetIdrBn'
  | 'dipDepth'
  | 'gapToIndexPp'
  | 'freshness'
  | 'leastExtended';

/**
 * Sort options per mode.
 *
 * "Deepest dip first" is offered as `dipDepth`, the NEGATED distance from the
 * high, because every sort in this table runs descending. Offering the raw
 * `dipFromHigh` would have put the shallowest dip at the top under a label
 * saying otherwise — the kind of inversion nobody notices because both ends of
 * the list look plausible.
 */
const SHARED_SORTS: { key: SortKey; label: string }[] = [
  { key: 'conviction', label: 'Conviction' },
  { key: 'valueIdr', label: 'Nilai transaksi' },
  { key: 'changePercent', label: 'Perubahan' },
  { key: 'volumeShares', label: 'Volume' },
  { key: 'volumeSurge', label: 'Lonjakan volume' },
  { key: 'foreignNetIdrBn', label: 'Asing hari ini' },
];

const SORTS: Record<ScreenerMode, { key: SortKey; label: string }[]> = {
  momentum: [
    ...SHARED_SORTS,
    { key: 'freshness', label: 'Paling baru menembus' },
    { key: 'leastExtended', label: 'Paling belum meregang' },
    { key: 'premiumToMaLong', label: 'Jarak ke MA' },
    { key: 'sessionsAboveMaLong', label: 'Hari di atas MA' },
  ],
  pullback: [...SHARED_SORTS, { key: 'dipDepth', label: 'Diskon terdalam' }],
  laggard: [...SHARED_SORTS, { key: 'gapToIndexPp', label: 'Jarak ke indeks' }],
};

interface RankedRow extends ScreenerRow {
  conviction: number;
  /** Distance below the window high as a POSITIVE number, so sorts read right. */
  dipDepth: number;
  /**
   * Both of these are NEGATED, for the same reason `dipDepth` is: every sort in
   * this table runs descending, so "freshest first" has to be a number that is
   * LARGER when the value is smaller. Sorting on the raw session count under a
   * label saying "paling baru menembus" would list the stalest row first.
   */
  freshness: number;
  leastExtended: number;
}

/** The columns that change with the mode. Everything else is shared. */
const MODE_COLUMNS: Record<
  ScreenerMode,
  { header: string; title?: string; render: (r: RankedRow, s: ScreenerSettings) => React.ReactNode; className?: string }[]
> = {
  momentum: [
    { header: 'MA panjang', render: (r) => rp(r.maLong, 1), className: 'text-slate-400' },
    {
      header: 'Hari',
      title: 'Berapa sesi berturut-turut close bertahan di atas MA panjang. 1 = baru menembus hari ini.',
      render: (r) => (
        <span className={r.sessionsAboveMaLong <= 2 ? 'font-bold text-emerald-300' : 'text-slate-400'}>
          {r.sessionsAboveMaLong}
        </span>
      ),
    },
    {
      header: 'Sudah naik',
      title: 'Kenaikan yang SUDAH terjadi dari penutupan terendah 60 sesi. Makin besar, makin telat kita masuk.',
      render: (r) => (
        <span className={lateTone(r.runupFromLow, 0.3, 0.6)}>{pct(r.runupFromLow, 0)}</span>
      ),
    },
    {
      header: 'Regangan',
      title: 'Jarak harga di atas MA20 dalam satuan ATR-nya sendiri. Di atas 3 ATR berarti sudah jauh meregang dari rata-ratanya.',
      render: (r) => (
        <span className={lateTone(r.extensionAtr, 1.5, 3)}>
          {Number.isFinite(r.extensionAtr) ? `${r.extensionAtr.toFixed(1)} ATR` : '–'}
        </span>
      ),
    },
  ],
  pullback: [
    { header: 'MA tren', title: 'Rata-rata panjang yang menandai tren masih naik', render: (r) => rp(r.maTrend, 1), className: 'text-slate-400' },
    {
      header: 'Di atas MA tren',
      title: 'Jarak harga di atas MA panjang — bantalan di bawah koreksi ini',
      render: (r) => pct(r.premiumToMaTrend),
      className: 'text-emerald-400',
    },
    { header: 'Puncak', title: 'Penutupan tertinggi dalam jendela diskon', render: (r) => rp(r.highInWindow, 1), className: 'text-slate-400' },
    {
      header: 'Diskon',
      title: 'Jarak harga sekarang terhadap puncak itu',
      render: (r) => pct(r.dipFromHigh),
      className: 'font-bold text-amber-300',
    },
  ],
  laggard: [
    { header: 'Indeks acuan', render: (r) => r.indexCode, className: 'text-slate-400' },
    { header: 'Indeks', title: 'Return indeks acuan pada jendela yang sama', render: (r) => pct(r.indexReturn), className: 'text-emerald-400' },
    { header: 'Saham', title: 'Return emiten ini pada jendela yang sama', render: (r) => pct(r.stockReturn), className: 'text-slate-200' },
    {
      header: 'Jarak',
      title: 'Return indeks dikurangi return saham, dalam poin persentase',
      render: (r) => pp(r.gapToIndexPp),
      className: 'font-bold text-amber-300',
    },
  ],
};

const MODE_TONE: Record<ScreenerMode, string> = {
  momentum: 'text-emerald-400',
  pullback: 'text-amber-400',
  laggard: 'text-cyan-400',
};

/**
 * THE CHART OPENS HERE, IN THIS PANEL.
 *
 * It used to hand the code up to MarketWorkspace, which switched the tab to
 * Watchlist and asked it to expand that emiten. But the watchlist is a
 * four-stage funnel capped at 30 names and the screener is a hard-rule filter
 * over the whole exchange: measured on live data, only 15 of the screener's 92
 * rows survive into the weekly watchlist. Pressing "chart" on the other 77
 * carried the user to a screen full of unrelated tickers, expanded nothing, and
 * showed no chart — the button appeared to do something random. A control named
 * chart has to produce a chart for the row it was pressed on.
 *
 * THREE MODES SHARE THIS PANEL. The mode lives in `settings.mode`, so switching
 * it re-runs the same engine with a different rule set — see stockScreener.ts
 * for why they are not merged into one list. Everything that is mode-specific
 * (funnel labels, columns, thresholds, the failure explanation) is driven off
 * that one field, so a fourth mode would not need a fourth copy of this panel.
 */
export const StockScreenerPanel: React.FC<Props> = ({ db, factors, onSelectEmiten }) => {
  const [settings, setSettings] = useState<ScreenerSettings>(DEFAULT_SCREENER_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [sort, setSort] = useState<SortKey>('conviction');
  const [query, setQuery] = useState('');
  const [inspect, setInspect] = useState<string>('');
  const [chartCode, setChartCode] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const mode = settings.mode;
  const modeMeta = SCREENER_MODES.find((m) => m.id === mode) ?? SCREENER_MODES[0];
  const result = useMemo(() => runStockScreener(db, settings), [db, settings]);

  const rank = (r: ScreenerRow): RankedRow => ({
    ...r,
    conviction: convictionScore(r, factors?.get(r.code), mode),
    dipDepth: Number.isFinite(r.dipFromHigh) ? -r.dipFromHigh : NaN,
    freshness: Number.isFinite(r.sessionsAboveMaLong) ? -r.sessionsAboveMaLong : NaN,
    leastExtended: Number.isFinite(r.extensionAtr) ? -r.extensionAtr : NaN,
  });

  const ranked: RankedRow[] = useMemo(
    () => result.rows.map(rank),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [result.rows, factors, mode]
  );

  const rows = useMemo(() => {
    const q = query.trim().toUpperCase();
    const filtered = q ? ranked.filter((r) => r.code.includes(q) || r.name.toUpperCase().includes(q)) : ranked;
    const sorted = [...filtered].sort((a, b) => {
      const av = a[sort];
      const bv = b[sort];
      if (!Number.isFinite(av as number)) return 1;
      if (!Number.isFinite(bv as number)) return -1;
      return (bv as number) - (av as number);
    });
    return showAll || query.trim() ? sorted : sorted.slice(0, DEFAULT_SHOWN);
  }, [ranked, sort, query, showAll]);

  const inspectedRow: ScreenerRow | null = inspect ? (result.all.get(inspect.toUpperCase()) ?? null) : null;
  const inspected: RankedRow | null = inspectedRow ? rank(inspectedRow) : null;

  const inspectedSetup: TradeSetup | null = inspected
    ? buildTradeSetup({
        code: inspected.code,
        close: inspected.close,
        atr14: factors?.get(inspected.code)?.atr14 ?? NaN,
      })
    : null;

  const patch = (p: Partial<ScreenerSettings>) => setSettings((s) => ({ ...s, ...p }));

  /**
   * Switching mode resets the sort when the current one does not exist in the
   * new mode. Leaving a stale key there sorted every row identically (the
   * comparator sees undefined for both sides) — a table that silently stops
   * sorting looks exactly like a table with nothing to sort.
   */
  const setMode = (next: ScreenerMode) => {
    setSettings((s) => ({ ...s, mode: next }));
    setSort((current) => (SORTS[next].some((o) => o.key === current) ? current : 'conviction'));
  };

  const isDefault =
    settings.maShort === DEFAULT_SCREENER_SETTINGS.maShort &&
    settings.maLong === DEFAULT_SCREENER_SETTINGS.maLong &&
    settings.trendMa === DEFAULT_SCREENER_SETTINGS.trendMa &&
    settings.dipMa === DEFAULT_SCREENER_SETTINGS.dipMa &&
    settings.minDipPercent === DEFAULT_SCREENER_SETTINGS.minDipPercent &&
    settings.maxDipPercent === DEFAULT_SCREENER_SETTINGS.maxDipPercent &&
    settings.gapWindow === DEFAULT_SCREENER_SETTINGS.gapWindow &&
    settings.minIndexGainPercent === DEFAULT_SCREENER_SETTINGS.minIndexGainPercent &&
    settings.maxStockGainPercent === DEFAULT_SCREENER_SETTINGS.maxStockGainPercent &&
    settings.maxDeclinePercent === DEFAULT_SCREENER_SETTINGS.maxDeclinePercent &&
    settings.minVolumeShares === DEFAULT_SCREENER_SETTINGS.minVolumeShares &&
    settings.minValueIdr === DEFAULT_SCREENER_SETTINGS.minValueIdr &&
    !settings.sectors.length &&
    !settings.boards.length;

  const columns = MODE_COLUMNS[mode];

  return (
    <div className="space-y-4 sm:space-y-5">
      <Panel>
        <PanelHeader
          icon={Target}
          title="Stock Screener"
          tone={MODE_TONE[mode]}
          subtitle={
            <>
              {modeMeta.question} Aturan keras, dievaluasi pada sesi {result.session}
              {result.live && (
                <>
                  {' '}
                  <span className="text-emerald-400">· harga live</span>
                </>
              )}
              . Setiap emiten lolos atau tidak, dan alasannya terlihat kolom per kolom — bukan skor yang harus
              dipercaya begitu saja.
            </>
          }
          actions={
            <>
              <button
                type="button"
                onClick={() => setShowSettings((v) => !v)}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-[11px] font-bold text-slate-200 hover:bg-slate-700 touch-target"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
                Ambang
              </button>
              {!isDefault && (
                <button
                  type="button"
                  onClick={() => setSettings({ ...DEFAULT_SCREENER_SETTINGS, mode })}
                  className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-[11px] font-bold text-amber-300 hover:bg-slate-800 touch-target"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  Kembalikan
                </button>
              )}
            </>
          }
        />

        <Segmented
          className="mt-4"
          ariaLabel="Setup screener"
          options={SCREENER_MODES.map((m) => ({ id: m.id, label: m.label }))}
          value={mode}
          onChange={setMode}
          fill
        />

        {showSettings && (
          <div className="mt-4 grid gap-3 rounded-xl border border-slate-800 bg-slate-950 p-3.5 sm:grid-cols-2 lg:grid-cols-4">
            {mode === 'momentum' && (
              <>
                <NumberField
                  label="MA pendek (sesi)"
                  value={settings.maShort}
                  onChange={(v) => patch({ maShort: Math.max(2, Math.round(v)) })}
                />
                <NumberField
                  label="MA panjang (sesi)"
                  value={settings.maLong}
                  onChange={(v) => patch({ maLong: Math.max(2, Math.round(v)) })}
                />
              </>
            )}
            {mode === 'pullback' && (
              <>
                <NumberField
                  label="MA tren (sesi)"
                  value={settings.trendMa}
                  onChange={(v) => patch({ trendMa: Math.max(20, Math.round(v)) })}
                />
                <NumberField
                  label="MA koreksi (sesi)"
                  value={settings.dipMa}
                  onChange={(v) => patch({ dipMa: Math.max(3, Math.round(v)) })}
                />
                <NumberField
                  label="Diskon minimum (%)"
                  value={settings.minDipPercent * 100}
                  step={1}
                  onChange={(v) => patch({ minDipPercent: Math.max(0, v) / 100 })}
                />
                <NumberField
                  label="Diskon maksimum (%)"
                  value={settings.maxDipPercent * 100}
                  step={1}
                  onChange={(v) => patch({ maxDipPercent: Math.max(0, v) / 100 })}
                />
                <NumberField
                  label="Jendela puncak (sesi)"
                  value={settings.dipWindow}
                  onChange={(v) => patch({ dipWindow: Math.max(5, Math.round(v)) })}
                />
              </>
            )}
            {mode === 'laggard' && (
              <>
                <NumberField
                  label="Jendela banding (sesi)"
                  value={settings.gapWindow}
                  onChange={(v) => patch({ gapWindow: Math.max(5, Math.round(v)) })}
                />
                <NumberField
                  label="Kenaikan indeks minimum (%)"
                  value={settings.minIndexGainPercent * 100}
                  step={1}
                  onChange={(v) => patch({ minIndexGainPercent: v / 100 })}
                />
                <NumberField
                  label="Kenaikan saham maksimum (%)"
                  value={settings.maxStockGainPercent * 100}
                  step={1}
                  onChange={(v) => patch({ maxStockGainPercent: v / 100 })}
                />
                <NumberField
                  label="Penurunan maksimum (%)"
                  value={settings.maxDeclinePercent * 100}
                  step={1}
                  onChange={(v) => patch({ maxDeclinePercent: Math.max(0, v) / 100 })}
                />
              </>
            )}
            <NumberField
              label="Volume minimum (juta saham)"
              value={settings.minVolumeShares / 1e6}
              step={0.5}
              onChange={(v) => patch({ minVolumeShares: Math.max(0, v) * 1e6 })}
            />
            <NumberField
              label="Nilai minimum (miliar Rp)"
              value={settings.minValueIdr / 1e9}
              step={0.5}
              onChange={(v) => patch({ minValueIdr: Math.max(0, v) * 1e9 })}
            />
            <div className="sm:col-span-2 lg:col-span-4">
              <label htmlFor="scr-sector" className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Sektor
              </label>
              <select
                id="scr-sector"
                value={settings.sectors[0] ?? ''}
                onChange={(e) => patch({ sectors: e.target.value ? [e.target.value] : [] })}
                className="w-full cursor-pointer rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 touch-target"
              >
                <option value="">Semua sektor</option>
                {db.sectors.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Funnel ------------------------------------------------------- */}
        <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {result.funnel.map((stage, i) => (
            <div
              key={stage.id}
              className={cx(
                'rounded-xl border p-3',
                i === result.funnel.length - 1
                  ? 'border-emerald-800/60 bg-emerald-950/20'
                  : 'border-slate-800 bg-slate-950'
              )}
            >
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{stage.label}</div>
              <div
                className={cx(
                  'mt-1 text-xl font-extrabold tabular-nums',
                  i === result.funnel.length - 1 ? 'text-emerald-300' : 'text-white'
                )}
              >
                {stage.remaining}
              </div>
              {i > 0 && <div className="text-[10px] text-slate-500">−{stage.removed} tersaring</div>}
            </div>
          ))}
        </div>

        <SourceNote icon={Info}>
          {mode === 'momentum' && (
            <>
              <strong className="text-slate-400">Naik jangka panjang, dan belum terlanjur jauh.</strong> Dua syarat
              yang harus dipenuhi bersamaan, dan keduanya ada karena satu tanpa yang lain menghasilkan daftar yang
              menyesatkan. MA{settings.trendMa} memastikan trennya memang naik — tanpa itu, aturan MA
              {settings.maShort}/MA{settings.maLong} cuma membaca tiga sampai lima sesi terakhir dan meloloskan saham
              yang tiga bulan turun lalu memantul tiga hari. Batas{' '}
              {`${(settings.maxRunupPercent * 100).toFixed(0)}%`} dari dasar {settings.dipWindow} sesi memastikan
              geraknya belum habis.{' '}
              <strong className="text-slate-400">Dari mana angkanya.</strong> Dari dua puluh syarat yang diuji
              sendiri-sendiri terhadap keranjang saham likuid selama 432 sesi, hanya seberapa jauh sebuah saham sudah
              naik yang hasilnya berjenjang rapi: yang paling belum naik unggul 1,4 poin persen dalam tiga bulan, yang
              paling sudah naik tertinggal 8,6 poin persen, konsisten di sepuluh tingkat.{' '}
              {`${(settings.maxRunupPercent * 100).toFixed(0)}%`} adalah titik baliknya — di atas itu efeknya berubah
              negatif.{' '}
              <strong className="text-slate-400">Yang belum terbukti, dan Anda berhak tahu.</strong> Angka itu dipilih
              sesudah datanya dilihat, jadi belum teruji pada sesi yang benar-benar baru. Papan strategi malah lebih
              menyukai batas 15%, tetapi 15% bersama MA{settings.trendMa} hanya meloloskan satu emiten — di pasar yang
              turun, saham yang masih di atas rata-rata panjangnya hampir pasti sudah naik. Jadi ini pertukaran yang
              disengaja antara dua pengukuran, bukan angka yang sudah selesai. Kolom Sudah naik dan Regangan
              memperlihatkan angkanya langsung untuk tiap baris.{' '}
              <strong className="text-slate-400">Kenapa dua aturan volume, bukan satu.</strong> Aturan volume dan
              aturan nilai mengikat di ujung harga yang berbeda. Saham Rp 50 bisa mencetak 40 juta lembar dan tetap
              hanya bertransaksi Rp 2 miliar; saham Rp 30.000 yang bertransaksi Rp 9 miliar hanya berpindah 300 ribu
              lembar. Aturan volume membuang saham mahal yang tidak likuid, aturan nilai membuang perputaran saham
              gocap. Memakai salah satunya saja meloloskan satu kelas saham yang tidak bisa dieksekusi. Ambang bawaan:
              MA{settings.maShort}/MA{settings.maLong}, {rp(settings.minVolumeShares / 1e6)} juta lembar, Rp{' '}
              {rp(settings.minValueIdr / 1e9)} miliar.
            </>
          )}
          {mode === 'pullback' && (
            <>
              <strong className="text-slate-400">Diskon, bukan kerusakan.</strong> Setup ini mencari saham yang
              trennya masih naik — harga di atas MA{settings.trendMa} — tetapi sedang jatuh di bawah MA
              {settings.dipMa} dan berada {rp(settings.minDipPercent * 100)}–{rp(settings.maxDipPercent * 100)}% di
              bawah puncak {settings.dipWindow} sesinya. Batas atas diskonnya ada dengan alasan: turun lebih dari{' '}
              {rp(settings.maxDipPercent * 100)}% biasanya bukan koreksi melainkan sesuatu yang patah, dan layar ini
              tidak bisa membedakan mana yang mana. Aturan volume dan nilai tetap berlaku — diskon yang tidak bisa
              dieksekusi bukan peluang.
            </>
          )}
          {mode === 'laggard' && (
            <>
              <strong className="text-slate-400">Jarak ke indeks adalah pertanyaan, bukan jawaban.</strong> Emiten
              dibandingkan dengan indeks sektor IDX-IC-nya sendiri (COMPOSITE kalau sektornya tidak punya indeks), dan
              kolom &quot;Indeks acuan&quot; selalu menyebut yang mana — membandingkan bank dengan IHSG dan emiten
              batu bara dengan IDXENERGY adalah dua klaim yang berbeda. Yang lolos adalah emiten yang indeksnya naik ≥{' '}
              {rp(settings.minIndexGainPercent * 100)}% dalam {settings.gapWindow} sesi sementara sahamnya sendiri ≤{' '}
              {rp(settings.maxStockGainPercent * 100)}% dan tidak turun lebih dari {rp(settings.maxDeclinePercent * 100)}
              %. Jarak itu bisa berarti salah harga, bisa juga berarti pasar tahu sesuatu tentang emitennya — layar ini
              hanya menunjukkan jaraknya.
            </>
          )}
        </SourceNote>
      </Panel>

      {/* Results ------------------------------------------------------- */}
      <Panel>
        <PanelHeader
          icon={Filter}
          title={
            showAll || query.trim()
              ? `${rows.length} dari ${ranked.length} emiten lolos`
              : `${rows.length} conviction tertinggi dari ${ranked.length} lolos`
          }
          tone={MODE_TONE[mode]}
          subtitle={
            mode === 'momentum'
              ? 'Diurutkan menurut kolom pilihan Anda — bawaannya conviction, komposit dari lonjakan volume, arus asing, seberapa BARU harga menembus MA panjangnya, dan berapa banyak ruang tersisa sebelum meregang dari MA20. Dua yang terakhir menggantikan bobot yang dulu justru membayar makin mahal makin telat kita masuk. Klik kode untuk membuka detail emiten, ikon chart untuk membuka TradingView.'
              : mode === 'pullback'
                ? 'Bawaannya conviction untuk setup ini: kedalaman diskon, bantalan di atas MA tren, RSI yang sudah jenuh jual, dan kerapian tren panjangnya. Skor momentum tidak dipakai di sini — kandidat antre beli selalu berada di bawah MA pendeknya, jadi skor itu akan menaruh diskon paling dangkal di urutan teratas.'
                : 'Bawaannya conviction untuk setup ini: besar jarak ke indeks, seberapa kuat indeksnya bergerak, dan apakah sahamnya diam atau justru jatuh. Saham yang diam di belakang indeks yang lari adalah jarak; yang ambruk hanyalah tren turun yang kebetulan ditemani indeks.'
          }
          actions={
            <>
              {!query.trim() && ranked.length > DEFAULT_SHOWN && (
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-[11px] font-bold text-slate-200 hover:bg-slate-700 touch-target"
                >
                  {showAll ? (
                    <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  {showAll ? `Tampilkan ${DEFAULT_SHOWN} teratas` : `Tampilkan semua (${ranked.length})`}
                </button>
              )}
              <div className="relative w-full sm:w-52">
                <Search className="pointer-events-none absolute left-3 top-1/2 w-3.5 h-3.5 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                <label htmlFor="scr-search" className="sr-only">
                  Cari di hasil
                </label>
                <input
                  id="scr-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Cari kode atau nama…"
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 py-2 pl-9 pr-3 text-xs text-slate-200 placeholder:text-slate-600 focus:border-emerald-700 touch-target"
                />
              </div>
              <label htmlFor="scr-sort" className="sr-only">
                Urutkan
              </label>
              <select
                id="scr-sort"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="cursor-pointer rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 touch-target"
              >
                {SORTS[mode].map((s) => (
                  <option key={s.key} value={s.key}>
                    Urut: {s.label}
                  </option>
                ))}
              </select>
            </>
          }
        />

        {rows.length === 0 ? (
          <div className="mt-4">
            <EmptyState icon={Filter} title="Tidak ada emiten yang lolos">
              {mode === 'momentum'
                ? 'Pada sesi ini tidak ada emiten yang memenuhi semua aturan sekaligus. Longgarkan ambang lewat tombol Ambang, atau tunggu sesi berikutnya — pada pasar yang lemah hasil kosong adalah jawaban yang benar.'
                : mode === 'pullback'
                  ? 'Tidak ada saham bertren naik yang sedang diskon sedalam itu hari ini. Setelah pasar berlari kencang, daftar kosong di sini justru wajar — tidak ada yang sedang obral.'
                  : 'Tidak ada emiten yang tertinggal sejauh itu dari indeks acuannya. Kalau indeksnya sendiri belum naik sebesar ambang, seluruh semesta gugur di aturan pertama — periksa angka tahap pertama di corong.'}
            </EmptyState>
          </div>
        ) : (
          <TableScroll className="mt-3">
            <table className="w-full min-w-[900px] text-xs">
              <thead className="border-b border-slate-800">
                <tr>
                  <Th align="left" sticky>
                    Emiten
                  </Th>
                  <Th title="Peringkat di antara yang sudah lolos aturan keras setup ini — bukan aturan tambahan.">
                    Conviction
                  </Th>
                  <Th>Harga</Th>
                  <Th>Ubah</Th>
                  {columns.map((c) => (
                    <Th key={c.header} title={c.title}>
                      {c.header}
                    </Th>
                  ))}
                  <Th>Volume</Th>
                  <Th title="Volume hari ini dibagi rata-rata 20 sesi">Lonjakan</Th>
                  <Th title="Nilai transaksi sesi ini dalam miliar rupiah, angka resmi IDX (bukan harga x volume).">Nilai (Rp miliar)</Th>
                  <Th title="Beli asing dikurangi jual asing pada sesi ini, dalam miliar rupiah. Positif berarti asing net beli. IDX hanya menerbitkannya di akhir sesi.">Asing (Rp miliar)</Th>
                  <Th align="center">Chart</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {rows.map((r) => (
                  <tr key={r.code} className="hover:bg-slate-800/30">
                    <Td align="left" sticky>
                      <button
                        type="button"
                        onClick={() => onSelectEmiten(r.code)}
                        className="cursor-pointer font-bold text-emerald-300 hover:text-emerald-200"
                      >
                        {r.code}
                      </button>
                      <div className="max-w-[170px] truncate text-[10px] text-slate-500">{r.name}</div>
                    </Td>
                    <Td>
                      <span
                        className={cx(
                          'inline-block rounded px-1.5 py-0.5 font-bold tabular-nums',
                          r.conviction >= 0.6
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : r.conviction >= 0.35
                              ? 'text-slate-200'
                              : 'text-slate-500'
                        )}
                      >
                        {r.conviction.toFixed(2)}
                      </span>
                    </Td>
                    <Td className="font-semibold text-slate-100">{rp(r.close)}</Td>
                    <Td className={r.changePercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                      {pct(r.changePercent)}
                    </Td>
                    {columns.map((c) => (
                      <Td key={c.header} className={c.className}>
                        {c.render(r, settings)}
                      </Td>
                    ))}
                    <Td className="text-slate-200">{shares(r.volumeShares)}</Td>
                    <Td className={cx(r.volumeSurge >= 1.3 ? 'font-bold text-amber-300' : 'text-slate-400')}>
                      {Number.isFinite(r.volumeSurge) ? `${r.volumeSurge.toFixed(2)}x` : '–'}
                    </Td>
                    <Td className="font-semibold text-slate-100">{bn(r.valueIdr)}</Td>
                    <Td className={r.foreignNetIdrBn >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                      {rp(r.foreignNetIdrBn, 1)}
                    </Td>
                    <Td align="center">
                      <button
                        type="button"
                        onClick={() => {
                          setInspect(r.code);
                          setChartCode(r.code);
                        }}
                        title={`Buka chart ${r.code}`}
                        className="cursor-pointer rounded-md border border-slate-700 px-2 py-1 text-[10px] font-bold text-slate-300 hover:border-cyan-700 hover:text-cyan-300"
                      >
                        chart
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Panel>

      {/* Why did X fail --------------------------------------------------- */}
      <Panel>
        <PanelHeader
          icon={Info}
          title="Kenapa emiten saya tidak lolos?"
          subtitle="Ketik kode apa pun untuk melihat aturan mana yang gagal pada sesi ini, untuk setup yang sedang aktif. Screener yang tidak bisa menjelaskan penolakannya hanya memindahkan tebakan, bukan menghilangkannya."
          actions={
            <div className="relative w-full sm:w-44">
              <label htmlFor="scr-inspect" className="sr-only">
                Kode emiten
              </label>
              <input
                id="scr-inspect"
                value={inspect}
                onChange={(e) => setInspect(e.target.value)}
                placeholder="mis. BBCA"
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs uppercase text-slate-200 placeholder:text-slate-600 placeholder:normal-case focus:border-emerald-700 touch-target"
              />
            </div>
          }
        />

        {inspect.trim() !== '' && !inspected && (
          <p className="mt-3 text-xs text-slate-500">
            {inspect.toUpperCase()} tidak ada di semesta, atau tidak bertransaksi pada sesi ini.
          </p>
        )}

        {inspected && (
          <div className="mt-4 space-y-3">
            <StatGrid cols={4}>
              <Stat label="Harga" value={rp(inspected.close)} hint={pct(inspected.changePercent)} />
              {mode === 'momentum' && (
                <Stat
                  label={`MA${settings.maShort} / MA${settings.maLong}`}
                  value={`${rp(inspected.maShort, 1)} / ${rp(inspected.maLong, 1)}`}
                  hint={inspected.maStacked ? 'MA pendek di atas MA panjang' : 'MA pendek masih di bawah'}
                />
              )}
              {mode === 'pullback' && (
                <Stat
                  label={`MA${settings.trendMa} / puncak ${settings.dipWindow} sesi`}
                  value={`${rp(inspected.maTrend, 1)} / ${rp(inspected.highInWindow, 1)}`}
                  hint={`diskon ${pct(inspected.dipFromHigh)} dari puncak`}
                />
              )}
              {mode === 'laggard' && (
                <Stat
                  label={`${inspected.indexCode} / saham`}
                  value={`${pct(inspected.indexReturn)} / ${pct(inspected.stockReturn)}`}
                  hint={`jarak ${pp(inspected.gapToIndexPp)} dalam ${settings.gapWindow} sesi`}
                />
              )}
              <Stat label="Volume" value={shares(inspected.volumeShares)} hint="lembar saham" />
              <Stat label="Nilai" value={`Rp ${bn(inspected.valueIdr)} miliar`} hint={`${rp(inspected.freq)} transaksi`} />
            </StatGrid>

            <div className="grid gap-2 sm:grid-cols-3">
              {mode === 'momentum' && (
                <RuleRow
                  ok={inspected.passMa}
                  label={`Di atas MA${settings.maShort} dan MA${settings.maLong}`}
                  detail={
                    inspected.passMa
                      ? `${pct(inspected.premiumToMaLong)} di atas MA${settings.maLong}, bertahan ${inspected.sessionsAboveMaLong} sesi`
                      : `${inspected.aboveMaShort ? 'lolos' : 'gagal'} MA${settings.maShort}, ${inspected.aboveMaLong ? 'lolos' : 'gagal'} MA${settings.maLong}`
                  }
                />
              )}
              {mode === 'pullback' && (
                <>
                  <RuleRow
                    ok={inspected.passTrend}
                    label={`Masih di atas MA${settings.trendMa}`}
                    detail={
                      Number.isFinite(inspected.maTrend)
                        ? `${pct(inspected.premiumToMaTrend)} terhadap MA${settings.trendMa} di ${rp(inspected.maTrend, 1)}`
                        : `riwayatnya belum cukup ${settings.trendMa} sesi`
                    }
                  />
                  <RuleRow
                    ok={inspected.passDip}
                    label={`Turun di bawah MA${settings.dipMa}`}
                    detail={`harga ${rp(inspected.close)} vs MA${settings.dipMa} ${rp(inspected.maDip, 1)}`}
                  />
                  <RuleRow
                    ok={inspected.passDepth}
                    label={`Diskon ${rp(settings.minDipPercent * 100)}–${rp(settings.maxDipPercent * 100)}% dari puncak`}
                    detail={`${pct(inspected.dipFromHigh)} dari puncak ${settings.dipWindow} sesi di ${rp(inspected.highInWindow, 1)}`}
                  />
                </>
              )}
              {mode === 'laggard' && (
                <>
                  <RuleRow
                    ok={inspected.passIndexUp}
                    label={`${inspected.indexCode} naik ≥ ${rp(settings.minIndexGainPercent * 100)}%`}
                    detail={`indeks acuannya ${pct(inspected.indexReturn)} dalam ${settings.gapWindow} sesi`}
                  />
                  <RuleRow
                    ok={inspected.passLag}
                    label={`Sahamnya sendiri ≤ ${rp(settings.maxStockGainPercent * 100)}%`}
                    detail={`${pct(inspected.stockReturn)} — jarak ${pp(inspected.gapToIndexPp)}`}
                  />
                  <RuleRow
                    ok={inspected.passIntact}
                    label={`Tidak turun lebih dari ${rp(settings.maxDeclinePercent * 100)}%`}
                    detail={
                      inspected.passIntact
                        ? 'tertinggal, bukan ambruk'
                        : `${pct(inspected.stockReturn)} — ini tren turun, bukan jarak`
                    }
                  />
                </>
              )}
              <RuleRow
                ok={inspected.passVolume}
                label={`Volume > ${rp(settings.minVolumeShares / 1e6)} juta lembar`}
                detail={`${shares(inspected.volumeShares)} lembar`}
              />
              <RuleRow
                ok={inspected.passValue}
                label={`Nilai > Rp ${rp(settings.minValueIdr / 1e9)} miliar`}
                detail={`Rp ${bn(inspected.valueIdr)} miliar`}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={inspected.passAll ? 'up' : 'muted'}>
                {inspected.passAll ? `Lolos setup ${modeMeta.label}` : `Belum lolos setup ${modeMeta.label}`}
              </Pill>
              {/* Stated even when every rule passed — "it qualifies" and "you are
                  early" are different questions, and the rules only answer the
                  first one. */}
              {Number.isFinite(inspected.runupFromLow) && (
                <Pill tone={inspected.runupFromLow >= 0.6 ? 'warn' : inspected.runupFromLow >= 0.3 ? 'neutral' : 'up'}>
                  sudah naik {pct(inspected.runupFromLow, 0)} dari dasar {settings.dipWindow} sesi
                </Pill>
              )}
              {Number.isFinite(inspected.extensionAtr) && (
                <Pill tone={inspected.extensionAtr >= 3 ? 'warn' : 'muted'}>
                  regangan {inspected.extensionAtr.toFixed(1)} ATR dari MA{settings.dipMa}
                </Pill>
              )}
              <button
                type="button"
                onClick={() => setChartCode(chartCode === inspected.code ? null : inspected.code)}
                className="cursor-pointer rounded-md border border-slate-700 px-2.5 py-1 text-[10px] font-bold text-slate-300 hover:border-cyan-700 hover:text-cyan-300 touch-target"
              >
                {chartCode === inspected.code ? 'Tutup chart' : `Buka chart ${inspected.code}`}
              </button>
              <button
                type="button"
                onClick={() => onSelectEmiten(inspected.code)}
                className="cursor-pointer rounded-md border border-slate-700 px-2.5 py-1 text-[10px] font-bold text-slate-300 hover:border-emerald-700 hover:text-emerald-300 touch-target"
              >
                Detail {inspected.code}
              </button>
            </div>

            <TradeSetupBlock setup={inspectedSetup} />

            {chartCode === inspected.code && (
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-2 sm:p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-slate-300">
                    {inspected.code} · {inspected.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => setChartCode(null)}
                    className="cursor-pointer text-[10px] font-bold text-slate-500 hover:text-slate-300"
                  >
                    tutup
                  </button>
                </div>
                <TradingViewChart symbol={`IDX:${inspected.code}`} />
              </div>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
};

const RuleRow: React.FC<{ ok: boolean; label: string; detail: string }> = ({ ok, label, detail }) => (
  <div
    className={cx(
      'flex items-start gap-2 rounded-xl border p-3',
      ok ? 'border-emerald-800/60 bg-emerald-950/20' : 'border-rose-900/50 bg-rose-950/10'
    )}
  >
    <span
      className={cx(
        'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full',
        ok ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
      )}
    >
      {ok ? <Check className="h-2.5 w-2.5" aria-hidden="true" /> : <X className="h-2.5 w-2.5" aria-hidden="true" />}
    </span>
    <div className="min-w-0">
      <div className="text-[11px] font-bold text-slate-200">{label}</div>
      <div className="text-[10px] text-slate-500">{detail}</div>
    </div>
  </div>
);

/**
 * Entry/stop/target reference level — see models/tradeSetup.ts for why ATR
 * and not a flat percentage. Deliberately labelled as a mechanical level, not
 * a recommendation.
 */
const TradeSetupBlock: React.FC<{ setup: TradeSetup | null }> = ({ setup }) => {
  if (!setup) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5 text-[11px] text-slate-500">
        Trade setup belum bisa dihitung — ATR14 emiten ini belum tersedia.
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5">
      <div className="flex items-center gap-2">
        <Crosshair className="w-3.5 h-3.5 text-cyan-400" aria-hidden="true" />
        <h5 className="text-xs font-bold text-white">Trade setup — berbasis ATR14</h5>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3 text-center">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Entry</div>
          <div className="text-sm font-bold text-slate-100 tabular-nums">{rp(setup.entry)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-rose-400">Stop</div>
          <div className="text-sm font-bold text-rose-300 tabular-nums">{rp(setup.stop)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-emerald-400">Target</div>
          <div className="text-sm font-bold text-emerald-300 tabular-nums">{rp(setup.target)}</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Pill tone="muted">Risiko {(setup.riskPercent * 100).toFixed(1)}%</Pill>
        <Pill tone="muted">R:R 1 : {setup.rewardRiskRatio.toFixed(1)}</Pill>
        <Pill tone="muted">ATR14 {rp(setup.atr14, 1)}</Pill>
      </div>
      <p className="mt-2.5 text-[10px] leading-relaxed text-slate-500">
        Stop = entry − 1,5×ATR14, target = entry + 2,5×ATR14 — level mekanis yang sama untuk semua emiten, dihitung
        dari volatilitas hariannya sendiri. Ini bukan rekomendasi beli atau jual.
      </p>
    </div>
  );
};

const NumberField: React.FC<{
  label: string;
  value: number;
  step?: number;
  onChange: (v: number) => void;
}> = ({ label, value, step = 1, onChange }) => {
  const id = `scr-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </label>
      <input
        id={id}
        type="number"
        step={step}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-emerald-300 focus:border-emerald-500 focus:outline-none touch-target"
      />
    </div>
  );
};
