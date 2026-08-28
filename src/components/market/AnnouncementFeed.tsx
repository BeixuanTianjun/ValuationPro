import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink, FileText, Filter, Newspaper, Search, ServerCrash, TrendingUp } from 'lucide-react';
import { MarketDatabase } from '../../data/marketRepository';
import {
  AnnouncementCategory,
  AnnouncementsFile,
  CATEGORY_META,
  ClassifiedAnnouncement,
  buildNarrativeSignals,
  classifyAnnouncement,
} from '../../models/announcements';
import { EmptyState, Panel, PanelHeader, Pill, SourceNote, Spinner, Stat, StatGrid, cx } from '../common/ui';

/**
 * CN — Keterbukaan Informasi.
 *
 * WHY THIS SCREEN EXISTS. The announcements feed was already being ingested
 * daily and already had a taxonomy, but it was only ever consumed as a NUMBER:
 * the watchlist turned 3,200 filings into one narrative score per emiten and
 * the filings themselves were never shown. That is the wrong way round for the
 * one dataset in this app where the primary source is a document a human can
 * read. A score that says "BBCA has news" without letting you open the news is
 * asking to be trusted rather than checked.
 *
 * WHAT IT IS NOT. Not a news feed. IDX publishes what emiten file WITH THE
 * EXCHANGE — a government project or a media report appears here only if the
 * emiten itself reported it. The file's own `scope` note says so and is printed
 * on screen rather than paraphrased.
 *
 * THE DEFAULT HIDES ROUTINE FILINGS. Two thirds of any window is calendar
 * hygiene: monthly shareholder registers, corporate-secretary changes, proof of
 * newspaper advertisements. Showing them by default would bury the ten filings
 * that matter under three thousand that do not — but hiding them silently would
 * be worse, so the toggle always says how many are being hidden.
 */

interface Props {
  db: MarketDatabase;
  onSelectEmiten: (code: string) => void;
  /** Emiten to filter to on arrival, set when navigating in from another screen. */
  focusEmiten?: string | null;
  onFocusHandled?: () => void;
}

const TONE_PILL: Record<string, 'up' | 'warn' | 'neutral'> = {
  peluang: 'up',
  risiko: 'warn',
  netral: 'neutral',
};

/** Reading order: what changes a company first, paperwork last. */
const CATEGORY_ORDER: AnnouncementCategory[] = [
  'ekspansi',
  'struktur-modal',
  'dividen',
  'perhatian-bursa',
  'hukum',
  'utang',
  'rups',
  'keuangan',
  'rutin',
];

const PAGE = 60;

const dateLabel = (iso: string) => {
  const d = new Date(iso + 'T00:00:00');
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: '2-digit' });
};

const ageLabel = (days: number) => (days === 0 ? 'hari ini' : days === 1 ? 'kemarin' : `${days} hari lalu`);

export const AnnouncementFeed: React.FC<Props> = ({ db, onSelectEmiten, focusEmiten, onFocusHandled }) => {
  const [file, setFile] = useState<AnnouncementsFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<AnnouncementCategory | 'semua'>('semua');
  const [query, setQuery] = useState('');
  const [hideRoutine, setHideRoutine] = useState(true);
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    let alive = true;
    const url = `${import.meta.env.BASE_URL || '/'}data/idx/announcements.json`.replace(/\/{2,}/g, '/');
    void fetch(url, { cache: 'no-cache' })
      .then((r) => (r.ok ? (r.json() as Promise<AnnouncementsFile>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .catch(() => null)
      .then((f) => {
        if (!alive) return;
        setFile(f);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!focusEmiten) return;
    setQuery(focusEmiten);
    onFocusHandled?.();
  }, [focusEmiten, onFocusHandled]);

  // Reset the page window whenever the filters change, or "muat lebih banyak"
  // would silently carry a 600-row window into a three-row result.
  useEffect(() => {
    setLimit(PAGE);
  }, [category, query, hideRoutine]);

  const classified = useMemo<ClassifiedAnnouncement[]>(() => {
    if (!file) return [];
    const asOf = Date.parse(file.to + 'T00:00:00');
    return file.announcements
      .map((raw) => {
        const cat = classifyAnnouncement(raw.title);
        const meta = CATEGORY_META[cat];
        const t = Date.parse(raw.date + 'T00:00:00');
        const ageDays = Number.isFinite(t) && Number.isFinite(asOf) ? Math.max(0, Math.round((asOf - t) / 86400000)) : 0;
        return {
          ...raw,
          category: cat,
          meta,
          ageDays,
          weight: meta.materiality,
          pdfUrl: raw.url ? file.pdfBase + raw.url : '',
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date) || b.meta.materiality - a.meta.materiality);
  }, [file]);

  const counts = useMemo(() => {
    const m = new Map<AnnouncementCategory, number>();
    for (const a of classified) m.set(a.category, (m.get(a.category) ?? 0) + 1);
    return m;
  }, [classified]);

  /** Emiten with the loudest week, by the same signal the watchlist scores on. */
  const loudest = useMemo(() => {
    if (!file) return [];
    return [...buildNarrativeSignals(file, 7).values()]
      .filter((s) => s.top && s.score > 0.2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  }, [file]);

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    return classified.filter((a) => {
      if (category === 'semua' ? hideRoutine && a.category === 'rutin' : a.category !== category) return false;
      if (!q) return true;
      if (a.code.includes(q)) return true;
      if (a.title.toUpperCase().includes(q)) return true;
      const em = db.byCode.get(a.code);
      return !!em && (em.name.toUpperCase().includes(q) || em.sector.toUpperCase().includes(q));
    });
  }, [classified, category, hideRoutine, query, db]);

  const routineHidden = category === 'semua' && hideRoutine ? counts.get('rutin') ?? 0 : 0;

  if (loading) return <Spinner label="Memuat keterbukaan informasi IDX…" />;

  if (!file) {
    return (
      <EmptyState icon={ServerCrash} title="Data keterbukaan informasi belum dibangun" tone="error">
        <p>Feed pengajuan resmi emiten ke bursa belum pernah ditarik di lingkungan ini.</p>
        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950 p-3 text-left">
          <code className="text-[11px] text-blue-400">npm run data:announcements</code>
          <p className="mt-1 text-[10px] text-slate-500">Menarik 45 hari terakhir, sekitar 10 detik.</p>
        </div>
      </EmptyState>
    );
  }

  const material = classified.filter((a) => a.category !== 'rutin').length;

  return (
    <div className="space-y-4 sm:space-y-5">
      <Panel>
        <PanelHeader
          icon={Newspaper}
          title="Keterbukaan Informasi IDX"
          subtitle={`${file.from} → ${file.to} · ${file.count.toLocaleString('id-ID')} pengajuan dari ${file.emitenCount.toLocaleString('id-ID')} emiten`}
        />

        <StatGrid cols={4} className="mt-4">
          <Stat label="PENGAJUAN" value={file.count.toLocaleString('id-ID')} hint={`${file.emitenCount} emiten`} />
          <Stat label="DI LUAR RUTIN" value={material.toLocaleString('id-ID')} hint="yang mengubah isi perusahaan" tone="up" />
          <Stat
            label="PERHATIAN BURSA"
            value={(counts.get('perhatian-bursa') ?? 0).toLocaleString('id-ID')}
            hint="UMA & permintaan penjelasan"
            tone="warn"
          />
          <Stat
            label="JENDELA"
            value={`${Math.max(1, Math.round((Date.parse(file.to) - Date.parse(file.from)) / 86400000))} hari`}
            hint={`ditarik ${file.generatedAt.slice(0, 10)}`}
          />
        </StatGrid>

        <div className="mt-4">
          <SourceNote icon={FileText}>{file.scope}</SourceNote>
        </div>
      </Panel>

      {loudest.length > 0 && (
        <Panel>
          <PanelHeader
            icon={TrendingUp}
            title="Paling ramai sepekan"
            subtitle="Bobot materialitas × kebaruan, paruh waktu 7 hari — sinyal yang sama yang dipakai Watchlist. Klik untuk menyaring."
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {loudest.map((s) => {
              const em = db.byCode.get(s.code);
              const quote = db.daily.get(s.code);
              return (
                <button
                  key={s.code}
                  onClick={() => setQuery(s.code)}
                  title={s.headline}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-left transition-colors hover:border-amber-700 hover:bg-slate-900 touch-target"
                >
                  <span className="font-mono text-[11px] font-bold text-amber-400">{s.code}</span>
                  <span className="hidden max-w-[9rem] truncate text-[10px] text-slate-500 sm:inline">
                    {em?.name ?? ''}
                  </span>
                  {quote && Number.isFinite(quote.change) && (
                    <span
                      className={cx(
                        'font-mono text-[10px] tabular-nums',
                        quote.change > 0 ? 'text-emerald-400' : quote.change < 0 ? 'text-rose-400' : 'text-slate-500'
                      )}
                    >
                      {quote.change > 0 ? '+' : ''}
                      {quote.change.toFixed(2)}%
                    </span>
                  )}
                  {s.underExchangeAttention && <Pill tone="warn">UMA</Pill>}
                </button>
              );
            })}
          </div>
        </Panel>
      )}

      <Panel>
        <PanelHeader
          icon={Filter}
          title="Arsip pengajuan"
          subtitle="Kategori berasal dari judul pengajuan, aturan pertama yang cocok menang. Bobot kategori mengatakan “ini layak dibaca”, bukan “ini kabar baik”."
          actions={
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cari kode, nama, atau judul"
                aria-label="Cari pengajuan"
                className="w-full rounded-lg border border-slate-800 bg-slate-950 py-1.5 pl-8 pr-2 text-[11px] text-slate-200 placeholder:text-slate-600 focus:border-amber-600 focus:outline-none sm:w-64"
              />
            </div>
          }
        />

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setCategory('semua')}
            className={cx(
              'cursor-pointer rounded-md border px-2 py-1 text-[10px] font-bold transition-colors touch-target',
              category === 'semua'
                ? 'border-amber-600 bg-amber-500/15 text-amber-300'
                : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200'
            )}
          >
            SEMUA {classified.length.toLocaleString('id-ID')}
          </button>
          {CATEGORY_ORDER.filter((c) => counts.get(c)).map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              title={CATEGORY_META[c].hint}
              className={cx(
                'cursor-pointer rounded-md border px-2 py-1 text-[10px] font-bold transition-colors touch-target',
                category === c
                  ? 'border-amber-600 bg-amber-500/15 text-amber-300'
                  : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200'
              )}
            >
              {CATEGORY_META[c].label.toUpperCase()} {(counts.get(c) ?? 0).toLocaleString('id-ID')}
            </button>
          ))}
        </div>

        {category === 'semua' && (
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-[11px] text-slate-400">
            <input
              type="checkbox"
              checked={hideRoutine}
              onChange={(e) => setHideRoutine(e.target.checked)}
              className="h-3.5 w-3.5 cursor-pointer accent-amber-500"
            />
            Sembunyikan pengajuan rutin
            {routineHidden > 0 && (
              <span className="text-slate-500">
                — {routineHidden.toLocaleString('id-ID')} disembunyikan (laporan bulanan, bukti iklan, perubahan
                sekretaris perusahaan)
              </span>
            )}
          </label>
        )}

        <div className="mt-4 space-y-1.5">
          {filtered.length === 0 && (
            <EmptyState icon={Newspaper} title="Tidak ada pengajuan yang cocok">
              <p>Ubah kata kunci atau pilih kategori lain. Jendela data adalah {file.from} → {file.to}.</p>
            </EmptyState>
          )}

          {filtered.slice(0, limit).map((a, i) => {
            const em = db.byCode.get(a.code);
            return (
              <article
                key={`${a.code}-${a.date}-${i}`}
                className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-950 p-2.5 sm:flex-row sm:items-start sm:gap-3"
              >
                <div className="flex shrink-0 items-center gap-2 sm:w-32 sm:flex-col sm:items-start sm:gap-0.5">
                  <button
                    onClick={() => onSelectEmiten(a.code)}
                    title={em ? `${em.name} — buka profil` : 'Buka profil emiten'}
                    className="cursor-pointer font-mono text-[12px] font-bold text-amber-400 hover:text-amber-300"
                  >
                    {a.code}
                  </button>
                  <span className="font-mono text-[10px] tabular-nums text-slate-500">
                    {dateLabel(a.date)} · {ageLabel(a.ageDays)}
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-[12px] leading-snug text-slate-200">{a.title}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <Pill tone={TONE_PILL[a.meta.tone] ?? 'neutral'} title={a.meta.hint}>
                      {a.meta.label}
                    </Pill>
                    {em && <span className="truncate text-[10px] text-slate-500">{em.name} · {em.sector}</span>}
                  </div>
                </div>

                {a.pdfUrl ? (
                  <a
                    href={a.pdfUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex shrink-0 items-center gap-1 self-start rounded-md border border-slate-800 px-2 py-1 text-[10px] font-bold text-blue-400 transition-colors hover:border-blue-700 hover:text-blue-300 touch-target"
                  >
                    PDF <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <span className="shrink-0 self-start px-2 py-1 text-[10px] text-slate-600">tanpa lampiran</span>
                )}
              </article>
            );
          })}
        </div>

        {filtered.length > limit && (
          <button
            onClick={() => setLimit((l) => l + PAGE * 2)}
            className="mt-4 w-full cursor-pointer rounded-lg border border-slate-800 bg-slate-950 py-2 text-[11px] font-bold text-slate-300 transition-colors hover:border-amber-700 hover:text-amber-300 touch-target"
          >
            Muat {Math.min(PAGE * 2, filtered.length - limit).toLocaleString('id-ID')} lagi ·{' '}
            {(filtered.length - limit).toLocaleString('id-ID')} tersisa
          </button>
        )}

        <div className="mt-4">
          <SourceNote icon={FileText}>
            Sumber: {file.source}. Berkas PDF dilayani langsung oleh idx.co.id — aplikasi ini tidak menyimpan
            salinannya. Kategori dan bobot dihitung dari judul, bukan dari isi dokumen; bacalah lampirannya sebelum
            mengambil kesimpulan.
          </SourceNote>
        </div>
      </Panel>
    </div>
  );
};
