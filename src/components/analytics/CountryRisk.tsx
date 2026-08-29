/*
 * RISK — Indonesia stress components, and the news stream underneath them.
 *
 * This screen shows a composite score, which is the single most dangerous kind
 * of number this project publishes: one figure standing in for several feeds,
 * easy to quote and impossible to check unless the screen hands you the parts.
 * So the rules it follows are not stylistic.
 *
 *   - The scale is printed. 40.2 on this file's scale means "0.98 standard
 *     deviations below the window average", not "40 out of 100". Rendered bare
 *     it makes a different and false claim.
 *   - The method and the list of inputs that could NOT be fetched sit in the
 *     same panel as the number, not behind a tooltip. More inputs failed than
 *     succeeded, and that ratio is part of the reading.
 *   - Every component is shown raw beside the score, with the sample it came
 *     from, so a reader can throw the composite away and keep the inputs.
 *   - The composite is never recomputed here. The file computes it; a second
 *     derivation in React is a second thing to drift.
 *   - `note` and `method` are rendered verbatim from the JSON rather than
 *     rewritten in this file, so they cannot drift from the ingest script.
 *
 * And what it must never do: no correlation, beta or regression against IHSG or
 * any sector, no "impact on" phrasing, no sorting emiten by the score, no alert
 * firing on it, and no placement next to a price chart where mere adjacency
 * implies causation. No link from any of this to an Indonesian share price has
 * been measured. MACRO is allowed to show a weak relationship and call it weak;
 * RISK cannot even claim that much.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, ExternalLink, Info, Layers, Newspaper, ShieldAlert, Waves } from 'lucide-react';
import {
  EmptyState,
  Panel,
  PanelHeader,
  Pill,
  SourceNote,
  Spinner,
  Stat,
  StatGrid,
  TableScroll,
  Td,
  Th,
} from '../common/ui';

interface RiskComponent {
  id: string;
  label: string;
  source: string;
  latest: number | null;
  latestDate?: string;
  baselineMean?: number | null;
  windowDays?: number;
  n?: number;
  nIndependent?: number;
  rawDays?: number;
  total?: number;
  strongestMag?: number | null;
  totalListed?: number;
  z: number | null;
  note?: string;
}

interface RiskFile {
  generatedAt: string;
  country: string;
  timezone?: string;
  note: string;
  method: string;
  seismicWindowDays?: number;
  componentsUsed: number;
  componentsTotal: number;
  sourceConcentration?: Record<string, number>;
  dominantSource?: string | null;
  dominantSourceShare?: number | null;
  composite: number | null;
  components: RiskComponent[];
  unavailable: { id: string; reason: string }[];
}

interface GdeltDay {
  date: string;
  events: number;
  conflict: number;
  cooperation: number;
  avgTone: number | null;
  avgGoldstein: number | null;
  covered?: boolean;
}

interface GdeltEvent {
  id: string;
  date: string;
  actor1: string;
  actor1Country: string;
  actor2: string;
  actor2Country: string;
  root: string;
  quad: number | null;
  goldstein: number | null;
  tone: number | null;
  mentions: number | null;
  place: string;
  url: string;
}

interface GdeltFile {
  generatedAt: string;
  note: string;
  filter: string;
  timezone?: string;
  quadClasses: Record<string, string>;
  rootCodes: Record<string, string>;
  from: string | null;
  to: string | null;
  coveredDayCount?: number;
  uncoveredDayCount?: number;
  eventCount: number;
  days: GdeltDay[];
  events: GdeltEvent[];
}

const fetchJson = async <T,>(name: string): Promise<T | null> => {
  const url = `${import.meta.env.BASE_URL || '/'}data/idx/${name}`.replace(/\/{2,}/g, '/');
  return fetch(url, { cache: 'no-cache' })
    .then((r) => (r.ok ? (r.json() as Promise<T>) : Promise.reject(new Error(`HTTP ${r.status}`))))
    .catch(() => null);
};

const num = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined || !Number.isFinite(v) ? '–' : v.toFixed(d);

/*
 * The floor `ingest-risk.mjs` uses to decide a day is worth scoring. It is
 * repeated here for one reason: without it the newest row — today, still in
 * progress, five events in — renders a conflict share and a tone beside days
 * built from seven hundred, and the reader has no way to tell that the composite
 * above ignored the very row sitting at the top of the table.
 */
const SCORING_FLOOR = 30;

/** Higher z means more stress, so the warm colour is the alarming one. */
const zTone = (z: number | null): 'up' | 'down' | 'warn' | 'neutral' => {
  if (z === null) return 'neutral';
  if (z >= 1) return 'down';
  if (z >= 0.5) return 'warn';
  if (z <= -1) return 'up';
  return 'neutral';
};

export const CountryRisk: React.FC = () => {
  const [risk, setRisk] = useState<RiskFile | null>(null);
  const [gdelt, setGdelt] = useState<GdeltFile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void Promise.all([fetchJson<RiskFile>('risk.json'), fetchJson<GdeltFile>('gdelt.json')]).then(([r, g]) => {
      if (!alive) return;
      setRisk(r);
      setGdelt(g);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Only days the ingest actually pulled slices for. The rest are represented by
  // the 0-2% of events that arrive in later slices, and plotting them beside real
  // days draws a cliff at the edge of the ingest window that reads as a surge.
  const days = useMemo(() => (gdelt?.days ?? []).filter((d) => d.covered !== false), [gdelt]);

  const topEvents = useMemo(
    () =>
      [...(gdelt?.events ?? [])]
        .sort((a, b) => b.date.localeCompare(a.date) || (b.mentions ?? 0) - (a.mentions ?? 0))
        .slice(0, 40),
    [gdelt]
  );

  if (loading) return <Spinner label="Memuat lapisan risiko…" />;

  if (!risk) {
    return (
      <EmptyState icon={ShieldAlert} title="Berkas risiko belum dibangun" tone="warn">
        <p>
          Jalankan <code className="text-slate-300">npm run data:gdelt</code> lalu{' '}
          <code className="text-slate-300">npm run data:risk</code> untuk membangunnya.
        </p>
      </EmptyState>
    );
  }

  const scored = risk.components.filter((c) => c.z !== null);
  const excluded = risk.components.filter((c) => c.z === null);
  const dominantPct = risk.dominantSourceShare === null || risk.dominantSourceShare === undefined
    ? null
    : Math.round(risk.dominantSourceShare * 100);

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* ---------------------------------------------------------- composite */}
      <Panel>
        <PanelHeader
          icon={ShieldAlert}
          title="Bacaan tekanan Indonesia"
          subtitle="Komponen dari sumber publik bernama. Skornya boleh dibuang; komponennya yang dipakai."
          actions={
            <Pill tone="muted">
              dibangun {risk.generatedAt.slice(0, 10)}
            </Pill>
          }
        />

        <StatGrid cols={4} className="mt-4">
          <Stat
            label="Komposit"
            value={risk.composite === null ? '–' : risk.composite.toFixed(1)}
            /* The scale, on the tile itself. Without it this is read as /100. */
            hint="50 = rata-rata jendela · tiap 10 poin = 1 simpangan baku"
            tone={risk.composite !== null && risk.composite >= 60 ? 'down' : 'neutral'}
            icon={Activity}
          />
          <Stat
            label="Komponen terpakai"
            value={`${risk.componentsUsed} / ${risk.componentsTotal}`}
            hint={`${risk.unavailable.length} input lain gagal ditarik`}
            icon={Layers}
          />
          <Stat
            label="Bertumpu satu sumber"
            value={dominantPct === null ? '–' : `${dominantPct}%`}
            hint={risk.dominantSource ? risk.dominantSource.split(' via ')[0] : 'tidak diketahui'}
            tone={dominantPct !== null && dominantPct >= 60 ? 'warn' : 'neutral'}
          />
          <Stat
            label="Input gagal"
            value={risk.unavailable.length}
            hint="lebih banyak yang gagal daripada yang berhasil"
            tone="warn"
            icon={AlertTriangle}
          />
        </StatGrid>

        {/* Method and note verbatim from the file, so they cannot drift from the
            script that produced the number. */}
        <div className="mt-4 space-y-2.5">
          <SourceNote icon={Info}>
            <span className="font-semibold text-slate-400">Cara hitungnya. </span>
            {risk.method}
          </SourceNote>
          <SourceNote icon={AlertTriangle}>
            <span className="font-semibold text-amber-300/80">Baca ini dulu. </span>
            {risk.note}
          </SourceNote>
          {risk.timezone && <SourceNote>{risk.timezone}</SourceNote>}
        </div>
      </Panel>

      {/* --------------------------------------------------------- components */}
      <Panel>
        <PanelHeader
          icon={Layers}
          title="Komponen mentah"
          subtitle="Tiap baris punya sumber, tanggal bacaannya, dan ukuran sampel yang menghasilkan z-nya."
        />
        <TableScroll className="mt-3">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800">
                <Th align="left" sticky>
                  Komponen
                </Th>
                <Th>Terakhir</Th>
                <Th align="left">Tanggal</Th>
                <Th>Baseline</Th>
                <Th title="Ukuran sampel yang menghasilkan z">n</Th>
                <Th>z</Th>
                <Th align="left">Sumber</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {scored.map((c) => (
                <tr key={c.id} className="hover:bg-slate-800/40">
                  <Td align="left" sticky className="font-semibold text-slate-200">
                    {c.label}
                  </Td>
                  <Td className="text-slate-300">{num(c.latest, c.id.includes('share') ? 4 : 2)}</Td>
                  <Td align="left" className="text-slate-500">
                    {c.latestDate ?? '–'}
                  </Td>
                  <Td className="text-slate-400">{num(c.baselineMean, c.id.includes('share') ? 4 : 2)}</Td>
                  <Td className="text-slate-400">
                    {c.n ?? '–'}
                    {c.nIndependent !== undefined && (
                      <span className="ml-1 text-[10px] text-slate-600">(~{c.nIndependent} bebas)</span>
                    )}
                  </Td>
                  <Td>
                    <Pill tone={zTone(c.z)}>{c.z === null ? '–' : c.z.toFixed(2)}</Pill>
                  </Td>
                  <Td align="left" className="text-[10px] text-slate-500">
                    {c.source}
                  </Td>
                </tr>
              ))}
              {/* Present but excluded — never silently dropped, or "3 of 4" has
                  no visible fourth. */}
              {excluded.map((c) => (
                <tr key={c.id} className="bg-slate-950/40">
                  <Td align="left" sticky className="font-semibold text-slate-400">
                    {c.label}
                  </Td>
                  <Td className="text-slate-400">{num(c.latest, 0)}</Td>
                  <Td align="left" className="text-slate-600">
                    {c.latestDate ?? '–'}
                  </Td>
                  <Td className="text-slate-600">–</Td>
                  <Td className="text-slate-600">{c.n ?? '–'}</Td>
                  <Td>
                    <Pill tone="muted">di luar komposit</Pill>
                  </Td>
                  <Td align="left" className="text-[10px] text-slate-600">
                    {c.note ?? c.source}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </Panel>

      {/* -------------------------------------------------------- unavailable */}
      <Panel>
        <PanelHeader
          icon={AlertTriangle}
          title={`${risk.unavailable.length} input tidak bisa ditarik`}
          subtitle="Ditulis apa adanya, bukan ditambal dengan pengganti. Korelasi dari barang pengganti terbaca sebagai bukti padahal bukan."
          tone="text-amber-400"
        />
        <ul className="mt-3 space-y-2">
          {risk.unavailable.map((u) => (
            <li key={u.id} className="flex flex-col gap-1 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 sm:flex-row sm:items-baseline sm:gap-3">
              <span className="shrink-0 font-mono text-[11px] font-bold text-slate-400">{u.id}</span>
              <span className="min-w-0 text-[11px] leading-relaxed text-slate-500">{u.reason}</span>
            </li>
          ))}
        </ul>
      </Panel>

      {/* -------------------------------------------------------------- gdelt */}
      {gdelt ? (
        <>
          <Panel>
            <PanelHeader
              icon={Newspaper}
              title="Aliran peristiwa GDELT"
              subtitle={`${gdelt.eventCount.toLocaleString('id-ID')} peristiwa, ${gdelt.from ?? '–'} sampai ${gdelt.to ?? '–'}`}
              actions={
                <>
                  <Pill tone="muted">{gdelt.coveredDayCount ?? days.length} hari terliput</Pill>
                  {(gdelt.uncoveredDayCount ?? 0) > 0 && (
                    <Pill tone="warn">{gdelt.uncoveredDayCount} hari disembunyikan</Pill>
                  )}
                </>
              }
            />

            <TableScroll className="mt-3">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-800">
                    <Th align="left" sticky>
                      Tanggal
                    </Th>
                    <Th>Peristiwa</Th>
                    <Th>Konflik</Th>
                    <Th>Kerja sama</Th>
                    <Th>Pangsa konflik</Th>
                    <Th>Nada</Th>
                    <Th>Goldstein</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {days
                    .slice()
                    .reverse()
                    .map((d) => {
                      const denom = d.conflict + d.cooperation;
                      return (
                        <tr key={d.date} className="hover:bg-slate-800/40">
                          <Td align="left" sticky className="font-semibold text-slate-300">
                            {d.date}
                            {d.events < SCORING_FLOOR && (
                              <span className="ml-2 align-middle">
                                <Pill tone="muted">belum penuh</Pill>
                              </span>
                            )}
                          </Td>
                          <Td className={d.events < SCORING_FLOOR ? 'text-slate-500' : 'text-slate-300'}>{d.events}</Td>
                          <Td className="text-rose-300">{d.conflict}</Td>
                          <Td className="text-emerald-300">{d.cooperation}</Td>
                          {/* No clamped denominator: a day with nothing classified
                              says so rather than reading as perfectly calm. */}
                          <Td className={d.events < SCORING_FLOOR ? 'text-slate-600' : 'text-slate-300'}>
                            {denom > 0 ? `${((d.conflict / denom) * 100).toFixed(1)}%` : '–'}
                          </Td>
                          <Td
                            className={
                              d.events < SCORING_FLOOR
                                ? 'text-slate-600'
                                : d.avgTone !== null && d.avgTone < 0
                                  ? 'text-amber-300'
                                  : 'text-slate-400'
                            }
                          >
                            {num(d.avgTone)}
                          </Td>
                          <Td className={d.events < SCORING_FLOOR ? 'text-slate-600' : 'text-slate-400'}>
                            {num(d.avgGoldstein)}
                          </Td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </TableScroll>

            <div className="mt-3 space-y-2.5">
              <SourceNote icon={Info}>
                <span className="font-semibold text-slate-400">Yang disaring: </span>
                <code className="text-slate-400">{gdelt.filter}</code>. Baris di sini{' '}
                <span className="font-semibold text-slate-400">menyentuh</span> Indonesia — lewat aktor atau lewat
                lokasi kejadian — dan belum tentu <span className="font-semibold text-slate-400">tentang</span>{' '}
                Indonesia. Peristiwa beraktor asing di perairan kita ikut masuk.
              </SourceNote>
              <SourceNote icon={Info}>
                Hari bertanda <span className="font-semibold text-slate-400">belum penuh</span> punya di bawah{' '}
                {SCORING_FLOOR} peristiwa — biasanya hari ini yang masih berjalan. Pangsa dan nadanya diredupkan
                karena komposit di atas juga tidak memakainya: empat peristiwa bisa terbaca 100% konflik dan tidak
                berarti apa-apa.
              </SourceNote>
              <SourceNote icon={AlertTriangle}>{gdelt.note}</SourceNote>
              {gdelt.timezone && <SourceNote>{gdelt.timezone}</SourceNote>}
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              icon={Waves}
              title="Peristiwa terbaru"
              subtitle="Tiap baris tertaut ke artikel aslinya. Baris tanpa tautan tidak ditampilkan."
            />
            <TableScroll className="mt-3">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-800">
                    <Th align="left" sticky>
                      Tanggal
                    </Th>
                    <Th align="left">Jenis</Th>
                    <Th align="left">Pelaku</Th>
                    <Th align="left">Tempat</Th>
                    <Th>Goldstein</Th>
                    <Th align="left">Sumber</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {topEvents
                    /* The ingest guarantees a URL on every row and the backtest
                       fails the build without one — but a row that somehow lost
                       its source is dropped rather than shown uncitable. */
                    .filter((e) => e.url)
                    .map((e) => (
                      <tr key={e.id} className="hover:bg-slate-800/40">
                        <Td align="left" sticky className="text-slate-400">
                          {e.date}
                        </Td>
                        <Td align="left">
                          <Pill tone={e.quad === 3 || e.quad === 4 ? 'down' : 'up'}>
                            {gdelt.rootCodes[e.root] ?? e.root}
                          </Pill>
                        </Td>
                        <Td align="left" className="max-w-[200px] truncate text-slate-300">
                          {[e.actor1, e.actor2].filter(Boolean).join(' → ') || '–'}
                        </Td>
                        <Td align="left" className="max-w-[200px] truncate text-slate-500">
                          {e.place || '–'}
                        </Td>
                        <Td className={e.goldstein !== null && e.goldstein < 0 ? 'text-rose-300' : 'text-slate-400'}>
                          {num(e.goldstein, 1)}
                        </Td>
                        <Td align="left">
                          <a
                            href={e.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-cyan-300 hover:text-cyan-200"
                          >
                            <span className="max-w-[190px] truncate">{new URL(e.url).hostname.replace(/^www\./, '')}</span>
                            <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                          </a>
                        </Td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </TableScroll>
          </Panel>
        </>
      ) : (
        <EmptyState icon={Newspaper} title="Aliran GDELT belum dibangun" tone="warn">
          <p>
            Jalankan <code className="text-slate-300">npm run data:gdelt</code>. Tanpa itu dua dari tiga komponen
            komposit di atas hilang, dan skornya jatuh ke satu sumber saja.
          </p>
        </EmptyState>
      )}
    </div>
  );
};
