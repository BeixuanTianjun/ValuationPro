import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Anchor, Globe2, Ship, ServerCrash } from 'lucide-react';
import { EmptyState, Panel, PanelHeader, Pill, SourceNote, Spinner, Stat, StatGrid, Td, Th, TableScroll, cx } from '../common/ui';

/**
 * MAP — the world's shipping chokepoints, drawn on a globe you can spin.
 *
 * WHY A GLOBE AND NOT A FLAT MAP. The five Indonesian straits are spread across
 * a quarter of the planet's circumference and sit at the hinge between the
 * Indian and Pacific oceans. On a Mercator rectangle that geography is torn in
 * half at the edges; on a sphere it reads as what it is — everything leaving
 * Indonesia squeezes through a handful of gaps.
 *
 * WHY IT IS SVG AND NOT WEBGL. This app has exactly one third-party runtime
 * dependency, the TradingView widget, and that restraint is deliberate. An
 * orthographic projection is about fifteen lines of trigonometry, so a 3D
 * library would buy rotation and lighting at the cost of several hundred
 * kilobytes and a whole new class of failure. The coastline arrives as plain
 * coordinate rings because the TopoJSON was already decoded at ingest.
 *
 * WHAT THE DOTS ARE. Chokepoint dots are sized by tanker transits per day, not
 * by total vessels: this is an exchange whose exports are coal, CPO and crude,
 * and a container ship passing Malacca says nothing about any of them. Alert
 * dots are IMF PortWatch disruption events, which are NATURAL HAZARDS AND PORT
 * CLOSURES — not armed conflict. The panel says so rather than letting the word
 * "alert" imply geopolitics it cannot support.
 */

interface Chokepoint {
  id: string;
  name: string;
  fullname: string;
  lat: number;
  lon: number;
  indonesian: boolean;
  latestDate: string;
  tankersLatest: number;
  totalLatest: number;
  tankers7d: number;
  tankersPrior30d: number;
  tankerTrend: number | null;
  capacityTankerLatest: number;
  series: string;
}

interface DisruptionEvent {
  id: number;
  type: string;
  typeLabel: string;
  name: string;
  alert: string;
  country: string;
  from: string | null;
  to: string | null;
  severity: string | null;
  affectedPorts: number;
  lat: number;
  lon: number;
}

interface WorldMapFile {
  generatedAt: string;
  windowDays: number;
  from: string | null;
  to: string | null;
  source: string;
  scope: string;
  limits: string[];
  dates: string[];
  chokepoints: Chokepoint[];
  events: DisruptionEvent[];
  land: [number, number][][];
}

const R = 150;
const SIZE = R * 2 + 40;
const CX = SIZE / 2;
const CY = SIZE / 2;

const rad = (d: number) => (d * Math.PI) / 180;

/**
 * Orthographic projection: the view of a sphere from infinitely far away.
 *
 * Returns null when the point is on the far side, which is the whole reason
 * this is a globe rather than a picture of one — half the world is genuinely
 * hidden and has to be rotated into view.
 */
function project(lon: number, lat: number, rotLon: number, rotLat: number): { x: number; y: number } | null {
  const l = rad(lon - rotLon);
  const p = rad(lat);
  const p0 = rad(rotLat);
  const cosc = Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(l);
  if (cosc <= 0) return null;
  return {
    x: CX + R * Math.cos(p) * Math.sin(l),
    y: CY - R * (Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(l)),
  };
}

/** A ring becomes one or more paths, broken wherever it crosses the horizon. */
function ringPath(ring: [number, number][], rotLon: number, rotLat: number): string {
  let d = '';
  let pen = false;
  for (const [lon, lat] of ring) {
    const p = project(lon, lat, rotLon, rotLat);
    if (!p) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    pen = true;
  }
  return d;
}

const ALERT_TONE: Record<string, string> = {
  RED: 'fill-rose-500',
  ORANGE: 'fill-amber-500',
  GREEN: 'fill-emerald-500',
};

const num = (v: number, d = 0) => (Number.isFinite(v) ? v.toLocaleString('id-ID', { maximumFractionDigits: d }) : '–');
const pct = (v: number | null, d = 0) =>
  v === null || !Number.isFinite(v) ? '–' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%`;

export const WorldMap: React.FC = () => {
  const [file, setFile] = useState<WorldMapFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [rot, setRot] = useState({ lon: -115, lat: -8 }); // start over Indonesia
  const [picked, setPicked] = useState<string | null>('chokepoint2');
  const drag = useRef<{ x: number; y: number; lon: number; lat: number } | null>(null);

  useEffect(() => {
    let alive = true;
    const url = `${import.meta.env.BASE_URL || '/'}data/idx/worldmap.json`.replace(/\/{2,}/g, '/');
    void fetch(url, { cache: 'no-cache' })
      .then((r) => (r.ok ? (r.json() as Promise<WorldMapFile>) : Promise.reject(new Error(`HTTP ${r.status}`))))
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

  const onDown = useCallback(
    (e: React.PointerEvent) => {
      drag.current = { x: e.clientX, y: e.clientY, lon: rot.lon, lat: rot.lat };
      (e.target as Element).setPointerCapture?.(e.pointerId);
    },
    [rot]
  );

  const onMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setRot({
      lon: d.lon + (e.clientX - d.x) * 0.45,
      // Clamped so the globe cannot be flipped past the poles, where the
      // projection stays valid but the mental model does not.
      lat: Math.max(-80, Math.min(80, d.lat - (e.clientY - d.y) * 0.45)),
    });
  }, []);

  const onUp = useCallback(() => {
    drag.current = null;
  }, []);

  const graticule = useMemo(() => {
    const paths: string[] = [];
    for (let lon = -180; lon < 180; lon += 30) {
      const ring: [number, number][] = [];
      for (let lat = -90; lat <= 90; lat += 4) ring.push([lon, lat]);
      paths.push(ringPath(ring, rot.lon, rot.lat));
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      const ring: [number, number][] = [];
      for (let lon = -180; lon <= 180; lon += 4) ring.push([lon, lat]);
      paths.push(ringPath(ring, rot.lon, rot.lat));
    }
    return paths.filter(Boolean);
  }, [rot]);

  const landPaths = useMemo(
    () => (file ? file.land.map((ring) => ringPath(ring, rot.lon, rot.lat)).filter(Boolean) : []),
    [file, rot]
  );

  const selected = useMemo(
    () => file?.chokepoints.find((c) => c.id === picked) ?? null,
    [file, picked]
  );

  const recentEvents = useMemo(() => (file ? file.events.slice(0, 40) : []), [file]);

  if (loading) return <Spinner label="Narik lalu lintas kapal dan garis pantai…" />;

  if (!file) {
    return (
      <EmptyState icon={ServerCrash} title="Data peta belum ditarik" tone="error">
        <p>Layar ini butuh data lalu lintas selat dan garis pantai, dan berkasnya belum pernah dibangun di sini.</p>
        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950 p-3 text-left">
          <code className="text-[11px] text-blue-400">npm run data:worldmap</code>
          <p className="mt-1 text-[10px] text-slate-500">28 selat, kejadian disrupsi, dan garis pantai. Sekitar 15 detik.</p>
        </div>
      </EmptyState>
    );
  }

  const idn = file.chokepoints.filter((c) => c.indonesian);
  const idnTankers = idn.reduce((n, c) => n + c.tankers7d, 0);
  const allTankers = file.chokepoints.reduce((n, c) => n + c.tankers7d, 0);
  const maxTanker = Math.max(...file.chokepoints.map((c) => c.tankers7d), 1);
  const redAlerts = file.events.filter((e) => e.alert === 'RED').length;

  return (
    <div className="space-y-4 sm:space-y-5">
      <Panel>
        <PanelHeader
          icon={Globe2}
          title="Peta Selat Dunia"
          tone="text-cyan-400"
          subtitle={`Berapa kapal tanker lewat 28 selat kunci dunia tiap hari, plus kejadian yang bikin pelabuhan tutup. Lima selat di antaranya perairan kita — dan Malaka itu jalur tanker tersibuk sedunia.`}
        />
        <StatGrid cols={4} className="mt-4">
          <Stat label="SELAT DIPANTAU" value="28" hint={`5 di perairan Indonesia`} />
          <Stat
            label="TANKER LEWAT INDONESIA"
            value={`${num(idnTankers)}/hari`}
            hint={`${((idnTankers / allTankers) * 100).toFixed(0)}% dari total dunia`}
            tone="accent"
          />
          <Stat label="ALERT MERAH" value={String(redAlerts)} hint="sejak 2024" tone="warn" />
          <Stat label="DATA SAMPAI" value={file.to ?? '–'} hint={`jendela ${file.windowDays} hari`} />
        </StatGrid>
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[auto,1fr] sm:gap-5">
        {/* ------------------------------------------------------------ globe */}
        <Panel className="flex flex-col items-center">
          <svg
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            className="w-full max-w-[340px] cursor-grab touch-none select-none active:cursor-grabbing"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            role="img"
            aria-label="Globe lalu lintas kapal, bisa diputar"
          >
            <circle cx={CX} cy={CY} r={R} className="fill-slate-950 stroke-slate-800" strokeWidth={1} />
            {graticule.map((d, i) => (
              <path key={`g${i}`} d={d} className="stroke-slate-800/70" fill="none" strokeWidth={0.5} />
            ))}
            {landPaths.map((d, i) => (
              <path key={`l${i}`} d={d} className="fill-slate-800/60 stroke-slate-600" strokeWidth={0.5} />
            ))}

            {file.events.slice(0, 60).map((e) => {
              const p = project(e.lon, e.lat, rot.lon, rot.lat);
              if (!p) return null;
              return (
                <circle
                  key={`e${e.id}`}
                  cx={p.x}
                  cy={p.y}
                  r={3}
                  className={cx(ALERT_TONE[e.alert] || 'fill-slate-500', 'opacity-70')}
                >
                  <title>{`${e.typeLabel} — ${e.name} (${e.country})`}</title>
                </circle>
              );
            })}

            {file.chokepoints.map((c) => {
              const p = project(c.lon, c.lat, rot.lon, rot.lat);
              if (!p) return null;
              const r = 2.5 + (c.tankers7d / maxTanker) * 7;
              return (
                <g key={c.id} onClick={() => setPicked(c.id)} className="cursor-pointer">
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={r}
                    className={cx(
                      c.indonesian ? 'fill-amber-400/80 stroke-amber-300' : 'fill-cyan-500/60 stroke-cyan-400',
                      picked === c.id && 'stroke-white'
                    )}
                    strokeWidth={picked === c.id ? 1.5 : 0.6}
                  >
                    <title>{`${c.name} — ${num(c.tankers7d, 1)} tanker/hari`}</title>
                  </circle>
                </g>
              );
            })}
          </svg>

          <p className="mt-3 text-center text-[10px] leading-relaxed text-slate-500">
            Seret buat muter. Bulatan besar = makin banyak tanker lewat.{' '}
            <span className="text-amber-400">Kuning</span> itu selat kita,{' '}
            <span className="text-rose-400">merah</span> alert bencana.
          </p>
        </Panel>

        {/* --------------------------------------------------------- selected */}
        <Panel>
          <PanelHeader
            icon={Ship}
            title={selected ? selected.fullname : 'Pilih selat'}
            tone="text-amber-400"
            subtitle={
              selected
                ? `Rata-rata 7 hari terakhir dibanding 30 hari sebelumnya. Sehari doang itu noise — akhir pekan dan cuaca bisa gerakin separuhnya.`
                : 'Klik salah satu bulatan di globe.'
            }
          />
          {selected && (
            <StatGrid cols={3} className="mt-4">
              <Stat
                label="TANKER / HARI"
                value={num(selected.tankers7d, 1)}
                hint={`sebelumnya ${num(selected.tankersPrior30d, 1)}`}
                tone="accent"
              />
              <Stat
                label="ARAHNYA"
                value={pct(selected.tankerTrend)}
                hint="7 hari vs 30 hari"
                tone={selected.tankerTrend !== null && selected.tankerTrend < -0.15 ? 'down' : 'neutral'}
              />
              <Stat label="SEMUA KAPAL" value={num(selected.totalLatest)} hint={`per ${selected.latestDate}`} />
            </StatGrid>
          )}

          <TableScroll className="mt-4">
            <table className="w-full min-w-[520px] text-xs">
              <thead className="border-b border-slate-800">
                <tr>
                  <Th align="left" sticky>
                    Selat
                  </Th>
                  <Th>Tanker/hari</Th>
                  <Th>30 hari lalu</Th>
                  <Th>Arah</Th>
                  <Th>Semua kapal</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {file.chokepoints.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => setPicked(c.id)}
                    className={cx('cursor-pointer hover:bg-slate-800/30', picked === c.id && 'bg-slate-800/40')}
                  >
                    <Td align="left" sticky>
                      <span className={cx('font-bold', c.indonesian ? 'text-amber-300' : 'text-slate-100')}>
                        {c.name}
                      </span>
                      {c.indonesian && (
                        <Pill tone="warn" className="ml-1.5">
                          kita
                        </Pill>
                      )}
                    </Td>
                    <Td className="font-semibold text-slate-100">{num(c.tankers7d, 1)}</Td>
                    <Td className="text-slate-400">{num(c.tankersPrior30d, 1)}</Td>
                    <Td
                      className={cx(
                        c.tankerTrend === null
                          ? 'text-slate-600'
                          : c.tankerTrend > 0.1
                            ? 'text-emerald-400'
                            : c.tankerTrend < -0.1
                              ? 'text-rose-400'
                              : 'text-slate-400'
                      )}
                    >
                      {pct(c.tankerTrend)}
                    </Td>
                    <Td className="text-slate-300">{num(c.totalLatest)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Panel>
      </div>

      {/* ------------------------------------------------------------ alerts */}
      <Panel>
        <PanelHeader
          icon={AlertTriangle}
          title="Alert yang ganggu perdagangan"
          tone="text-rose-400"
          subtitle="Kejadian yang bikin pelabuhan tutup atau kapal muter jalan. Kolom pelabuhan itu jumlah pelabuhan yang kena, dihitung IMF, bukan tebakan."
        />
        <TableScroll className="mt-3">
          <table className="w-full min-w-[640px] text-xs">
            <thead className="border-b border-slate-800">
              <tr>
                <Th align="left" sticky>
                  Kejadian
                </Th>
                <Th align="left">Jenis</Th>
                <Th align="left">Negara</Th>
                <Th>Mulai</Th>
                <Th>Pelabuhan kena</Th>
                <Th align="left">Level</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {recentEvents.map((e) => (
                <tr key={e.id} className="hover:bg-slate-800/30">
                  <Td align="left" sticky>
                    <span className="font-bold text-slate-100">{e.name}</span>
                    {e.severity && <div className="text-[10px] text-slate-500">{e.severity}</div>}
                  </Td>
                  <Td align="left" className="text-slate-300">
                    {e.typeLabel}
                  </Td>
                  <Td align="left" className="max-w-[180px] truncate text-slate-400">
                    {e.country}
                  </Td>
                  <Td className="text-slate-400">{e.from ?? '–'}</Td>
                  <Td className={e.affectedPorts > 0 ? 'font-bold text-amber-300' : 'text-slate-500'}>
                    {e.affectedPorts}
                  </Td>
                  <Td align="left">
                    <Pill tone={e.alert === 'RED' ? 'down' : e.alert === 'ORANGE' ? 'warn' : 'neutral'}>{e.alert}</Pill>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </Panel>

      <Panel tone="accent">
        <PanelHeader
          icon={Anchor}
          title="Yang perlu lo tau soal data ini"
          tone="text-amber-400"
          subtitle="Biar nggak salah baca."
        />
        <div className="mt-3 space-y-2">
          {file.limits.map((l, i) => (
            <div key={i} className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-[11px] leading-relaxed text-slate-300">
              {l}
            </div>
          ))}
        </div>
        <div className="mt-4">
          <SourceNote icon={Globe2}>
            Sumber: {file.source}. Ditarik {file.generatedAt.slice(0, 10)}. {file.scope}
          </SourceNote>
        </div>
      </Panel>
    </div>
  );
};
