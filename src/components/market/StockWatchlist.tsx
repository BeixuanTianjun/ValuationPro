import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileText,
  Info,
  LineChart,
  Network,
  Newspaper,
  Activity,
} from 'lucide-react';
import { MarketDatabase } from '../../data/marketRepository';
import { FactorSnapshot } from '../../types/market';
import { AnnouncementsFile, summariseAnnouncements } from '../../models/announcements';
import { OwnershipFile } from '../../models/ownershipFlow';
import { Horizon, WatchlistCandidate, buildWatchlist } from '../../models/watchlist';
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
  focusEmiten?: string | null;
  onFocusHandled?: () => void;
}

const rp = (v: number, d = 0) => (Number.isFinite(v) ? v.toLocaleString('id-ID', { maximumFractionDigits: d }) : '–');
const pct = (v: number, d = 1) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%` : '–');

const TONE_PILL: Record<string, 'up' | 'down' | 'neutral' | 'warn' | 'muted'> = {
  peluang: 'up',
  risiko: 'warn',
  netral: 'neutral',
};

const HORIZON_OPTIONS = [
  { id: 'mingguan' as const, label: 'Watchlist mingguan', shortLabel: 'Mingguan' },
  { id: 'bulanan' as const, label: 'Watchlist bulanan', shortLabel: 'Bulanan' },
];

const STAGE_ICONS = [Newspaper, Network, Activity, LineChart];

export const StockWatchlist: React.FC<Props> = ({ db, factors, onSelectEmiten, focusEmiten, onFocusHandled }) => {
  const [horizon, setHorizon] = useState<Horizon>('mingguan');
  const [announcements, setAnnouncements] = useState<AnnouncementsFile | null>(null);
  const [ownership, setOwnership] = useState<OwnershipFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [annError, setAnnError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [onlyScreened, setOnlyScreened] = useState(false);
  const [showThemes, setShowThemes] = useState(false);

  useEffect(() => {
    let alive = true;
    const url = (name: string) => `${import.meta.env.BASE_URL || '/'}data/idx/${name}`.replace(/\/{2,}/g, '/');
    const get = <T,>(name: string): Promise<T | null> =>
      fetch(url(name), { cache: 'no-cache' })
        .then((r) => (r.ok ? (r.json() as Promise<T>) : Promise.reject(new Error(`HTTP ${r.status}`))))
        .catch(() => null);

    void Promise.all([get<AnnouncementsFile>('announcements.json'), get<OwnershipFile>('ownership.json')]).then(
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

  useEffect(() => {
    if (!focusEmiten) return;
    setExpanded(focusEmiten);
    onFocusHandled?.();
  }, [focusEmiten, onFocusHandled]);

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

  const shown = useMemo(
    () => (onlyScreened ? result.candidates.filter((c) => c.priceAction.passesScreener) : result.candidates),
    [result.candidates, onlyScreened]
  );

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
                  i === 3 ? 'border-indigo-800/60 bg-indigo-950/20' : 'border-slate-800 bg-slate-950/50'
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
            Hanya yang lolos screener
          </button>
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

      {/* Candidates ---------------------------------------------------- */}
      {shown.length === 0 ? (
        <EmptyState icon={Newspaper} title="Belum ada kandidat">
          {onlyScreened
            ? 'Tidak ada kandidat bernarasi yang juga lolos ketiga aturan screener pada sesi ini. Matikan saringan untuk melihat yang tape-nya belum konfirmasi.'
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
}> = ({ rank, candidate: c, open, onToggle, onSelectEmiten }) => {
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
              {c.priceAction.passesScreener && <Pill tone="up">lolos screener</Pill>}
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

      {open && <CandidateDetail candidate={c} />}
    </Panel>
  );
};

// ---------------------------------------------------------------------------

const CandidateDetail: React.FC<{ candidate: WatchlistCandidate }> = ({ candidate: c }) => (
  <div className="space-y-4 border-t border-slate-800 bg-slate-950/50 p-4 sm:p-5">
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

    {/* 4 — chart */}
    <StageBlock n={4} icon={LineChart} title="Chart" tone="text-cyan-400" score={null}>
      <TradingViewChart symbol={c.tradingViewSymbol} />
    </StageBlock>
  </div>
);

const StageBlock: React.FC<{
  n: number;
  icon: React.ElementType;
  title: string;
  tone: string;
  score: number | null;
  children: React.ReactNode;
}> = ({ n, icon: Icon, title, tone, score, children }) => (
  <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-3.5 sm:p-4">
    <div className="mb-3 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-slate-800 text-[10px] font-bold text-slate-300">
          {n}
        </span>
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

const ThemePanel: React.FC = () => (
  <Panel>
    <PanelHeader
      icon={BookOpen}
      title="Tema kebijakan terkurasi"
      subtitle="Separuh narasi Indonesia tidak pernah sampai ke IDX: perusahaan melapor kalau DIA yang bertindak, bukan ketika pemerintah mengumumkan program. Tema di bawah ini ditulis tangan di src/data/narratives.ts, sama seperti tabel konglomerasi, dan menua otomatis — bobotnya meluruh ke nol dalam 90 hari sejak tanggal terakhir diperiksa."
    />
    <div className="mt-4 grid gap-3 lg:grid-cols-2">
      {NARRATIVE_THEMES.map((t) => (
        <div key={t.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3.5">
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
