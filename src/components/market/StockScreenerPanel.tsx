import React, { useMemo, useState } from 'react';
import { Check, Filter, Info, RotateCcw, Search, SlidersHorizontal, Target, X } from 'lucide-react';
import { MarketDatabase } from '../../data/marketRepository';
import {
  DEFAULT_SCREENER_SETTINGS,
  ScreenerRow,
  ScreenerSettings,
  runStockScreener,
} from '../../models/stockScreener';
import {
  EmptyState,
  Panel,
  PanelHeader,
  Pill,
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
  onSelectEmiten: (code: string) => void;
  onOpenChart: (code: string) => void;
}

const rp = (v: number, d = 0) => (Number.isFinite(v) ? v.toLocaleString('id-ID', { maximumFractionDigits: d }) : '–');
const pct = (v: number, d = 1) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%` : '–');
const shares = (v: number) => {
  if (!Number.isFinite(v)) return '–';
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)} mr`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)} jt`;
  return `${(v / 1e3).toFixed(0)} rb`;
};
const bn = (v: number, d = 1) => (Number.isFinite(v) ? `${(v / 1e9).toFixed(d)}` : '–');

type SortKey = 'valueIdr' | 'changePercent' | 'volumeShares' | 'premiumToMaLong' | 'volumeSurge' | 'sessionsAboveMaLong' | 'foreignNetIdrBn';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'valueIdr', label: 'Nilai transaksi' },
  { key: 'changePercent', label: 'Perubahan' },
  { key: 'volumeShares', label: 'Volume' },
  { key: 'volumeSurge', label: 'Lonjakan volume' },
  { key: 'premiumToMaLong', label: 'Jarak ke MA' },
  { key: 'sessionsAboveMaLong', label: 'Hari di atas MA' },
  { key: 'foreignNetIdrBn', label: 'Asing hari ini' },
];

export const StockScreenerPanel: React.FC<Props> = ({ db, onSelectEmiten, onOpenChart }) => {
  const [settings, setSettings] = useState<ScreenerSettings>(DEFAULT_SCREENER_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [sort, setSort] = useState<SortKey>('valueIdr');
  const [query, setQuery] = useState('');
  const [inspect, setInspect] = useState<string>('');

  const result = useMemo(() => runStockScreener(db, settings), [db, settings]);

  const rows = useMemo(() => {
    const q = query.trim().toUpperCase();
    const filtered = q
      ? result.rows.filter((r) => r.code.includes(q) || r.name.toUpperCase().includes(q))
      : result.rows;
    return [...filtered].sort((a, b) => {
      const av = a[sort];
      const bv = b[sort];
      if (!Number.isFinite(av as number)) return 1;
      if (!Number.isFinite(bv as number)) return -1;
      return (bv as number) - (av as number);
    });
  }, [result.rows, sort, query]);

  const inspected: ScreenerRow | null = inspect ? result.all.get(inspect.toUpperCase()) ?? null : null;

  const patch = (p: Partial<ScreenerSettings>) => setSettings((s) => ({ ...s, ...p }));
  const isDefault =
    settings.maShort === DEFAULT_SCREENER_SETTINGS.maShort &&
    settings.maLong === DEFAULT_SCREENER_SETTINGS.maLong &&
    settings.minVolumeShares === DEFAULT_SCREENER_SETTINGS.minVolumeShares &&
    settings.minValueIdr === DEFAULT_SCREENER_SETTINGS.minValueIdr &&
    !settings.sectors.length &&
    !settings.boards.length;

  return (
    <div className="space-y-4 sm:space-y-5">
      <Panel>
        <PanelHeader
          icon={Target}
          title="Stock Screener"
          tone="text-emerald-400"
          subtitle={
            <>
              Tiga aturan keras, dievaluasi pada sesi {result.session}
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
                  onClick={() => setSettings(DEFAULT_SCREENER_SETTINGS)}
                  className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-[11px] font-bold text-amber-300 hover:bg-slate-800 touch-target"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  Kembalikan
                </button>
              )}
            </>
          }
        />

        {showSettings && (
          <div className="mt-4 grid gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 sm:grid-cols-2 lg:grid-cols-4">
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
        <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {result.funnel.map((stage, i) => (
            <div
              key={stage.id}
              className={cx(
                'rounded-xl border p-3',
                i === result.funnel.length - 1
                  ? 'border-emerald-800/60 bg-emerald-950/20'
                  : 'border-slate-800 bg-slate-950/50'
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
          <strong className="text-slate-400">Kenapa dua aturan volume, bukan satu.</strong> Aturan volume dan aturan
          nilai mengikat di ujung harga yang berbeda. Saham Rp 50 bisa mencetak 40 juta lembar dan tetap hanya
          bertransaksi Rp 2 miliar; saham Rp 30.000 yang bertransaksi Rp 9 miliar hanya berpindah 300 ribu lembar.
          Aturan volume membuang saham mahal yang tidak likuid, aturan nilai membuang perputaran saham gocap. Memakai
          salah satunya saja meloloskan satu kelas saham yang tidak bisa dieksekusi. Ambang bawaan: MA
          {settings.maShort}/MA{settings.maLong}, {rp(settings.minVolumeShares / 1e6)} juta lembar, Rp{' '}
          {rp(settings.minValueIdr / 1e9)} miliar.
        </SourceNote>
      </Panel>

      {/* Results ------------------------------------------------------- */}
      <Panel>
        <PanelHeader
          icon={Filter}
          title={`${rows.length} emiten lolos`}
          tone="text-emerald-400"
          subtitle="Diurutkan menurut kolom pilihan Anda. Klik kode untuk membuka detail emiten, ikon chart untuk membuka TradingView."
          actions={
            <>
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
                {SORTS.map((s) => (
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
              Pada sesi ini tidak ada emiten yang memenuhi ketiga aturan sekaligus. Longgarkan ambang lewat tombol
              Ambang, atau tunggu sesi berikutnya — pada pasar yang lemah hasil kosong adalah jawaban yang benar.
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
                  <Th>Harga</Th>
                  <Th>Ubah</Th>
                  <Th>MA{settings.maShort}</Th>
                  <Th>MA{settings.maLong}</Th>
                  <Th title="Jarak harga terhadap MA panjang">Jarak MA</Th>
                  <Th title="Berapa sesi berturut-turut close bertahan di atas MA panjang">Hari</Th>
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
                    <Td className="font-semibold text-slate-100">{rp(r.close)}</Td>
                    <Td className={r.changePercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                      {pct(r.changePercent)}
                    </Td>
                    <Td className="text-slate-400">{rp(r.maShort, 1)}</Td>
                    <Td className="text-slate-400">{rp(r.maLong, 1)}</Td>
                    <Td className="text-slate-200">{pct(r.premiumToMaLong)}</Td>
                    <Td className="text-slate-300">{r.sessionsAboveMaLong}</Td>
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
                        onClick={() => onOpenChart(r.code)}
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
          subtitle="Ketik kode apa pun untuk melihat aturan mana yang gagal pada sesi ini. Screener yang tidak bisa menjelaskan penolakannya hanya memindahkan tebakan, bukan menghilangkannya."
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
              <Stat
                label={`MA${settings.maShort} / MA${settings.maLong}`}
                value={`${rp(inspected.maShort, 1)} / ${rp(inspected.maLong, 1)}`}
                hint={inspected.maStacked ? 'MA pendek di atas MA panjang' : 'MA pendek masih di bawah'}
              />
              <Stat label="Volume" value={shares(inspected.volumeShares)} hint="lembar saham" />
              <Stat label="Nilai" value={`Rp ${bn(inspected.valueIdr)} miliar`} hint={`${rp(inspected.freq)} transaksi`} />
            </StatGrid>

            <div className="grid gap-2 sm:grid-cols-3">
              <RuleRow
                ok={inspected.passMa}
                label={`Di atas MA${settings.maShort} dan MA${settings.maLong}`}
                detail={
                  inspected.passMa
                    ? `${pct(inspected.premiumToMaLong)} di atas MA${settings.maLong}, bertahan ${inspected.sessionsAboveMaLong} sesi`
                    : `${inspected.aboveMaShort ? 'lolos' : 'gagal'} MA${settings.maShort}, ${inspected.aboveMaLong ? 'lolos' : 'gagal'} MA${settings.maLong}`
                }
              />
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
                {inspected.passAll ? 'Lolos ketiga aturan' : 'Belum lolos'}
              </Pill>
              <button
                type="button"
                onClick={() => onOpenChart(inspected.code)}
                className="cursor-pointer rounded-md border border-slate-700 px-2.5 py-1 text-[10px] font-bold text-slate-300 hover:border-cyan-700 hover:text-cyan-300 touch-target"
              >
                Buka chart {inspected.code}
              </button>
              <button
                type="button"
                onClick={() => onSelectEmiten(inspected.code)}
                className="cursor-pointer rounded-md border border-slate-700 px-2.5 py-1 text-[10px] font-bold text-slate-300 hover:border-emerald-700 hover:text-emerald-300 touch-target"
              >
                Detail {inspected.code}
              </button>
            </div>
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
