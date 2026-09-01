import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Anchor, Info, Ship, ServerCrash, Waves } from 'lucide-react';
import { MarketDatabase } from '../../data/marketRepository';
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
  cx,
} from '../common/ui';

/**
 * TANKER — freight economics, and an explicit account of what cannot be known.
 *
 * THE ASK WAS VESSEL TRACKING. Where BULL's ships are sailing, and what they
 * are earning. Neither is reachable: live positions need a paid AIS feed
 * (MarineTraffic, VesselFinder, Spire — all subscription, all forbidding
 * scraping), and per-voyage charter rates are commercially confidential, with
 * only broker-published aggregates behind paywalls. The Baltic Dirty Tanker
 * Index is not on any free quote API.
 *
 * WHAT IS MEASURABLE, AND WHY IT ANSWERS THE REAL QUESTION. A listed tanker
 * owner is a traded claim on charter rates: DHT is almost purely VLCCs, so its
 * equity IS the rate, repriced every day in public. Regressing the Indonesian
 * shipping issuers against that basket answers what the vessel-tracking
 * question was really after — when tanker economics improve, does BULL follow,
 * and by how much. That is a number with a sample size. "BULL's ship is near
 * Singapore" is not, from here.
 *
 * WHY THE CORRELATION IS SPLIT BY CARGO. IDX-IC files coal barges and oil
 * tankers under the same headings. A barge operator tracks coal haulage, not
 * crude freight, so pooling them would blur the exact relationship this screen
 * exists to measure. Each issuer carries what it actually hauls, and the table
 * reads the correlation against the proxy that matches.
 */

interface TankerInstrument {
  id: string;
  symbol: string;
  name: string;
  kind: 'crude' | 'produk' | 'campuran' | 'kontras';
  why: string;
  currency: string;
  last: number;
  asOf: string;
  change1d: number | null;
  change1w: number | null;
  change1m: number | null;
  change3m: number | null;
  change12m: number | null;
  dates: string;
  closes: string;
}

interface TankerFile {
  generatedAt: string;
  range: string;
  source: string;
  scope: string;
  absent: { name: string; why: string }[];
  failed: { id: string; symbol: string; why: string }[];
  instruments: TankerInstrument[];
  idxShipping: { code: string; cargo: string; note: string }[];
}

interface ChokePoint {
  id: string;
  name: string;
  indonesian: boolean;
  latestDate: string;
  tankersLatest: number;
  tankers7d: number;
  tankersPrior30d: number;
  tankerTrend: number;
  capacityTankerLatest: number;
}

interface WorldMapFile {
  generatedAt: string;
  chokepoints: ChokePoint[];
}

interface Props {
  db: MarketDatabase;
  onSelectEmiten: (code: string) => void;
}

const pct = (v: number | null | undefined, d = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? '–' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%`;
const num = (v: number, d = 2) => (Number.isFinite(v) ? v.toLocaleString('id-ID', { maximumFractionDigits: d }) : '–');
const tone = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v)
    ? 'text-slate-500'
    : v > 0
      ? 'text-emerald-400'
      : v < 0
        ? 'text-rose-400'
        : 'text-slate-400';

const KIND_LABEL: Record<TankerInstrument['kind'], string> = {
  crude: 'Tanker crude',
  produk: 'Tanker produk',
  campuran: 'Campuran',
  kontras: 'Pembanding (kering)',
};

/** Which proxy each cargo type should be measured against. */
const CARGO_PROXY: Record<string, string> = {
  minyak: 'dht',
  offshore: 'dht',
  'batu bara': 'bdry',
  'peti kemas': 'bdry',
};

const MIN_SAMPLE = 60;

/** Pearson correlation and slope of two aligned return series. */
function measure(a: number[], b: number[]): { r: number; beta: number; n: number } | null {
  let n = 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) continue;
    n++;
    sa += a[i];
    sb += b[i];
  }
  if (n < MIN_SAMPLE) return null;
  const ma = sa / n;
  const mb = sb / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) continue;
    cov += (a[i] - ma) * (b[i] - mb);
    va += (a[i] - ma) ** 2;
    vb += (b[i] - mb) ** 2;
  }
  if (va <= 0 || vb <= 0) return null;
  return { r: cov / Math.sqrt(va * vb), beta: cov / va, n };
}

function corrWord(r: number): string {
  const a = Math.abs(r);
  if (!Number.isFinite(r)) return 'nggak keukur';
  if (a >= 0.6) return 'nempel banget';
  if (a >= 0.45) return 'lumayan nempel';
  if (a >= 0.25) return 'ada tipis';
  return 'nggak nyambung';
}

export const TankerWatch: React.FC<Props> = ({ db, onSelectEmiten }) => {
  const [file, setFile] = useState<TankerFile | null>(null);
  const [map, setMap] = useState<WorldMapFile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const url = (n: string) => `${import.meta.env.BASE_URL || '/'}data/idx/${n}`.replace(/\/{2,}/g, '/');
    const get = <T,>(n: string): Promise<T | null> =>
      fetch(url(n), { cache: 'no-cache' })
        .then((r) => (r.ok ? (r.json() as Promise<T>) : Promise.reject(new Error(`HTTP ${r.status}`))))
        .catch(() => null);

    void Promise.all([get<TankerFile>('tanker.json'), get<WorldMapFile>('worldmap.json')]).then(([t, w]) => {
      if (!alive) return;
      setFile(t);
      setMap(w);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * Proxy closes projected onto the IDX session grid BY DATE.
   *
   * Never by index: the instruments trade on the NYSE calendar and IDX on its
   * own, so position i means a different day on each side. Matching on the date
   * string and carrying the last known value forward is what macroLinkage.ts
   * does, and for the same reason — an index join silently misaligns every
   * holiday and quietly corrupts the correlation.
   */
  const proxyReturns = useMemo(() => {
    if (!file) return new Map<string, number[]>();
    const out = new Map<string, number[]>();
    for (const inst of file.instruments) {
      const dates = inst.dates.split(',');
      const closes = inst.closes.split(',').map(Number);
      const byDate = new Map<string, number>();
      for (let i = 0; i < dates.length; i++) if (Number.isFinite(closes[i])) byDate.set(dates[i], closes[i]);

      const onGrid: number[] = [];
      let last = NaN;
      for (const d of db.dates) {
        const v = byDate.get(d);
        if (v !== undefined) last = v;
        onGrid.push(last);
      }
      const rets: number[] = [NaN];
      for (let i = 1; i < onGrid.length; i++) {
        const a = onGrid[i - 1];
        const b = onGrid[i];
        // Lag one: New York closes after Jakarta, so today's US print was not
        // knowable during today's IDX session.
        rets.push(a > 0 && b > 0 ? Math.log(b / a) : NaN);
      }
      out.set(inst.id, [NaN, ...rets.slice(0, -1)]);
    }
    return out;
  }, [file, db.dates]);

  const rows = useMemo(() => {
    if (!file) return [];
    return file.idxShipping
      .map((s) => {
        const emiten = db.byCode.get(s.code);
        const quote = db.daily.get(s.code);
        const series = db.series.get(s.code);
        if (!emiten || !series) return null;

        const rets: number[] = [NaN];
        for (let i = 1; i < series.close.length; i++) {
          const a = series.close[i - 1];
          const b = series.close[i];
          rets.push(a > 0 && b > 0 ? Math.log(b / a) : NaN);
        }

        const proxyId = CARGO_PROXY[s.cargo] ?? 'dht';
        const proxy = proxyReturns.get(proxyId);
        const m = proxy ? measure(proxy, rets) : null;
        const inst = file.instruments.find((i) => i.id === proxyId);

        return {
          ...s,
          name: emiten.name,
          close: quote?.close ?? NaN,
          change: quote && quote.prev > 0 ? quote.close / quote.prev - 1 : NaN,
          proxyName: inst?.name ?? '–',
          r: m?.r ?? NaN,
          beta: m?.beta ?? NaN,
          n: m?.n ?? 0,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => (Number.isFinite(b.r) ? Math.abs(b.r) : -1) - (Number.isFinite(a.r) ? Math.abs(a.r) : -1));
  }, [file, db, proxyReturns]);

  const indoChokepoints = useMemo(
    () => (map?.chokepoints ?? []).filter((c) => c.indonesian).sort((a, b) => b.tankersLatest - a.tankersLatest),
    [map]
  );

  if (loading) return <Spinner label="Menarik proksi tarif tanker…" />;

  if (!file) {
    return (
      <EmptyState icon={ServerCrash} title="Data tanker belum ditarik" tone="error">
        <p>Layar ini butuh harga pemilik tanker tercatat sebagai proksi tarif charter.</p>
        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950 p-3 text-left">
          <code className="text-[11px] text-blue-400">npm run data:tanker</code>
          <p className="mt-1 text-[10px] text-slate-500">6 instrumen, sekitar 3 detik.</p>
        </div>
      </EmptyState>
    );
  }

  const crude = file.instruments.filter((i) => i.kind === 'crude');
  const avg = (k: keyof TankerInstrument) => {
    const vals = crude.map((i) => i[k]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : NaN;
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      <Panel>
        <PanelHeader
          icon={Ship}
          title="Tanker — proksi tarif charter"
          tone="text-cyan-400"
          subtitle={`Pemilik tanker tercatat dipakai sebagai proksi tarif: DHT hampir seluruhnya VLCC, jadi harganya praktis adalah tarif yang dihargai ulang tiap hari di pasar terbuka. Data per ${file.instruments[0]?.asOf ?? '–'}.`}
        />
        <StatGrid cols={4} className="mt-4">
          <Stat label="Proksi crude 1 minggu" value={pct(avg('change1w'))} tone={avg('change1w') >= 0 ? 'up' : 'down'} hint="rata-rata FRO, DHT, TNK" />
          <Stat label="1 bulan" value={pct(avg('change1m'))} tone={avg('change1m') >= 0 ? 'up' : 'down'} />
          <Stat label="3 bulan" value={pct(avg('change3m'))} tone={avg('change3m') >= 0 ? 'up' : 'down'} />
          <Stat label="12 bulan" value={pct(avg('change12m'))} tone={avg('change12m') >= 0 ? 'up' : 'down'} />
        </StatGrid>

        <div className="mt-4 flex gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3.5 py-3">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden="true" />
          <div className="text-[11px] leading-relaxed text-amber-200/90">
            <strong>Ini proksi, bukan tarif charter sesungguhnya.</strong> Tarif per pelayaran itu rahasia dagang, dan
            indeks resminya (Baltic Dirty Tanker) berbayar. Yang naik-turun di sini adalah harga saham pemilik kapal —
            arahnya searah tarif, besarannya tidak sama.
          </div>
        </div>

        <TableScroll className="mt-4">
          <table className="w-full min-w-[720px] text-xs">
            <thead className="border-b border-slate-800">
              <tr>
                <Th align="left" sticky>
                  Instrumen
                </Th>
                <Th align="left">Jenis</Th>
                <Th>Harga</Th>
                <Th>1 Hari</Th>
                <Th>1 Mgg</Th>
                <Th>1 Bln</Th>
                <Th>3 Bln</Th>
                <Th align="left">Kenapa dipakai</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {file.instruments.map((i) => (
                <tr key={i.id} className="hover:bg-slate-800/30">
                  <Td align="left" sticky>
                    <span className="font-bold text-slate-100">{i.name}</span>
                    <div className="font-mono text-[10px] text-slate-600">{i.symbol}</div>
                  </Td>
                  <Td align="left" className="text-slate-400">
                    <Pill tone={i.kind === 'kontras' ? 'muted' : 'accent'}>{KIND_LABEL[i.kind]}</Pill>
                  </Td>
                  <Td className="text-slate-200">
                    {num(i.last)} <span className="text-[10px] text-slate-600">{i.currency}</span>
                  </Td>
                  <Td className={tone(i.change1d)}>{pct(i.change1d)}</Td>
                  <Td className={tone(i.change1w)}>{pct(i.change1w)}</Td>
                  <Td className={tone(i.change1m)}>{pct(i.change1m)}</Td>
                  <Td className={tone(i.change3m)}>{pct(i.change3m)}</Td>
                  <Td align="left" className="max-w-[300px] text-[10px] leading-relaxed text-slate-500">
                    {i.why}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </Panel>

      {/* IDX linkage ------------------------------------------------------ */}
      <Panel>
        <PanelHeader
          icon={Anchor}
          title="Emiten pelayaran IDX — seberapa nyata hubungannya"
          tone="text-emerald-400"
          subtitle="Korelasi return harian tiap emiten terhadap proksi yang sesuai muatannya: pengangkut minyak diukur ke tanker crude, tongkang batu bara ke freight kering. Kolom beta membaca: tiap 1% gerakan proksi, emiten ini bergerak berapa persen. Minimal 60 sesi tumpang tindih, di bawah itu tidak ditampilkan."
        />
        <TableScroll className="mt-3">
          <table className="w-full min-w-[760px] text-xs">
            <thead className="border-b border-slate-800">
              <tr>
                <Th align="left" sticky>
                  Emiten
                </Th>
                <Th align="left">Muatan</Th>
                <Th>Harga</Th>
                <Th>Ubah</Th>
                <Th align="left">Diukur ke</Th>
                <Th>Korelasi</Th>
                <Th>Beta</Th>
                <Th>n</Th>
                <Th align="left">Bacanya</Th>
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
                  <Td align="left">
                    <Pill tone={r.cargo === 'minyak' ? 'accent' : 'muted'}>{r.cargo}</Pill>
                  </Td>
                  <Td className="text-slate-100">{num(r.close, 0)}</Td>
                  <Td className={tone(r.change)}>{pct(r.change)}</Td>
                  <Td align="left" className="text-slate-400">
                    {r.proxyName}
                  </Td>
                  <Td className={cx(Math.abs(r.r) >= 0.45 ? 'font-bold text-amber-300' : 'text-slate-300')}>
                    {num(r.r)}
                  </Td>
                  <Td className="text-slate-300">{num(r.beta)}</Td>
                  <Td className="text-slate-500">{r.n || '–'}</Td>
                  <Td align="left" className="text-slate-400">
                    {corrWord(r.r)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
        <SourceNote icon={Info}>
          Korelasi itu gerak bareng, bukan sebab-akibat. Emiten pelayaran Indonesia banyak yang terikat kontrak jangka
          panjang, jadi tarif spot global yang naik belum tentu langsung terasa di pendapatannya — justru itu yang
          diukur di sini, dan angka kecil adalah jawaban yang sah.
        </SourceNote>
      </Panel>

      {/* Indonesian chokepoints ------------------------------------------- */}
      {indoChokepoints.length > 0 && (
        <Panel>
          <PanelHeader
            icon={Waves}
            title="Lalu lintas tanker di selat Indonesia"
            tone="text-blue-400"
            subtitle={`Jumlah tanker yang melintas per hari, dari IMF PortWatch. Malaka adalah jalur tanker tersibuk di dunia; setiap ton batu bara dan CPO ekspor kita lewat salah satu selat ini. Data per ${indoChokepoints[0].latestDate}.`}
          />
          <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {indoChokepoints.map((c) => (
              <div key={c.id} className="rounded-xl border border-slate-800 bg-slate-950 p-3.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-bold text-slate-100">{c.name}</span>
                  <span className={cx('text-[11px] font-bold tabular-nums', tone(c.tankerTrend))}>
                    {pct(c.tankerTrend)}
                  </span>
                </div>
                <div className="mt-1.5 text-xl font-extrabold tabular-nums text-white">{c.tankersLatest}</div>
                <div className="text-[10px] text-slate-500">
                  tanker hari itu · rata-rata 7 hari {c.tankers7d.toFixed(1)} · 30 hari sebelumnya{' '}
                  {c.tankersPrior30d.toFixed(1)}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* What is missing --------------------------------------------------- */}
      <Panel tone="accent">
        <PanelHeader
          icon={AlertTriangle}
          title="Yang tidak ada di sini — dan kenapa"
          tone="text-amber-400"
          subtitle="Permintaan awal layar ini adalah melacak posisi kapal tiap emiten dan tarif charternya. Keduanya tidak bisa diambil dari data gratis, dan menebak-nebak akan lebih berbahaya daripada tidak menampilkannya."
        />
        <div className="mt-3 space-y-2">
          {file.absent.map((a) => (
            <div key={a.name} className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2">
              <div className="text-[11px] font-bold text-amber-300">{a.name}</div>
              <div className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{a.why}</div>
            </div>
          ))}
        </div>
        <div className="mt-4">
          <SourceNote icon={Ship}>
            Kalau Anda punya langganan AIS (MarineTraffic, VesselFinder, atau kunci aisstream.io), pelacakan posisi
            kapal per emiten bisa ditambahkan — yang dibutuhkan cuma kunci API-nya. {file.source}
          </SourceNote>
        </div>
      </Panel>
    </div>
  );
};
