import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, ExternalLink, Globe, Info, Newspaper, ServerCrash } from 'lucide-react';
import { EmptyState, Panel, PanelHeader, Pill, Segmented, SourceNote, Spinner, Stat, StatGrid, cx } from '../common/ui';

/**
 * NEWS & KALENDER — what replaced Country Risk.
 *
 * WHY THE OLD SCREEN WENT. Country Risk scored Indonesia on conflict tone,
 * earthquakes and sanctions, and then told the reader in its own caption that
 * the score was probably meaningless. It was right, which is exactly the
 * problem: a panel whose own text says to ignore it is a tab nobody should
 * open. What a trader actually wants at 08:30 is what happened overnight and
 * what prints today.
 *
 * WHY BLOOMBERG IS NOT IN THE SOURCE LIST. Bloomberg retired its public RSS
 * years ago and licenses the terminal feed per seat; Financial Juice sells the
 * squawk that IS its product. Neither has a free endpoint, and scraping them is
 * both blocked and against their terms. Naming the wires actually read — WSJ,
 * CNBC, Yahoo Finance, Investing.com, CNBC Indonesia — is the honest version of
 * the same screen, and between them they carry most of what a Bloomberg
 * headline feed would.
 */

interface NewsItem {
  title: string;
  url: string;
  summary: string;
  publishedAt: string | null;
  source: string;
  sourceId: string;
  scope: 'global' | 'indonesia';
  emiten: string[];
}

interface CalendarItem {
  title: string;
  country: string;
  at: string;
  impact: 'tinggi' | 'sedang' | 'rendah' | 'libur';
  forecast: string;
  previous: string;
}

interface NewsFile {
  generatedAt: string;
  source: string;
  scope: string;
  feeds: { id: string; name: string; scope: string }[];
  failed: { id: string; name: string; why: string }[];
  count: number;
  items: NewsItem[];
  calendar: CalendarItem[];
}

interface Props {
  onSelectEmiten: (code: string) => void;
}

const IMPACT_TONE: Record<CalendarItem['impact'], string> = {
  tinggi: 'bg-rose-500',
  sedang: 'bg-amber-500',
  rendah: 'bg-slate-600',
  libur: 'bg-slate-700',
};

/** Currencies whose releases actually reach Jakarta, in the order they matter. */
const PRIORITY_COUNTRIES = ['USD', 'CNY', 'IDR', 'JPY', 'EUR'];

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return 'baru';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'baru saja';
  if (m < 60) return `${m} menit lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam lalu`;
  return `${Math.floor(h / 24)} hari lalu`;
}

const WIB = 'Asia/Jakarta';

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short', timeZone: WIB });

const clockLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: WIB });

const SCOPES = [
  { id: 'semua' as const, label: 'Semua berita', shortLabel: 'Semua' },
  { id: 'global' as const, label: 'Global', shortLabel: 'Global' },
  { id: 'indonesia' as const, label: 'Indonesia', shortLabel: 'Indonesia' },
  { id: 'emiten' as const, label: 'Menyebut emiten', shortLabel: 'Emiten' },
];

type ScopeId = (typeof SCOPES)[number]['id'];

export const NewsFeed: React.FC<Props> = ({ onSelectEmiten }) => {
  const [file, setFile] = useState<NewsFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<ScopeId>('semua');

  useEffect(() => {
    let alive = true;
    const url = `${import.meta.env.BASE_URL || '/'}data/idx/news.json`.replace(/\/{2,}/g, '/');
    void fetch(url, { cache: 'no-cache' })
      .then((r) => (r.ok ? (r.json() as Promise<NewsFile>) : Promise.reject(new Error(`HTTP ${r.status}`))))
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

  const items = useMemo(() => {
    if (!file) return [];
    if (scope === 'emiten') return file.items.filter((i) => i.emiten.length > 0);
    if (scope === 'semua') return file.items;
    return file.items.filter((i) => i.scope === scope);
  }, [file, scope]);

  /** Only what has not happened yet — a calendar of the past is a history book. */
  const upcoming = useMemo(() => {
    if (!file) return [];
    const now = Date.now();
    return file.calendar.filter((c) => Date.parse(c.at) >= now - 3600_000);
  }, [file]);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const c of upcoming) {
      const k = c.at.slice(0, 10);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(c);
    }
    return [...map.entries()].slice(0, 4);
  }, [upcoming]);

  if (loading) return <Spinner label="Menarik berita dan kalender ekonomi…" />;

  if (!file) {
    return (
      <EmptyState icon={ServerCrash} title="Berita belum ditarik" tone="error">
        <p>Layar ini membaca kantor berita publik dan kalender ekonomi, dan berkasnya belum pernah dibangun.</p>
        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950 p-3 text-left">
          <code className="text-[11px] text-blue-400">npm run data:news</code>
          <p className="mt-1 text-[10px] text-slate-500">5 kantor berita + kalender, sekitar 3 detik.</p>
        </div>
      </EmptyState>
    );
  }

  const highImpact = upcoming.filter((c) => c.impact === 'tinggi').length;
  const taggedCount = file.items.filter((i) => i.emiten.length).length;

  return (
    <div className="space-y-4 sm:space-y-5">
      <Panel>
        <PanelHeader
          icon={Newspaper}
          title="Berita & Kalender Ekonomi"
          tone="text-amber-400"
          subtitle={`${file.feeds.map((f) => f.name).join(' · ')}. Disegarkan ${timeAgo(file.generatedAt)} — umurnya menit, bukan detik, karena RSS terbit menurut jadwal penerbitnya.`}
        />
        <StatGrid cols={4} className="mt-4">
          <Stat label="Berita" value={String(file.count)} hint={`${file.feeds.length} kantor berita`} />
          <Stat label="Menyebut emiten" value={String(taggedCount)} tone="accent" hint="dicocokkan ke kode IDX" />
          <Stat label="Agenda minggu ini" value={String(upcoming.length)} hint="yang belum lewat" />
          <Stat label="Dampak tinggi" value={String(highImpact)} tone="warn" hint="rilis yang biasanya menggerakkan" />
        </StatGrid>

        {file.failed.length > 0 && (
          <div className="mt-4 flex gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3.5 py-3">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden="true" />
            <div className="text-[11px] leading-relaxed text-amber-200/90">
              {file.failed.length} kantor berita gagal ditarik kali ini: {file.failed.map((f) => f.name).join(', ')}.
              Sisanya tetap tampil.
            </div>
          </div>
        )}
      </Panel>

      {/* Economic calendar ------------------------------------------------ */}
      <Panel>
        <PanelHeader
          icon={CalendarClock}
          title="Kalender ekonomi"
          tone="text-rose-300"
          subtitle="Rilis yang belum terjadi, waktu WIB. Merah artinya rilis yang secara historis menggerakkan pasar — bukan ramalan arah, hanya penanda kapan volatilitas biasanya naik."
        />
        {byDay.length === 0 ? (
          <div className="mt-4">
            <EmptyState icon={CalendarClock} title="Tidak ada agenda tersisa minggu ini">
              Kalender ini memuat satu minggu berjalan; agenda minggu depan muncul setelah pergantian pekan.
            </EmptyState>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {byDay.map(([day, rows]) => (
              <div key={day}>
                <h4 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{dayLabel(rows[0].at)}</h4>
                <div className="mt-2 space-y-1">
                  {rows
                    .slice()
                    .sort((a, b) => {
                      const pa = PRIORITY_COUNTRIES.indexOf(a.country);
                      const pb = PRIORITY_COUNTRIES.indexOf(b.country);
                      return a.at.localeCompare(b.at) || (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb);
                    })
                    .map((c, i) => (
                      <div
                        key={`${day}-${i}`}
                        className={cx(
                          'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2',
                          c.impact === 'tinggi'
                            ? 'border-rose-900/50 bg-rose-950/15'
                            : 'border-slate-800 bg-slate-950'
                        )}
                      >
                        <span className={cx('h-2 w-2 shrink-0 rounded-full', IMPACT_TONE[c.impact])} aria-hidden="true" />
                        <span className="w-11 shrink-0 text-[11px] tabular-nums text-slate-400">
                          {clockLabel(c.at)}
                        </span>
                        <span className="w-9 shrink-0 text-[10px] font-bold text-slate-500">{c.country}</span>
                        <span className="min-w-0 flex-1 text-[11px] text-slate-200">{c.title}</span>
                        {(c.forecast || c.previous) && (
                          <span className="shrink-0 text-[10px] tabular-nums text-slate-500">
                            {c.forecast && <>perkiraan {c.forecast}</>}
                            {c.forecast && c.previous && ' · '}
                            {c.previous && <>sebelumnya {c.previous}</>}
                          </span>
                        )}
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* Wire ------------------------------------------------------------- */}
      <Panel>
        <PanelHeader
          icon={Globe}
          title={`${items.length} berita`}
          subtitle="Terbaru di atas. Kode emiten di bawah judul artinya berita itu menyebut perusahaannya secara eksplisit — klik untuk membuka detail emiten."
          actions={<Segmented options={SCOPES} value={scope} onChange={setScope} ariaLabel="Saring berita" size="sm" activeClass="bg-amber-600 text-white shadow-md shadow-amber-900/40" />}
        />

        {items.length === 0 ? (
          <div className="mt-4">
            <EmptyState icon={Newspaper} title="Tidak ada berita pada saringan ini">
              Ganti saringan di atas untuk melihat kantor berita lainnya.
            </EmptyState>
          </div>
        ) : (
          <div className="mt-3 divide-y divide-slate-800/70">
            {items.map((n, i) => (
              <article key={`${n.url}-${i}`} className="py-3">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-amber-400/80">{n.source}</span>
                  <span className="text-[10px] text-slate-600">{timeAgo(n.publishedAt)}</span>
                  {n.scope === 'indonesia' && <Pill tone="accent">domestik</Pill>}
                </div>

                {n.url ? (
                  <a
                    href={n.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 block text-[13px] font-semibold leading-snug text-slate-100 hover:text-amber-200"
                  >
                    {n.title}
                    <ExternalLink className="ml-1 inline h-3 w-3 align-baseline text-slate-600" aria-hidden="true" />
                  </a>
                ) : (
                  <p className="mt-1 text-[13px] font-semibold leading-snug text-slate-100">{n.title}</p>
                )}

                {n.summary && <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-500">{n.summary}</p>}

                {n.emiten.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {n.emiten.map((code) => (
                      <button
                        key={code}
                        type="button"
                        onClick={() => onSelectEmiten(code)}
                        className="cursor-pointer rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300 hover:border-emerald-400 hover:text-emerald-200 touch-target"
                      >
                        {code}
                      </button>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </Panel>

      <SourceNote icon={Info}>
        <strong className="text-slate-400">Sumber &amp; batas.</strong> {file.source} {file.scope} Penautan kode emiten
        sengaja dibuat ketat: kode hanya dihitung kalau ditulis huruf besar berdiri sendiri, dan nama perusahaan harus
        muncul utuh sebagai frasa. Itu melewatkan sebagian berita yang menyebut perusahaan dengan nama pendek, tetapi
        mencegah hal yang lebih buruk — ticker IDX banyak yang kebetulan kata biasa (PADA, NAIK, UANG, FAST), dan
        pencocokan longgar sempat menandai berita mode cepat Shein sebagai emiten FAST. Akronim huruf besar yang
        kebetulan sama dengan kode masih bisa lolos; CASA dalam istilah perbankan salah satunya.
      </SourceNote>
    </div>
  );
};
