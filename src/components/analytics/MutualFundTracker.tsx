import React, { useEffect, useMemo, useRef, useState } from 'react';
import { loadIdxFile } from '../../data/idxFiles';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  Building2,
  Info,
  Landmark,
  Minus,
  PieChart,
  Search,
  ShieldQuestion,
  Wallet,
} from 'lucide-react';
import { MarketDatabase } from '../../data/marketRepository';
import {
  HolderLine,
  OwnershipFile,
  OwnershipMover,
  OwnershipProfile,
  computeOwnershipProfile,
  rankOwnershipMovers,
  summariseOwnershipMarket,
} from '../../models/ownershipFlow';
import { EmptyState, Panel, PanelHeader, Pill, Segmented, SourceNote, Spinner, Stat, StatGrid, TableScroll, Td, Th, cx } from '../common/ui';
import { CHART } from '../../theme/chart';

interface Props {
  db: MarketDatabase | null;
  onSelectEmiten: (code: string) => void;
  /** Set when arriving from another workspace with an emiten already in mind. */
  focusEmiten?: string | null;
}

const pctOf = (v: number, d = 1) => (Number.isFinite(v) ? `${(v * 100).toFixed(d)}%` : '–');
const pp = (v: number, d = 2) => (Number.isFinite(v) ? `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(d)} pp` : '–');
const bn = (v: number, d = 1) => (Number.isFinite(v) ? `Rp ${v.toLocaleString('id-ID', { maximumFractionDigits: d })} miliar` : '–');
const shares = (v: number) => {
  if (!Number.isFinite(v)) return '–';
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)} miliar`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)} juta`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(0)} ribu`;
  return v.toFixed(0);
};
const monthLabel = (iso: string) => {
  const [y, m] = iso.split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return `${names[Number(m) - 1] ?? m} ${y.slice(2)}`;
};

const SIDE_TONE: Record<string, string> = {
  institusi: 'text-cyan-300',
  ritel: 'text-amber-300',
  strategis: 'text-slate-400',
};

const WINDOWS = [
  { id: '1', label: '1 bulan', shortLabel: '1B' },
  { id: '3', label: '3 bulan', shortLabel: '3B' },
  { id: '12', label: '12 bulan', shortLabel: '12B' },
] as const;

type WindowId = (typeof WINDOWS)[number]['id'];

const BASES = [
  { id: 'nilai' as const, label: 'Peringkat: nilai', shortLabel: 'Nilai' },
  { id: 'persen' as const, label: 'Peringkat: % register', shortLabel: '% register' },
];

type BasisId = (typeof BASES)[number]['id'];

// ---------------------------------------------------------------------------

export const MutualFundTracker: React.FC<Props> = ({ db, onSelectEmiten, focusEmiten }) => {
  const [file, setFile] = useState<OwnershipFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string>('BBCA');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [win, setWin] = useState<WindowId>('3');
  const [basis, setBasis] = useState<BasisId>('nilai');
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    void loadIdxFile<OwnershipFile>('ownership.json').then((j) => {
      if (!alive) return;
      // Pemuat bersama menciutkan tiap kegagalan menjadi null, jadi pesan yang
      // membedakan "belum dibangun" dari "gagal diambil" dipilih di sini. Tidak
      // ada yang hilang: berkas yang belum ada dan berkas yang gagal dibaca
      // sama-sama berarti panel ini tidak punya data, dan perintah untuk
      // membangunnya adalah jawaban yang benar untuk keduanya.
      if (j) setFile(j);
      else setError('Data kepemilikan KSEI belum dibangun. Jalankan "npm run data:ownership".');
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (focusEmiten) setCode(focusEmiten);
  }, [focusEmiten]);

  // Close the picker on an outside click — a dropdown that only closes on
  // selection traps the reader on a phone.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const profile: OwnershipProfile | null = useMemo(
    () => (file ? computeOwnershipProfile(file, code) : null),
    [file, code]
  );

  const market = useMemo(() => (file ? summariseOwnershipMarket(file) : null), [file]);

  const movers = useMemo(
    () =>
      file
        ? rankOwnershipMovers(file, {
            window: Number(win),
            // Below ~Rp 300 miliar of register value one family office moving
            // house swings the percentage by whole points; that is noise, not
            // an institutional bid.
            minCustodyValueIdrBn: 300,
            limit: 12,
            basis,
          })
        : null,
    [file, win, basis]
  );

  const matches = useMemo(() => {
    if (!file) return [];
    const q = query.trim().toUpperCase();
    const codes = Object.keys(file.emiten);
    const named = (c: string) => db?.byCode.get(c)?.name ?? '';
    const pool = q
      ? codes.filter((c) => c.includes(q) || named(c).toUpperCase().includes(q))
      : codes;
    return pool.slice(0, 40);
  }, [file, query, db]);

  if (error) return <EmptyState icon={ShieldQuestion} title="Data kepemilikan belum tersedia" tone="warn">{error}</EmptyState>;
  if (!file) return <Spinner label="Memuat register kepemilikan KSEI…" />;

  const name = db?.byCode.get(code)?.name ?? code;

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* ---------------------------------------------------------------- */}
      {/* Market-level context                                              */}
      {/* ---------------------------------------------------------------- */}
      {market && (
        <Panel>
          <PanelHeader
            icon={PieChart}
            title="Siapa yang memegang pasar"
            subtitle={`Register KSEI ${monthLabel(market.month)} · ${market.emitenCovered} emiten · nilai kustodian Rp ${market.totalCustodyValueIdrTn.toLocaleString('id-ID', { maximumFractionDigits: 0 })} triliun · rata-rata tertimbang nilai register`}
          />
          <StatGrid className="mt-4">
            <Stat
              label="Institusi"
              value={pctOf(market.institusi)}
              tone="accent"
              icon={Landmark}
              hint={`${pp(market.institusiDelta3m)} dalam 3 bulan`}
            />
            <Stat
              label="Reksa dana"
              value={pctOf(market.reksadana)}
              icon={Wallet}
              hint={`${pp(market.reksadanaDelta3m)} dalam 3 bulan`}
            />
            <Stat
              label="Individu (ritel)"
              value={pctOf(market.ritel)}
              tone="warn"
              icon={Building2}
              hint="Sisanya korporasi, sekuritas & lain-lain"
            />
            <Stat
              label="Pemegang asing"
              value={pctOf(market.asing)}
              icon={Banknote}
              hint={`${pp(market.asingDelta3m)} dalam 3 bulan`}
            />
          </StatGrid>
        </Panel>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Per-emiten register                                               */}
      {/* ---------------------------------------------------------------- */}
      <Panel>
        <PanelHeader
          icon={Landmark}
          title={`Register kepemilikan — ${code}`}
          subtitle={name}
          actions={
            <div ref={boxRef} className="relative w-full sm:w-72">
              <label htmlFor="own-search" className="sr-only">
                Cari emiten
              </label>
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
              <input
                id="own-search"
                value={query}
                onFocus={() => setOpen(true)}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setOpen(true);
                }}
                placeholder="Cari kode atau nama emiten…"
                className="w-full rounded-lg border border-slate-800 bg-slate-950 py-2 pl-9 pr-3 text-xs text-slate-200 placeholder:text-slate-600 focus:border-cyan-700 touch-target"
              />
              {open && (
                <ul className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto scrollbar-thin rounded-lg border border-slate-700 bg-slate-900 shadow-2xl">
                  {matches.length === 0 && (
                    <li className="px-3 py-2 text-[11px] text-slate-500">Tidak ada emiten yang cocok.</li>
                  )}
                  {matches.map((c) => (
                    <li key={c}>
                      <button
                        type="button"
                        onClick={() => {
                          setCode(c);
                          setQuery('');
                          setOpen(false);
                        }}
                        className="flex w-full items-baseline gap-2 px-3 py-2 text-left hover:bg-slate-800 touch-target"
                      >
                        <span className="text-xs font-bold text-cyan-300 w-12 shrink-0">{c}</span>
                        <span className="truncate text-[11px] text-slate-400">{db?.byCode.get(c)?.name ?? ''}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          }
        />

        {!profile ? (
          <div className="mt-4">
            <EmptyState icon={Info} title={`${code} tidak ada di register KSEI`}>
              Emiten ini belum punya saldo kustodian yang diterbitkan pada rentang bulan yang termuat.
            </EmptyState>
          </div>
        ) : (
          <OwnershipDetail profile={profile} onSelectEmiten={onSelectEmiten} />
        )}
      </Panel>

      {/* ---------------------------------------------------------------- */}
      {/* Cross-sectional movers                                            */}
      {/* ---------------------------------------------------------------- */}
      <Panel>
        <PanelHeader
          icon={ArrowUpRight}
          title="Ke mana uang institusi bergerak"
          subtitle={
            <>
              Hanya emiten dengan nilai register di atas Rp 300 miliar — di bawah itu satu pemegang bisa menggeser
              persentase beberapa poin sendirian. Peringkat <strong className="text-slate-400">nilai</strong> mengurutkan
              berdasarkan rupiah saham yang benar-benar berpindah ke tangan institusi; peringkat{' '}
              <strong className="text-slate-400">% register</strong> mengurutkan berdasarkan porsi kepemilikan. Baris
              bertanda <span className="font-bold text-amber-300">register berubah</span> mengalami rights issue atau
              pendaftaran blok baru ke kustodian — penyebutnya bergeser, jadi persentasenya bisa naik justru ketika
              institusi berkurang. Di baris itu, kolom nilai yang benar.
            </>
          }
          actions={
            <>
              <Segmented
                options={BASES}
                value={basis}
                onChange={setBasis}
                ariaLabel="Dasar peringkat"
                size="sm"
              />
              <Segmented
                options={WINDOWS.map((w) => ({ id: w.id, label: w.label, shortLabel: w.shortLabel }))}
                value={win}
                onChange={setWin}
                ariaLabel="Jendela perubahan"
                size="sm"
              />
            </>
          }
        />
        {movers && (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <MoverTable
              title="Diakumulasi institusi"
              tone="up"
              rows={movers.accumulating}
              db={db}
              basis={basis}
              onInspect={setCode}
            />
            <MoverTable
              title="Dilepas institusi"
              tone="down"
              rows={movers.distributing}
              db={db}
              basis={basis}
              onInspect={setCode}
            />
          </div>
        )}
      </Panel>

      <SourceNote icon={Info}>
        <strong className="text-slate-400">Sumber &amp; batas.</strong> {file.source}. {file.scope} KSEI menerbitkan{' '}
        <em>kategori</em> pemegang, bukan nama pengelola dana — angka di sini menunjukkan bahwa reksa dana secara
        keseluruhan menambah atau mengurangi, bukan reksa dana mana. Persentase dihitung terhadap saham yang berada di
        kustodian KSEI; blok pengendali sering tercatat di luar kustodian, sehingga penyebutnya lebih dekat ke free
        float daripada ke total saham tercatat. Rasio kustodian terhadap saham tercatat ditampilkan pada tiap emiten.
      </SourceNote>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Per-emiten detail
// ---------------------------------------------------------------------------

const VERDICT_TONE: Record<string, 'up' | 'down' | 'neutral' | 'muted'> = {
  akumulasi: 'up',
  distribusi: 'down',
  stabil: 'neutral',
  'tidak-cukup-data': 'muted',
};

const OwnershipDetail: React.FC<{ profile: OwnershipProfile; onSelectEmiten: (code: string) => void }> = ({
  profile,
  onSelectEmiten,
}) => {
  const [merged, setMerged] = useState<'gabungan' | 'terpisah'>('gabungan');

  const chartData = profile.points.map((p) => ({
    month: monthLabel(p.month),
    institusi: p.institusi * 100,
    ritel: p.ritel * 100,
    reksadana: p.reksadana * 100,
    spread: p.spread * 100,
    // Recharts draws an area between two bounds when the value is a [low, high]
    // tuple, which is exactly the ribbon we want — and unlike a stacked pair of
    // areas it puts one entry in the legend instead of a phantom "base" series.
    band: [Math.min(p.institusi, p.ritel) * 100, Math.max(p.institusi, p.ritel) * 100] as [number, number],
  }));

  const rows: HolderLine[] = merged === 'gabungan' ? profile.byType : profile.holders;
  const latest = profile.latest;

  return (
    <div className="mt-4 space-y-4 sm:space-y-5">
      <StatGrid>
        <Stat
          label="Institusi"
          value={pctOf(latest.institusi)}
          tone="accent"
          hint={`${pp(profile.institusiChange3m)} dalam 3 bulan`}
        />
        <Stat label="Individu" value={pctOf(latest.ritel)} tone="warn" hint="Ritel di register KSEI" />
        <Stat
          label="Jarak institusi − ritel"
          value={pp(latest.spread, 1)}
          tone={profile.spreadChange3m >= 0 ? 'up' : 'down'}
          hint={`${profile.spreadChange3m >= 0 ? 'Melebar' : 'Menyempit'} ${pp(profile.spreadChange3m)} dalam 3 bulan`}
        />
        <Stat
          label="Reksa dana"
          value={pctOf(latest.reksadana, 2)}
          hint={`${pp(profile.reksadanaChange3m)} dalam 3 bulan`}
        />
      </StatGrid>

      {/* Verdict ------------------------------------------------------- */}
      <div
        className={cx(
          'rounded-xl border p-3.5 sm:p-4',
          profile.verdict.level === 'akumulasi' && 'border-emerald-900/60 bg-emerald-950/20',
          profile.verdict.level === 'distribusi' && 'border-rose-900/60 bg-rose-950/20',
          profile.verdict.level === 'stabil' && 'border-slate-800 bg-slate-950',
          profile.verdict.level === 'tidak-cukup-data' && 'border-slate-800 bg-slate-950'
        )}
      >
        <div className="flex items-center gap-2">
          {profile.verdict.level === 'akumulasi' ? (
            <ArrowUpRight className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
          ) : profile.verdict.level === 'distribusi' ? (
            <ArrowDownRight className="w-4 h-4 text-rose-400 shrink-0" aria-hidden="true" />
          ) : (
            <Minus className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
          )}
          <span className="text-sm font-bold text-white">{profile.verdict.headline}</span>
          <Pill tone={VERDICT_TONE[profile.verdict.level]}>{profile.verdict.level}</Pill>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-400">{profile.verdict.reason}</p>
      </div>

      {/* The two lines ------------------------------------------------- */}
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-xs font-bold text-slate-200">Institusi vs ritel di register KSEI</h4>
          <span className="text-[10px] text-slate-500">
            Pita = jarak antar garis. Melebar ke atas artinya barang berpindah ke pengelola dana.
          </span>
        </div>
        <div className="mt-3 h-64 sm:h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
              <defs>
                <linearGradient id="own-band" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART.cyan} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={CHART.cyan} stopOpacity={0.06} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
              <XAxis
                dataKey="month"
                tick={{ fill: CHART.tick, fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: CHART.grid }}
                minTickGap={16}
              />
              <YAxis
                tick={{ fill: CHART.tick, fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                width={44}
              />
              <Tooltip
                contentStyle={{
                  background: CHART.tooltipBg,
                  border: `1px solid ${CHART.grid}`,
                  borderRadius: 10,
                  fontSize: 11,
                }}
                labelStyle={{ color: CHART.tooltipLabel, fontWeight: 700 }}
                formatter={(value: number | [number, number], key: string) =>
                  Array.isArray(value)
                    ? [`${value[0].toFixed(2)}% – ${value[1].toFixed(2)}%`, key]
                    : [`${value.toFixed(2)}%`, key]
                }
              />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} iconType="plainline" />
              <Area
                dataKey="band"
                stroke="none"
                fill="url(#own-band)"
                name="Jarak institusi − ritel"
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="institusi"
                name="Institusi"
                stroke={CHART.cyan}
                strokeWidth={2.2}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="ritel"
                name="Individu"
                stroke={CHART.amber}
                strokeWidth={2.2}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="reksadana"
                name="Reksa dana"
                stroke={CHART.violet}
                strokeWidth={1.6}
                strokeDasharray="4 3"
                dot={false}
                isAnimationActive={false}
              />
              <ReferenceLine y={0} stroke={CHART.grid} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Holder table -------------------------------------------------- */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs font-bold text-slate-200">Rincian pemegang</h4>
          <Segmented
            options={[
              { id: 'gabungan', label: 'Gabungan' },
              { id: 'terpisah', label: 'Lokal / asing', shortLabel: 'Lokal/asing' },
            ]}
            value={merged}
            onChange={setMerged}
            ariaLabel="Tampilan rincian pemegang"
            size="sm"
          />
        </div>

        <TableScroll className="mt-3">
          <table className="w-full min-w-[640px] text-xs">
            <thead className="border-b border-slate-800">
              <tr>
                <Th align="left" sticky>
                  Pemegang
                </Th>
                {merged === 'terpisah' && <Th align="left">Asal</Th>}
                <Th>% register</Th>
                <Th>Saham</Th>
                <Th>Nilai</Th>
                <Th>Δ 1 bln</Th>
                <Th>Δ 3 bln</Th>
                <Th>Δ 12 bln</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {rows.map((h) => (
                <tr key={`${h.key}-${h.origin}`} className="hover:bg-slate-800/30">
                  <Td align="left" sticky className="font-semibold">
                    <span className={SIDE_TONE[h.side]}>{h.label}</span>
                    <span className="ml-2 text-[9px] uppercase tracking-wide text-slate-600">{h.side}</span>
                  </Td>
                  {merged === 'terpisah' && (
                    <Td align="left" className="text-slate-400">
                      {h.origin}
                    </Td>
                  )}
                  <Td className="font-bold text-slate-100">{pctOf(h.share, 2)}</Td>
                  <Td className="text-slate-400">{shares(h.shares)}</Td>
                  <Td className="text-slate-300">{bn(h.valueIdrBn, 0)}</Td>
                  <Delta v={h.change1m} />
                  <Delta v={h.change3m} />
                  <Delta v={h.change12m} />
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="muted">
          Kustodian KSEI = {pctOf(profile.custodyCoverage, 1)} dari {shares(profile.issuedShares)} saham tercatat
        </Pill>
        <Pill tone="muted">Nilai register {bn(latest.custodyValueIdrBn, 0)}</Pill>
        <Pill tone="muted">Data per {monthLabel(latest.month)}</Pill>
        <button
          type="button"
          onClick={() => onSelectEmiten(profile.code)}
          className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-[10px] font-bold text-slate-300 hover:border-cyan-700 hover:text-cyan-300 cursor-pointer touch-target"
        >
          Buka detail {profile.code}
        </button>
      </div>

      {profile.custodyCoverage < 0.6 && (
        <SourceNote icon={Info}>
          Hanya {pctOf(profile.custodyCoverage, 1)} saham {profile.code} berada di kustodian KSEI. Sisanya — biasanya
          blok pengendali — tercatat di luar kustodian dan tidak muncul di tabel ini. Semua persentase di atas adalah
          persentase dari bagian yang berada di kustodian, bukan dari seluruh saham tercatat.
        </SourceNote>
      )}
    </div>
  );
};

const Delta: React.FC<{ v: number }> = ({ v }) => (
  <Td className={cx('font-semibold', !Number.isFinite(v) ? 'text-slate-600' : v > 0 ? 'text-emerald-400' : v < 0 ? 'text-rose-400' : 'text-slate-500')}>
    {pp(v)}
  </Td>
);

// ---------------------------------------------------------------------------
// Movers
// ---------------------------------------------------------------------------

const MoverTable: React.FC<{
  title: string;
  tone: 'up' | 'down';
  rows: OwnershipMover[];
  db: MarketDatabase | null;
  basis: BasisId;
  onInspect: (code: string) => void;
}> = ({ title, tone, rows, db, basis, onInspect }) => (
  <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 sm:p-4">
    <div className="flex items-center gap-2">
      {tone === 'up' ? (
        <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
      ) : (
        <ArrowDownRight className="w-3.5 h-3.5 text-rose-400" aria-hidden="true" />
      )}
      <h4 className="text-xs font-bold text-slate-200">{title}</h4>
    </div>

    <div className="mt-3 overflow-x-auto scrollbar-thin">
      <table className="w-full min-w-[420px] text-xs">
        <thead className="border-b border-slate-800">
          <tr>
            <Th align="left">Emiten</Th>
            <Th>{basis === 'nilai' ? 'Nilai masuk' : 'Δ institusi'}</Th>
            <Th>Institusi</Th>
            <Th>Reksa dana</Th>
            <Th>Harga</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/70">
          {rows.map((r) => (
            <tr
              key={r.code}
              onClick={() => onInspect(r.code)}
              className="cursor-pointer hover:bg-slate-800/30"
            >
              <Td align="left">
                <button
                  type="button"
                  onClick={() => onInspect(r.code)}
                  className="font-bold text-cyan-300 hover:text-cyan-200 cursor-pointer"
                  title="Tampilkan register emiten ini"
                >
                  {r.code}
                </button>
                <div className="max-w-[150px] truncate text-[10px] text-slate-500">
                  {db?.byCode.get(r.code)?.name ?? ''}
                </div>
              </Td>
              <Td
                className={cx(
                  'font-bold',
                  (basis === 'nilai' ? r.valueDeltaIdrBn : r.institusiDelta) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                )}
              >
                {basis === 'nilai' ? bn(r.valueDeltaIdrBn, 0) : pp(r.institusiDelta)}
                <div className="text-[9px] font-normal text-slate-500">
                  {basis === 'nilai' ? pp(r.institusiDelta) : bn(r.valueDeltaIdrBn, 0)}
                </div>
                {r.registerDistorted && (
                  <div className="mt-0.5 text-[9px] font-normal text-amber-400/90">
                    register {r.custodyChange >= 0 ? '+' : '−'}
                    {Math.abs(r.custodyChange * 100).toFixed(0)}%
                  </div>
                )}
              </Td>
              <Td className="text-slate-200">{pctOf(r.institusi)}</Td>
              <Td className="text-slate-400">{pctOf(r.reksadana, 2)}</Td>
              <Td className={cx(r.priceChange >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                {Number.isFinite(r.priceChange) ? `${r.priceChange >= 0 ? '+' : ''}${(r.priceChange * 100).toFixed(1)}%` : '–'}
                <div className="text-[9px] font-normal text-slate-500">
                  {r.price.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                </div>
              </Td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <Td align="center" colSpan={5} className="py-6 text-slate-500">
                Tidak ada emiten yang lolos ambang ukuran register.
              </Td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  </div>
);
