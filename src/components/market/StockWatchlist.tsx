import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Crosshair,
  ExternalLink,
  FileText,
  Info,
  LineChart,
  Network,
  Newspaper,
  Activity,
  FlaskConical,
} from 'lucide-react';
import { MarketDatabase } from '../../data/marketRepository';
import { FactorSnapshot } from '../../types/market';
import { AnnouncementsFile, summariseAnnouncements } from '../../models/announcements';
import { OwnershipFile } from '../../models/ownershipFlow';
import { Horizon, WatchlistCandidate, buildWatchlist } from '../../models/watchlist';
import { SCREENER_MODES, ScreenerMode } from '../../models/stockScreener';
import { buildTradeSetup } from '../../models/tradeSetup';
import { StrategyFile, TriggerDiagnostic, loadStrategyFile } from '../../models/strategyLab';
import { loadIdxFile } from '../../data/idxFiles';
import { NARRATIVE_THEMES } from '../../data/narratives';
import { TradingViewChart } from './TradingViewChart';
import {
  EmptyState,
  Panel,
  PanelHeader,
  Pill,
  Segmented,
  SourceNote,
  Spinner,
  Stat,
  StatGrid,
  cx,
} from '../common/ui';

interface Props {
  db: MarketDatabase;
  factors: Map<string, FactorSnapshot> | null;
  onSelectEmiten: (code: string) => void;
  /** Emiten to expand on arrival, set when navigating in from the screener. */
}

const rp = (v: number, d = 0) => (Number.isFinite(v) ? v.toLocaleString('id-ID', { maximumFractionDigits: d }) : '–');
const pct = (v: number, d = 1) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%` : '–');

const TONE_PILL: Record<string, 'up' | 'down' | 'neutral' | 'warn' | 'muted'> = {
  peluang: 'up',
  risiko: 'warn',
  netral: 'neutral',
};

/** Setup names, read from the screener registry so the two screens agree. */
const SETUP_LABEL: Record<ScreenerMode, string> = SCREENER_MODES.reduce(
  (acc, m) => ({ ...acc, [m.id]: m.label.toLowerCase() }),
  {} as Record<ScreenerMode, string>
);

const HORIZON_OPTIONS = [
  { id: 'mingguan' as const, label: 'Watchlist mingguan', shortLabel: 'Mingguan' },
  { id: 'bulanan' as const, label: 'Watchlist bulanan', shortLabel: 'Bulanan' },
];

const STAGE_ICONS = [Newspaper, Network, Activity, LineChart];

/** How many candidates show by default — the rest are one click away, never gone. */
const DEFAULT_SHOWN = 5;

export const StockWatchlist: React.FC<Props> = ({ db, factors, onSelectEmiten }) => {
  const [horizon, setHorizon] = useState<Horizon>('mingguan');
  const [announcements, setAnnouncements] = useState<AnnouncementsFile | null>(null);
  const [ownership, setOwnership] = useState<OwnershipFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [annError, setAnnError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [onlyScreened, setOnlyScreened] = useState(false);
  const [showThemes, setShowThemes] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [strategies, setStrategies] = useState<StrategyFile | null>(null);

  useEffect(() => {
    let alive = true;
    void loadStrategyFile().then((f) => {
      if (alive) setStrategies(f);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void Promise.all([
      loadIdxFile<AnnouncementsFile>('announcements.json'),
      loadIdxFile<OwnershipFile>('ownership.json'),
    ]).then(
      ([ann, own]) => {
        if (!alive) return;
        setAnnouncements(ann);
        setOwnership(own);
        if (!ann) setAnnError('Data pengumuman IDX belum dibangun. Jalankan "npm run data:announcements".');
        setLoading(false);
      }
    );
    return () => {
      alive = false;
    };
  }, []);

  const result = useMemo(
    () =>
      buildWatchlist({
        db,
        factors,
        announcements,
        ownership,
        horizon,
        limit: 30,
      }),
    [db, factors, announcements, ownership, horizon]
  );

  const annSummary = useMemo(() => (announcements ? summariseAnnouncements(announcements) : null), [announcements]);

  const filtered = useMemo(
    // "Lolos screener" now means ANY of the three setups, not the momentum one
    // alone. Keeping it on momentum would have hidden every pullback and every
    // laggard behind a filter whose label does not say so.
    () => (onlyScreened ? result.candidates.filter((c) => c.priceAction.setups.length > 0) : result.candidates),
    [result.candidates, onlyScreened]
  );

  const shown = showAll ? filtered : filtered.slice(0, DEFAULT_SHOWN);

  if (loading) return <Spinner label="Memuat pengumuman IDX dan register kepemilikan…" />;

  return (
    <div className="space-y-4 sm:space-y-5">
      <Panel>
        <PanelHeader
          icon={CalendarDays}
          title="Stock Watchlist"
          tone="text-indigo-400"
          subtitle={result.horizon.description}
          actions={
            <Segmented
              options={HORIZON_OPTIONS}
              value={horizon}
              onChange={setHorizon}
              ariaLabel="Horizon watchlist"
              size="sm"
              activeClass="bg-indigo-600 text-white shadow-md shadow-indigo-900/40"
            />
          }
        />

        {/* Funnel ------------------------------------------------------- */}
        <div className="mt-4 grid gap-2.5 md:grid-cols-4">
          {result.funnel.map((stage, i) => {
            const Icon = STAGE_ICONS[i] ?? Info;
            return (
              <div
                key={stage.id}
                className={cx(
                  'rounded-xl border p-3',
                  i === 3 ? 'border-indigo-800/60 bg-indigo-950/20' : 'border-slate-800 bg-slate-950'
                )}
              >
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  <Icon className="w-3 h-3 shrink-0" aria-hidden="true" />
                  <span className="truncate">{stage.label}</span>
                </div>
                <div className={cx('mt-1 text-xl font-extrabold tabular-nums', i === 3 ? 'text-indigo-300' : 'text-white')}>
                  {stage.remaining}
                </div>
                <p className="mt-1 text-[10px] leading-snug text-slate-500">{stage.note}</p>
              </div>
            );
          })}
        </div>

        {annError && (
          <div className="mt-4">
            <EmptyState icon={AlertTriangle} title="Lapisan narasi tidak aktif" tone="warn">
              {annError} Tanpa berkas itu watchlist hanya berjalan dari tema kurasi, dan tahap 1 kehilangan
              sebagian besar isinya.
            </EmptyState>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setOnlyScreened((v) => !v)}
            aria-pressed={onlyScreened}
            className={cx(
              'cursor-pointer rounded-lg border px-3 py-2 text-[11px] font-bold touch-target',
              onlyScreened
                ? 'border-emerald-600 bg-emerald-600/15 text-emerald-300'
                : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
            )}
          >
            Hanya yang lolos salah satu setup
          </button>
          {filtered.length > DEFAULT_SHOWN && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-[11px] font-bold text-slate-300 hover:bg-slate-800 touch-target"
            >
              {showAll ? (
                <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              {showAll ? `Tampilkan ${DEFAULT_SHOWN} conviction teratas` : `Tampilkan semua (${filtered.length})`}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowThemes((v) => !v)}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-[11px] font-bold text-slate-300 hover:bg-slate-800 touch-target"
          >
            <BookOpen className="w-3.5 h-3.5" aria-hidden="true" />
            {NARRATIVE_THEMES.length} tema kurasi
            {result.themesUnsourced > 0 && (
              <span className="ml-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] text-amber-300">
                {result.themesUnsourced} tanpa sumber
              </span>
            )}
          </button>
          {annSummary && (
            <span className="text-[10px] text-slate-500">
              {annSummary.total.toLocaleString('id-ID')} pengumuman {announcements?.from} → {announcements?.to} ·{' '}
              {annSummary.byCategory
                .filter((c) => c.category !== 'rutin')
                .slice(0, 3)
                .map((c) => `${c.count} ${c.label.toLowerCase()}`)
                .join(' · ')}
            </span>
          )}
        </div>
      </Panel>

      {showThemes && <ThemePanel />}

      {strategies && strategies.strategies.length > 0 && <StrategyLabPanel file={strategies} />}

      {/* Candidates ---------------------------------------------------- */}
      {shown.length === 0 ? (
        <EmptyState icon={Newspaper} title="Belum ada kandidat">
          {onlyScreened
            ? 'Tidak ada kandidat bernarasi yang juga lolos salah satu setup screener — momentum, antre beli, maupun tertinggal — pada sesi ini. Matikan saringan untuk melihat yang tape-nya belum konfirmasi.'
            : 'Tidak ada emiten dengan pengajuan material atau tema kurasi pada jendela ini.'}
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {shown.map((c, i) => (
            <CandidateCard
              key={c.code}
              rank={i + 1}
              candidate={c}
              open={expanded === c.code}
              onToggle={() => setExpanded(expanded === c.code ? null : c.code)}
              onSelectEmiten={onSelectEmiten}
              atr14={factors?.get(c.code)?.atr14 ?? NaN}
            />
          ))}
        </div>
      )}

      <SourceNote icon={Info}>
        <strong className="text-slate-400">Urutan alurnya disengaja.</strong> Narasi adalah tiket masuk — emiten yang
        hanya naik tanpa pemicu adalah urusan Screener, bukan Watchlist. Rotasi konglomerasi dan price action menilai,
        bukan menggugurkan: sebagian besar emiten tidak punya grup pengendali dan itu bukan cacat. Tahap terakhir
        sengaja tidak diskor — chart dibaca manusia, dan berpura-pura ada algoritma yang sudah melakukannya akan jadi
        kebohongan. Skor akhir juga dikalikan pengganda tape: kandidat dengan narasi bagus yang sama sekali tidak
        ditransaksikan turun sekitar setengah, tidak sampai nol, karena narasi yang belum diperhatikan pasar justru
        alasan watchlist ini ada.
      </SourceNote>
    </div>
  );
};

// ---------------------------------------------------------------------------

const CandidateCard: React.FC<{
  rank: number;
  candidate: WatchlistCandidate;
  open: boolean;
  onToggle: () => void;
  onSelectEmiten: (code: string) => void;
  atr14: number;
}> = ({ rank, candidate: c, open, onToggle, onSelectEmiten, atr14 }) => {
  const stages = [
    { label: 'Narasi', value: c.narrative.score, tone: 'bg-amber-500' },
    { label: 'Rotasi', value: c.rotation.score, tone: 'bg-indigo-500' },
    { label: 'Tape', value: c.priceAction.score, tone: 'bg-emerald-500' },
  ];

  return (
    <Panel padded={false} tone="flat">
      <div className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold text-slate-600">#{rank}</span>
              <button
                type="button"
                onClick={() => onSelectEmiten(c.code)}
                className="cursor-pointer text-base font-extrabold text-white hover:text-indigo-300"
              >
                {c.code}
              </button>
              <span className="min-w-0 truncate text-[11px] text-slate-400">{c.name}</span>
              <Pill tone={c.changePercent >= 0 ? 'up' : 'down'}>{pct(c.changePercent)}</Pill>
              {c.priceAction.setups.map((s) => (
                <Pill key={s} tone={s === 'momentum' ? 'up' : 'accent'}>
                  {SETUP_LABEL[s]}
                </Pill>
              ))}
              {c.narrative.underExchangeAttention && <Pill tone="warn">perhatian bursa</Pill>}
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
              <span className="text-slate-500">Pemicu:</span> {c.narrative.headline}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-4">
            <div className="w-full min-w-[150px] space-y-1 lg:w-40">
              {stages.map((s) => (
                <div key={s.label} className="flex items-center gap-2">
                  <span className="w-11 shrink-0 text-[9px] uppercase tracking-wide text-slate-500">{s.label}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
                    <span
                      className={cx('block h-full rounded-full', s.tone)}
                      style={{ width: `${Math.round(Math.max(0, Math.min(1, s.value)) * 100)}%` }}
                    />
                  </span>
                  <span className="w-7 shrink-0 text-right text-[9px] tabular-nums text-slate-500">
                    {s.value.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
            <div className="text-right">
              <div className="text-[9px] uppercase tracking-wide text-slate-500">Skor</div>
              <div className="text-xl font-extrabold tabular-nums text-white">{c.score.toFixed(2)}</div>
              <div className="text-[9px] text-slate-600">{c.stagesCleared}/3 tahap</div>
            </div>
          </div>
        </div>

        {c.reasons.length > 0 && (
          <ul className="mt-3 space-y-1">
            {c.reasons.slice(0, open ? 8 : 2).map((r, i) => (
              <li key={i} className="flex gap-1.5 text-[11px] leading-relaxed text-slate-300">
                <ArrowRight className="mt-0.5 w-3 h-3 shrink-0 text-emerald-500" aria-hidden="true" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        )}

        {c.cautions.length > 0 && (
          <ul className="mt-2 space-y-1">
            {c.cautions.slice(0, open ? 8 : 1).map((r, i) => (
              <li key={i} className="flex gap-1.5 text-[11px] leading-relaxed text-amber-300/90">
                <AlertTriangle className="mt-0.5 w-3 h-3 shrink-0 text-amber-500" aria-hidden="true" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="mt-3 flex cursor-pointer items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-[11px] font-bold text-slate-200 hover:bg-slate-700 touch-target"
        >
          {open ? <ChevronUp className="w-3 h-3" aria-hidden="true" /> : <ChevronDown className="w-3 h-3" aria-hidden="true" />}
          {open ? 'Tutup alur kerja' : 'Buka alur kerja 4 tahap'}
        </button>
      </div>

      {open && <CandidateDetail candidate={c} atr14={atr14} />}
    </Panel>
  );
};

// ---------------------------------------------------------------------------

const CandidateDetail: React.FC<{ candidate: WatchlistCandidate; atr14: number }> = ({ candidate: c, atr14 }) => {
  const setup = buildTradeSetup({ code: c.code, close: c.close, atr14 });
  return (
  <div className="space-y-4 border-t border-slate-800 bg-slate-950 p-4 sm:p-5">
    {/* 1 — narrative */}
    <StageBlock n={1} icon={Newspaper} title="Narasi" tone="text-amber-400" score={c.narrative.score}>
      {c.narrative.themes.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {c.narrative.themes.map((h) => (
            <span
              key={h.theme.id}
              title={h.member.why}
              className="inline-flex items-center gap-1 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2 py-1 text-[10px] font-bold text-indigo-200"
            >
              {h.theme.name}
              <span className="text-indigo-400/70">
                {h.member.exposure === 'langsung' ? 'langsung' : 'tak langsung'} · {h.weight.toFixed(2)}
              </span>
            </span>
          ))}
        </div>
      )}

      {c.narrative.signal && c.narrative.signal.material.length > 0 ? (
        <ul className="space-y-1.5">
          {c.narrative.signal.material.slice(0, 6).map((f, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[11px]">
              <Pill tone={TONE_PILL[f.meta.tone] ?? 'neutral'}>{f.meta.label}</Pill>
              <span className="text-slate-600">{f.date}</span>
              {f.pdfUrl ? (
                <a
                  href={f.pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 text-slate-300 underline decoration-slate-700 underline-offset-2 hover:text-white"
                >
                  {f.title}
                  <ExternalLink className="ml-1 inline w-2.5 h-2.5" aria-hidden="true" />
                </a>
              ) : (
                <span className="min-w-0 flex-1 text-slate-300">{f.title}</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-slate-500">
          Tidak ada pengajuan material ke IDX dalam jendela ini — emiten masuk lewat tema kurasi saja.
        </p>
      )}
    </StageBlock>

    {/* 2 — rotation */}
    <StageBlock n={2} icon={Network} title="Rotasi konglomerasi" tone="text-indigo-400" score={c.rotation.score}>
      {c.rotation.group ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="font-bold text-slate-200">{c.rotation.group.group.name}</span>
            <Pill tone={c.rotation.role === 'laggard' ? 'accent' : c.rotation.role === 'leader' ? 'up' : 'neutral'}>
              {c.rotation.role === 'laggard' ? 'paling tertinggal' : c.rotation.role === 'leader' ? 'pemimpin' : 'tengah'}
            </Pill>
            <span className="text-slate-500">
              kohesi {Number.isFinite(c.rotation.cohesion) ? c.rotation.cohesion.toFixed(2) : '–'} · tertinggal{' '}
              {pct(c.rotation.gapToLeader)} dari pemimpin
            </span>
          </div>
          {c.rotation.verdict && (
            <p className="text-[11px] leading-relaxed text-slate-400">{c.rotation.verdict.reason}</p>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-slate-500">
          Emiten ini tidak ada di tabel grup pengendali. Bukan nilai minus — sebagian besar emiten memang berdiri
          sendiri, dan tahap ini hanya menambah skor kalau grupnya benar-benar bergerak.
        </p>
      )}
    </StageBlock>

    {/* 3 — price action */}
    <StageBlock n={3} icon={Activity} title="Price action & broker" tone="text-emerald-400" score={c.priceAction.score}>
      <StatGrid cols={4}>
        <Stat
          label="Asing net hari ini"
          value={`Rp ${rp(c.priceAction.foreignNetIdrBn, 1)} miliar`}
          hint="beli asing − jual asing, sesi ini"
          tone={c.priceAction.foreignNetIdrBn >= 0 ? 'up' : 'down'}
        />
        <Stat
          label="Nilai vs median 20 sesi"
          value={Number.isFinite(c.priceAction.valueSurge) ? `${c.priceAction.valueSurge.toFixed(1)}x` : '–'}
          hint={
            Number.isFinite(c.priceAction.volumeSurge) ? `volume ${c.priceAction.volumeSurge.toFixed(2)}x` : undefined
          }
        />
        <Stat
          label="Rata-rata per transaksi"
          value={
            Number.isFinite(c.priceAction.avgTicketIdr) ? `Rp ${rp(c.priceAction.avgTicketIdr / 1e6, 1)} juta` : '–'
          }
          hint={
            Number.isFinite(c.priceAction.ticketPercentile)
              ? `nilai ÷ jumlah transaksi · persentil ${(c.priceAction.ticketPercentile * 100).toFixed(0)} pasar`
              : 'nilai ÷ jumlah transaksi'
          }
          tone={c.priceAction.ticketPercentile > 0.8 ? 'accent' : 'neutral'}
        />
        <Stat
          label="Institusi KSEI 3 bln"
          value={
            Number.isFinite(c.priceAction.institutionalDeltaPp)
              ? `${c.priceAction.institutionalDeltaPp >= 0 ? '+' : '−'}${Math.abs(c.priceAction.institutionalDeltaPp).toFixed(2)} pp`
              : '–'
          }
          tone={c.priceAction.institutionalDeltaPp >= 0 ? 'up' : 'down'}
        />
      </StatGrid>

      {c.priceAction.screener && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {/* Which of the three setups this name fits today. Empty is a real
              answer: the narrative is there and the tape has not confirmed it
              in any of the three ways the screener can check. */}
          {c.priceAction.setups.length ? (
            c.priceAction.setups.map((s) => (
              <Pill key={s} tone={s === 'momentum' ? 'up' : 'accent'}>
                setup {SETUP_LABEL[s]}
              </Pill>
            ))
          ) : (
            <Pill tone="muted">tanpa setup screener</Pill>
          )}
          {Number.isFinite(c.priceAction.dipFromHigh) && c.priceAction.dipFromHigh < -0.05 && (
            <Pill tone="muted">{pct(c.priceAction.dipFromHigh)} dari puncak 60 sesi</Pill>
          )}
          {Number.isFinite(c.priceAction.gapToIndexPp) && Math.abs(c.priceAction.gapToIndexPp) >= 5 && (
            <Pill tone="muted">
              {c.priceAction.gapToIndexPp >= 0 ? 'tertinggal' : 'unggul'}{' '}
              {Math.abs(c.priceAction.gapToIndexPp).toFixed(1)} pp dari {c.priceAction.indexCode}
            </Pill>
          )}
          <Pill tone={c.priceAction.screener.passMa ? 'up' : 'down'}>
            MA{c.priceAction.screener.passMa ? ' ✓' : ' ✗'}
          </Pill>
          <Pill tone={c.priceAction.screener.passVolume ? 'up' : 'down'}>
            Volume{c.priceAction.screener.passVolume ? ' ✓' : ' ✗'}
          </Pill>
          <Pill tone={c.priceAction.screener.passValue ? 'up' : 'down'}>
            Nilai{c.priceAction.screener.passValue ? ' ✓' : ' ✗'}
          </Pill>
          <Pill tone="muted">{c.priceAction.screener.sessionsAboveMaLong} sesi di atas MA</Pill>
          <Pill tone="muted">RSI {Number.isFinite(c.priceAction.rsi14) ? c.priceAction.rsi14.toFixed(0) : '–'}</Pill>
        </div>
      )}

      <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
        <strong className="text-slate-400">Apa itu "rata-rata per transaksi".</strong> Nilai transaksi sesi ini dibagi
        jumlah transaksinya — berapa rupiah rata-rata sekali order yang terjadi di emiten ini. Angkanya penting karena
        ritel mencetak banyak order kecil sementara institusi mencetak sedikit order besar, jadi rata-rata yang jauh di
        atas pasar berarti tangan yang lebih besar sedang bertransaksi di sini. Persentilnya dibandingkan terhadap
        seluruh emiten yang bertransaksi pada hari yang sama, bukan terhadap sejarah emiten itu sendiri, karena
        history.json menyimpan nilai transaksi tetapi tidak jumlah transaksi.{' '}
        <strong className="text-slate-400">Dan soal "asing net":</strong> itu nilai beli investor asing dikurangi nilai
        jualnya pada sesi tersebut, dalam miliar rupiah — IDX hanya menerbitkannya di akhir sesi, jadi pada refresh
        siang hari angkanya masih milik sesi resmi terakhir.
      </p>
    </StageBlock>

    {/* trade setup — mechanical, not scored alongside the funnel stages */}
    <StageBlock icon={Crosshair} title="Trade setup" tone="text-rose-300" score={null}>
      {setup ? (
        <>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Entry</div>
              <div className="text-sm font-bold text-slate-100 tabular-nums">
                {setup.entry.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-rose-400">Stop</div>
              <div className="text-sm font-bold text-rose-300 tabular-nums">
                {setup.stop.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-emerald-400">Target</div>
              <div className="text-sm font-bold text-emerald-300 tabular-nums">
                {setup.target.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Pill tone="muted">Risiko {(setup.riskPercent * 100).toFixed(1)}%</Pill>
            <Pill tone="muted">R:R 1 : {setup.rewardRiskRatio.toFixed(1)}</Pill>
          </div>
          <p className="mt-2.5 text-[10px] leading-relaxed text-slate-500">
            Stop = entry − 1,5×ATR14, target = entry + 2,5×ATR14 — level mekanis dari volatilitas hariannya sendiri,
            bukan rekomendasi beli atau jual.
          </p>
        </>
      ) : (
        <p className="text-[11px] text-slate-500">Trade setup belum bisa dihitung — ATR14 belum tersedia.</p>
      )}
    </StageBlock>

    {/* 4 — chart */}
    <StageBlock n={4} icon={LineChart} title="Chart" tone="text-cyan-400" score={null}>
      <TradingViewChart symbol={c.tradingViewSymbol} />
    </StageBlock>
  </div>
  );
};

const StageBlock: React.FC<{
  n?: number;
  icon: React.ElementType;
  title: string;
  tone: string;
  score: number | null;
  children: React.ReactNode;
}> = ({ n, icon: Icon, title, tone, score, children }) => (
  <section className="rounded-xl border border-slate-800 bg-slate-900 p-3.5 sm:p-4">
    <div className="mb-3 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        {n !== undefined && (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-slate-800 text-[10px] font-bold text-slate-300">
            {n}
          </span>
        )}
        <Icon className={cx('w-3.5 h-3.5 shrink-0', tone)} aria-hidden="true" />
        <h5 className="text-xs font-bold text-white">{title}</h5>
      </div>
      {score !== null ? (
        <span className="text-[10px] tabular-nums text-slate-500">skor {score.toFixed(2)}</span>
      ) : (
        <span className="text-[10px] text-slate-600">tidak diskor</span>
      )}
    </div>
    {children}
  </section>
);

// ---------------------------------------------------------------------------

/**
 * Reads scripts/strategy-lab.ts's output.
 *
 * EVERY HEADLINE NUMBER IS THE OUT-OF-SAMPLE ONE. The lab searches ~21,000 rule
 * sets on the first 70% of the history and then judges the survivors on the
 * last 30%, which the search never saw. Leading with the full-history figure
 * would re-import exactly the overfitting the split exists to remove, so the
 * card shows the test result big and the train result small beside it — the gap
 * between them is the reader's own overfitting check.
 */
const StrategyLabPanel: React.FC<{ file: StrategyFile }> = ({ file }) => {
  const [open, setOpen] = useState(false);
  const shown = open ? file.strategies : file.strategies.slice(0, 3);

  return (
    <Panel>
      <PanelHeader
        icon={FlaskConical}
        title="Strategi teruji"
        tone="text-rose-300"
        subtitle={`${file.ruleSetsTested.toLocaleString('id-ID')} kombinasi aturan diuji atas ${file.universe} emiten × ${file.sessions} sesi (${file.totalTradesSimulated.toLocaleString('id-ID')} trade tersimulasi). Dicari di ${file.split.trainFrom} → ${file.split.trainTo}, lalu diuji di ${file.split.testFrom} → ${file.split.testTo} yang belum pernah dilihat. Angka besar di bawah ini semuanya dari data uji itu.`}
        actions={
          file.strategies.length > 3 && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-[11px] font-bold text-slate-300 hover:bg-slate-800 touch-target"
            >
              {open ? <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />}
              {open ? 'Ringkas' : `Tampilkan semua (${file.strategies.length})`}
            </button>
          )
        }
      />

      <div className="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Stat label="Lolos semua gerbang" value={String(file.survivors)} tone="accent" hint={`dari ${file.ruleSetsTested.toLocaleString('id-ID')} diuji`} />
        <Stat label="Syarat winrate" value={`≥${(file.gates.minTestWinRate * 100).toFixed(0)}%`} hint="di data uji, bukan data latih" />
        <Stat label="Syarat expectancy" value={`≥${file.gates.minTestExpectancyR.toFixed(2)}R`} hint="per trade, di data uji" />
        <Stat
          label="Uji rapuh"
          value={`−${(file.gates.stressWinRateHaircut * 100).toFixed(0)}pp`}
          tone="warn"
          hint="winrate dipotong, harus tetap untung"
        />
      </div>

      <div className="mt-3 space-y-2">
        {shown.map((s, i) => (
          <div key={s.id} className="rounded-xl border border-slate-800 bg-slate-950 p-3.5">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-[10px] text-slate-600">#{i + 1}</span>
              <Pill tone="accent">{s.family}</Pill>
              <span className="text-base font-extrabold text-white tabular-nums">
                {(s.test.winRate * 100).toFixed(0)}%
              </span>
              <span className="text-[11px] text-slate-500">winrate uji · {s.test.trades} trade</span>
              <span className="text-slate-700">|</span>
              <span className="text-sm font-bold text-emerald-300 tabular-nums">
                {s.test.expectancyR >= 0 ? '+' : ''}
                {s.test.expectancyR.toFixed(2)}R
              </span>
              <span className="text-[11px] text-slate-500">expectancy</span>
            </div>

            <p className="mt-2 text-[11px] leading-relaxed text-slate-300">
              <span className="text-slate-500">Entry:</span> {s.triggerLabel}
              {s.filterLabels.length > 0 && (
                <>
                  , disaring <strong className="font-semibold text-slate-200">{s.filterLabels.join(' + ')}</strong>
                </>
              )}
              . <span className="text-slate-500">Exit:</span> {s.exitLabel}.
            </p>

            <div className="mt-2 flex flex-wrap gap-1.5">
              <Pill tone={s.stressedExpectancyR > 0 ? 'up' : 'down'}>
                Tahan uji rapuh {s.stressedExpectancyR >= 0 ? '+' : ''}
                {s.stressedExpectancyR.toFixed(2)}R
              </Pill>
              <Pill tone="muted">R:R {s.rewardRisk.toFixed(2)}</Pill>
              <Pill tone="muted">Profit factor {Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞'}</Pill>
              <Pill tone="muted">Max drawdown {s.maxDrawdownR.toFixed(1)}R</Pill>
              <Pill tone="muted">
                latih: {(s.train.winRate * 100).toFixed(0)}% dari {s.train.trades}
              </Pill>
            </div>
          </div>
        ))}
      </div>

      {file.perTrigger && file.perTrigger.length > 0 && <TriggerLedger rows={file.perTrigger} />}

      <SourceNote icon={Info}>
        <strong className="text-slate-400">Winrate tinggi itu gampang dipalsukan, dan itu yang dijaga di sini.</strong>{' '}
        Target kecil dengan stop lebar bisa menang 90% dan tetap rugi, karena satu kekalahan menghapus enam kemenangan.
        Karena itu tiap kandidat dihitung ulang dengan winrate dipotong{' '}
        {(file.gates.stressWinRateHaircut * 100).toFixed(0)} poin memakai rata-rata menang dan rata-rata kalahnya
        sendiri; yang jadi rugi setelah potongan itu dibuang, berapa pun winrate aslinya. Peringkatnya pun memakai angka
        setelah potongan, bukan winrate mentah. Tetap angka historis, bukan janji. Sinyal bandarmology (ukuran tiket
        rata-rata) belum diuji karena riwayat jumlah transaksi baru mulai direkam — lihat komentar di
        scripts/strategy-lab.ts.
      </SourceNote>
    </Panel>
  );
};

/**
 * Every trigger the lab searched, including the ones that survived nothing.
 *
 * This panel exists because of what the two new screener setups turned up. Dip
 * and laggard entries produced HUNDREDS of rule sets clearing the 65% win-rate
 * bar and not one that also cleared expectancy — meaning the win rate was
 * bought with tiny targets against wide stops, exactly the fragility the stress
 * gate was added to catch. Publishing only the leaderboard would have shown a
 * board full of moving-average crosses and said nothing at all about that,
 * which reads as "never tried" rather than "tried and failed".
 */
const TriggerLedger: React.FC<{ rows: TriggerDiagnostic[] }> = ({ rows }) => (
  <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950 p-3.5">
    <h5 className="text-[11px] font-bold text-slate-200">Seberapa telat tiap trigger, dan mana yang gugur</h5>
    <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
      Kolom pertama menjawab &quot;kita selalu telat&quot;: berapa persen saham itu rata-rata SUDAH naik dari dasar 60
      sesinya ketika trigger menyala. Tembus tertinggi 20 sesi baru masuk setelah naik 87% dan tidak meloloskan satu
      pun rule set; jarak ke indeks masuk paling awal di 12% dan juga tidak meloloskan apa pun. Masuk lebih awal itu
      syarat perlu, bukan syarat cukup. Sisanya corong gerbang dari kiri ke kanan: trigger dengan nol di kolom terakhir
      sudah diuji dan gugur — itu temuan, bukan sesuatu yang tidak pernah dicoba. Kalau winrate terbaiknya tinggi
      tetapi tidak ada yang lolos, winrate itu dibeli dengan target kecil dan stop lebar, dan gerbang rapuh
      menolaknya.
    </p>
    <div className="mt-2.5 -mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[560px] text-[10px]">
        <thead className="border-b border-slate-800 text-slate-500">
          <tr>
            <th className="py-1.5 pr-2 text-left font-semibold uppercase tracking-wide">Trigger</th>
            <th
              className="py-1.5 px-2 text-right font-semibold uppercase tracking-wide"
              title="Rata-rata kenaikan yang SUDAH terjadi dari dasar 60 sesi pada saat trigger ini menyala. Makin besar, makin telat."
            >
              Masuk stlh naik
            </th>
            <th className="py-1.5 px-2 text-right font-semibold uppercase tracking-wide">Dinilai</th>
            <th className="py-1.5 px-2 text-right font-semibold uppercase tracking-wide">Lolos WR</th>
            <th className="py-1.5 px-2 text-right font-semibold uppercase tracking-wide">Lolos expectancy</th>
            <th className="py-1.5 px-2 text-right font-semibold uppercase tracking-wide">Tahan rapuh</th>
            <th className="py-1.5 pl-2 text-right font-semibold uppercase tracking-wide">Expectancy terbaik</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/70">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="py-1.5 pr-2">
                <span className="font-bold text-slate-200">{r.id}</span>
                <span className="ml-1.5 text-slate-600">{r.family}</span>
              </td>
              <td
                className={cx(
                  'py-1.5 px-2 text-right font-bold tabular-nums',
                  r.avgRunupAtEntry === null
                    ? 'text-slate-600'
                    : r.avgRunupAtEntry >= 0.5
                      ? 'text-rose-400'
                      : r.avgRunupAtEntry >= 0.3
                        ? 'text-amber-300'
                        : 'text-emerald-300'
                )}
              >
                {r.avgRunupAtEntry === null ? '–' : `+${(r.avgRunupAtEntry * 100).toFixed(0)}%`}
              </td>
              <td className="py-1.5 px-2 text-right tabular-nums text-slate-400">{r.ruleSetsWithEnoughTrades}</td>
              <td className="py-1.5 px-2 text-right tabular-nums text-slate-400">{r.passedWinRate}</td>
              <td className="py-1.5 px-2 text-right tabular-nums text-slate-400">{r.passedExpectancy}</td>
              <td
                className={cx(
                  'py-1.5 px-2 text-right font-bold tabular-nums',
                  r.survivors > 0 ? 'text-emerald-300' : 'text-rose-400'
                )}
              >
                {r.survivors}
              </td>
              <td className="py-1.5 pl-2 text-right tabular-nums text-slate-300">
                {r.bestTestExpectancyR === null
                  ? '–'
                  : `${r.bestTestExpectancyR >= 0 ? '+' : ''}${r.bestTestExpectancyR.toFixed(2)}R`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

const ThemePanel: React.FC = () => (
  <Panel>
    <PanelHeader
      icon={BookOpen}
      title="Tema kebijakan terkurasi"
      subtitle="Separuh narasi Indonesia tidak pernah sampai ke IDX: perusahaan melapor kalau DIA yang bertindak, bukan ketika pemerintah mengumumkan program. Tema di bawah ini ditulis tangan di src/data/narratives.ts, sama seperti tabel konglomerasi, dan menua otomatis — bobotnya meluruh ke nol dalam 90 hari sejak tanggal terakhir diperiksa."
    />
    <div className="mt-4 grid gap-3 lg:grid-cols-2">
      {NARRATIVE_THEMES.map((t) => (
        <div key={t.id} className="rounded-xl border border-slate-800 bg-slate-950 p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-xs font-bold text-white">{t.name}</h4>
            {t.confidence === 'medium' && <Pill tone="muted">keyakinan sedang</Pill>}
            {!t.source.trim() ? (
              <Pill tone="warn">sumber belum diisi · bobot ×0,5</Pill>
            ) : (
              <a
                href={t.source}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[10px] font-bold text-cyan-300 hover:text-cyan-200"
              >
                sumber <ExternalLink className="w-2.5 h-2.5" aria-hidden="true" />
              </a>
            )}
            <span className="text-[10px] text-slate-600">diperiksa {t.checkedOn}</span>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">{t.driver}</p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {t.members.map((m) => (
              <span
                key={m.code}
                title={m.why}
                className={cx(
                  'rounded-md border px-1.5 py-0.5 text-[10px] font-bold',
                  m.exposure === 'langsung'
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    : 'border-slate-700 bg-slate-900 text-slate-400'
                )}
              >
                {m.code}
              </span>
            ))}
          </div>
          {t.note && <p className="mt-2 text-[10px] leading-relaxed text-slate-500">{t.note}</p>}
        </div>
      ))}
    </div>
    <SourceNote icon={FileText}>
      Hijau berarti eksposur langsung, abu-abu berarti tidak langsung dan hanya dihitung setengah. Menambah tema Anda
      sendiri adalah pemakaian yang dimaksudkan: satu blok di{' '}
      <code className="text-slate-400">src/data/narratives.ts</code>, lalu isi <code className="text-slate-400">source</code>{' '}
      dengan tautan beritanya agar bobotnya tidak dipotong.
    </SourceNote>
  </Panel>
);
