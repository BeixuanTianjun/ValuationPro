import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Filter,
  Radar as RadarIcon,
  Search,
  ServerCrash,
  X,
} from 'lucide-react';
import { MarketDatabase } from '../../data/marketRepository';
import { loadIdxFile } from '../../data/idxFiles';
import { AnnouncementsFile } from '../../models/announcements';
import {
  DEFAULT_RADAR_SETTINGS,
  RADAR_CAVEAT,
  RadarFiling,
  RadarResult,
  RadarRow,
  RadarRule,
  TRIGGER_META,
  buildEventRadar,
} from '../../models/eventRadar';
import { EmptyState, Panel, PanelHeader, Pill, SourceNote, Spinner, Stat, StatGrid, cx } from '../common/ui';

/**
 * Radar Peristiwa — see src/models/eventRadar.ts for what this screen is,
 * what it is not, and why price tier is deliberately not colour-coded here.
 *
 * This file is UI only. Every number, gate and rejection reason below comes
 * straight out of `buildEventRadar`; nothing is recomputed here.
 */

interface Props {
  db: MarketDatabase;
  onSelectEmiten: (code: string) => void;
}

const rp = (v: number, d = 0) => (Number.isFinite(v) ? v.toLocaleString('id-ID', { maximumFractionDigits: d }) : '–');
const pct = (v: number, d = 1) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%` : '–');
const jt = (v: number) => (Number.isFinite(v) ? `Rp ${(v / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 0 })} jt/hari` : '–');

const dateLabel = (iso: string) => {
  const d = new Date(iso + 'T00:00:00');
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: '2-digit' });
};

const ageLabel = (days: number) => (days === 0 ? 'hari ini' : days === 1 ? 'kemarin' : `${days} hari lalu`);

const TRIGGER_PILL_TONE: Record<string, 'up' | 'warn' | 'accent' | 'neutral'> = {
  transaksi: 'up',
  kendali: 'warn',
  identitas: 'accent',
  'aksi-korporasi': 'neutral',
};

/** One pass/fail line from `row.rules` — the checkable list, not a score to trust. */
const RuleLine: React.FC<{ rule: RadarRule }> = ({ rule }) => (
  <div
    className={cx(
      'flex items-start gap-2 rounded-md border p-2.5',
      rule.pass ? 'border-emerald-800/60 bg-emerald-950/20' : 'border-rose-900/50 bg-rose-950/10'
    )}
  >
    <span
      className={cx(
        'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full',
        rule.pass ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
      )}
    >
      {rule.pass ? <Check className="h-2.5 w-2.5" aria-hidden="true" /> : <X className="h-2.5 w-2.5" aria-hidden="true" />}
    </span>
    <div className="min-w-0">
      <div className="text-[11px] font-bold text-slate-200">{rule.label}</div>
      <div className="text-[10px] text-slate-500">{rule.detail}</div>
    </div>
  </div>
);

const FilingLine: React.FC<{ filing: RadarFiling }> = ({ filing }) => (
  <div className="flex flex-col gap-1.5 rounded-md border border-slate-800 bg-slate-950 p-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[10px] tabular-nums text-slate-500">
          {dateLabel(filing.date)} · {ageLabel(filing.ageDays)}
        </span>
        <Pill tone={TRIGGER_PILL_TONE[filing.trigger] ?? 'neutral'} title={TRIGGER_META[filing.trigger].hint}>
          {TRIGGER_META[filing.trigger].label}
        </Pill>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-slate-300">{filing.title}</p>
    </div>
    {filing.pdfUrl ? (
      <a
        href={filing.pdfUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="flex shrink-0 items-center gap-1 self-start rounded-md border border-slate-800 px-2 py-1 text-[10px] font-bold text-blue-400 transition-colors hover:border-blue-700 hover:text-blue-300 touch-target"
      >
        PDF <ExternalLink className="h-3 w-3" />
      </a>
    ) : (
      <span className="shrink-0 self-start px-2 py-1 text-[10px] text-slate-600">tanpa lampiran</span>
    )}
  </div>
);

const RadarRowCard: React.FC<{
  row: RadarRow;
  open: boolean;
  onToggle: () => void;
  onSelectEmiten: (code: string) => void;
}> = ({ row, open, onToggle, onSelectEmiten }) => {
  return (
    <article className="rounded-lg border border-slate-800 bg-slate-950">
      <div className="flex flex-col gap-2.5 p-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onSelectEmiten(row.code)}
              className="cursor-pointer font-mono text-[13px] font-bold text-amber-400 hover:text-amber-300"
            >
              {row.code}
            </button>
            <span className="truncate text-[11px] text-slate-400">{row.name}</span>
            <Pill tone="muted" title="Sektor IDX">
              {row.sector}
            </Pill>
            {row.clustered && (
              <Pill
                tone="warn"
                title={`${row.triggers.length} jenis pemicu berbeda dalam ${row.clusterSpanDays} hari — bukan satu pengajuan berulang`}
              >
                cluster {row.clusterSpanDays}h
              </Pill>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {row.triggers.map((t) => (
              <Pill key={t} tone={TRIGGER_PILL_TONE[t] ?? 'neutral'} title={TRIGGER_META[t].hint}>
                {TRIGGER_META[t].label}
              </Pill>
            ))}
          </div>

          <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-slate-400 sm:flex sm:flex-wrap sm:gap-x-5">
            <span>
              Harga <span className="font-semibold text-slate-200">{rp(row.price)}</span>{' '}
              <span
                className="text-slate-600"
                title="Tier harga ditampilkan sebagai informasi, tidak menggerakkan urutan — beda hit-rate antar tier sebagian besar artefak ukuran tick, bukan alfa."
              >
                ({row.priceTier})
              </span>
            </span>
            <span>
              Turnover <span className="font-semibold text-slate-200">{jt(row.valuePerDay)}</span>
            </span>
            <span>
              Sudah gerak <span className="font-semibold text-slate-200">{pct(row.runup60)}</span>
            </span>
            <span>
              Volume <span className="font-semibold text-slate-200">{Number.isFinite(row.volRatio) ? `${row.volRatio.toFixed(2)}x` : '–'}</span>
            </span>
            <span>
              Sesi aktif <span className="font-semibold text-slate-200">{row.tradedSessions}/20</span>
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex shrink-0 cursor-pointer items-center gap-1.5 self-start rounded-md border border-slate-800 px-2.5 py-1.5 text-[10px] font-bold text-slate-300 hover:border-amber-700 hover:text-amber-300 touch-target"
        >
          Kenapa di sini
          {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
      </div>

      {open && (
        <div className="space-y-3 border-t border-slate-800 p-3">
          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Gerbang yang harus lolos semua
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {row.rules.map((r) => (
                <RuleLine key={r.label} rule={r} />
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Pengajuan yang memicu ({row.filings.length})
            </div>
            <div className="space-y-1.5">
              {row.filings.map((f, i) => (
                <FilingLine key={`${f.date}-${i}`} filing={f} />
              ))}
            </div>
          </div>
        </div>
      )}
    </article>
  );
};

export const EventRadar: React.FC<Props> = ({ db, onSelectEmiten }) => {
  const [file, setFile] = useState<AnnouncementsFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [openCode, setOpenCode] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void loadIdxFile<AnnouncementsFile>('announcements.json').then((f) => {
      if (!alive) return;
      setFile(f);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const result: RadarResult | null = useMemo(() => {
    if (!file) return null;
    return buildEventRadar(db, file, DEFAULT_RADAR_SETTINGS);
  }, [db, file]);

  const rows = useMemo(() => {
    if (!result) return [];
    const q = query.trim().toUpperCase();
    if (!q) return result.rows;
    return result.rows.filter(
      (r) => r.code.includes(q) || r.name.toUpperCase().includes(q) || r.sector.toUpperCase().includes(q)
    );
  }, [result, query]);

  if (loading) return <Spinner label="Memuat keterbukaan informasi IDX dan riwayat harga…" />;

  if (!file) {
    return (
      <EmptyState icon={ServerCrash} title="Data keterbukaan informasi belum dibangun" tone="error">
        <p>Radar peristiwa dibangun dari feed pengajuan resmi emiten ke bursa, dan feed itu belum pernah ditarik di lingkungan ini.</p>
        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950 p-3 text-left">
          <code className="text-[11px] text-blue-400">npm run data:announcements</code>
          <p className="mt-1 text-[10px] text-slate-500">Menarik 45 hari terakhir, sekitar 10 detik.</p>
        </div>
      </EmptyState>
    );
  }

  if (!result) return null;

  const rejectedTotal = result.rejected.reduce((s, r) => s + r.count, 0);

  return (
    <div className="space-y-4 sm:space-y-5">
      <Panel>
        <PanelHeader
          icon={RadarIcon}
          title="Radar Peristiwa"
          subtitle={
            result.windowFrom
              ? `Jendela ${dateLabel(result.windowFrom)} → ${dateLabel(result.asOf)} · ${result.triggeredEmiten.toLocaleString('id-ID')} emiten punya pengajuan yang memicu, ${result.rows.length.toLocaleString('id-ID')} lolos semua gerbang.`
              : 'Belum ada jendela pengumuman untuk dihitung.'
          }
        />

        {/* The caveat is the lede, not a footnote. */}
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-800/60 bg-amber-950/20 p-3.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
          <p className="text-[11px] leading-relaxed text-amber-200">{RADAR_CAVEAT}</p>
        </div>

        <StatGrid cols={4} className="mt-4">
          <Stat label="PUNYA PEMICU" value={result.triggeredEmiten.toLocaleString('id-ID')} hint="emiten dengan filing di jendela ini" />
          <Stat
            label="LOLOS SEMUA GERBANG"
            value={result.rows.length.toLocaleString('id-ID')}
            hint="tape masih tenang, masih bisa dijual, belum ditanya bursa"
            tone={result.rows.length > 0 ? 'accent' : 'neutral'}
          />
          <Stat label="TERSARING" value={rejectedTotal.toLocaleString('id-ID')} hint="gugur di salah satu gerbang" tone="warn" />
          <Stat label="JENDELA" value={`${DEFAULT_RADAR_SETTINGS.lookbackDays} hari`} hint={`per ${dateLabel(result.asOf)}`} />
        </StatGrid>

        {result.rejected.length > 0 && (
          <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950 p-3.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Kenapa yang lain tersaring
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {result.rejected.map((r) => (
                <div
                  key={r.reason}
                  className="rounded-md border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-[11px] text-slate-400"
                >
                  <span className="font-bold text-slate-200">{r.count.toLocaleString('id-ID')}</span> {r.reason}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4">
          <SourceNote icon={Filter}>
            Pemicu diklasifikasikan dari judul pengajuan IDX: transaksi material, perubahan kendali, perubahan
            identitas, dan aksi korporasi. Tier harga ditampilkan sebagai kolom informasi saja — ia tidak pernah
            menggerakkan urutan.
          </SourceNote>
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          icon={Filter}
          title={`${rows.length.toLocaleString('id-ID')} emiten di radar`}
          subtitle="Diurutkan menurut skor pengurutan — jumlah dan variasi jenis pemicu, bukan probabilitas kenaikan. Buka tiap baris untuk melihat gerbang dan pengajuan aslinya."
          actions={
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
              <label htmlFor="radar-search" className="sr-only">
                Cari kode, nama, atau sektor
              </label>
              <input
                id="radar-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cari kode, nama, atau sektor"
                className="w-full rounded-lg border border-slate-800 bg-slate-950 py-1.5 pl-8 pr-2 text-[11px] text-slate-200 placeholder:text-slate-600 focus:border-amber-600 focus:outline-none"
              />
            </div>
          }
        />

        <div className="mt-4 space-y-2">
          {rows.length === 0 && (
            <EmptyState icon={RadarIcon} title="Tidak ada emiten yang lolos semua gerbang hari ini">
              {result.triggeredEmiten > 0 ? (
                <p>
                  Ini keadaan normal, bukan error: pada {dateLabel(result.asOf)} ada {result.triggeredEmiten.toLocaleString('id-ID')}{' '}
                  emiten dengan pengajuan yang memicu, dan {rejectedTotal.toLocaleString('id-ID')} di antaranya gugur di
                  satu atau lebih gerbang — lihat rincian gerbang di atas. Radar ini sengaja menyaring keras; jendela
                  kosong lebih sering terjadi daripada jendela terisi.
                </p>
              ) : (
                <p>Tidak ada pengajuan yang memicu apa pun di jendela {result.windowFrom} → {result.asOf}.</p>
              )}
            </EmptyState>
          )}

          {rows.map((row) => (
            <RadarRowCard
              key={row.code}
              row={row}
              open={openCode === row.code}
              onToggle={() => setOpenCode(openCode === row.code ? null : row.code)}
              onSelectEmiten={onSelectEmiten}
            />
          ))}
        </div>
      </Panel>
    </div>
  );
};
