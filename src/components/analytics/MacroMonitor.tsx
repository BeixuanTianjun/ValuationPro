import React, { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, Globe, ServerCrash, TrendingDown, TrendingUp } from 'lucide-react';
import { MarketDatabase } from '../../data/marketRepository';
import {
  Linkage,
  MacroClass,
  MacroFile,
  MacroInstrument,
  RECENT_WINDOW,
  WEAK_BELOW,
  buildMacroLinkage,
  findSurprises,
} from '../../models/macroLinkage';
import { EmptyState, Panel, PanelHeader, Pill, Segmented, SourceNote, Spinner, Stat, StatGrid, Td, Th, TableScroll, cx } from '../common/ui';

/**
 * MACRO — the world outside IDX, and how much of it actually reaches Jakarta.
 *
 * WHY THE TABLE LEADS WITH A NUMBER AND NOT A STORY. It would be easy to build
 * this screen as a wall of prices: coal up, rupiah down, S&P flat. That is a
 * second dashboard and it changes no decision. The question a trader actually
 * has is "does this thing move my stock", and the honest answer to that is a
 * correlation with a sample size next to it — including when the answer is no.
 *
 * The measured numbers here are weak, and the screen says so out loud rather
 * than dressing them up. On daily returns over this window nothing outside IDX
 * explains more than about 13% of a sector's variance, and the strongest links
 * are regional equity indices, not commodities. That is a real finding: a coal
 * miner's exposure to coal shows up in earnings and in quarterly moves, not in
 * whether the tape ticks together today.
 */

interface Props {
  db: MarketDatabase;
}

const CLASS_LABEL: Record<MacroClass, string> = {
  kurs: 'Kurs',
  energi: 'Energi',
  logam: 'Logam',
  'indeks-global': 'Indeks global',
  'suku-bunga': 'Bunga & takut',
  kripto: 'Kripto',
};

const CLASS_ORDER: MacroClass[] = ['kurs', 'energi', 'logam', 'indeks-global', 'suku-bunga', 'kripto'];

const pct = (v: number, d = 1) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%` : '–');
const num = (v: number, d = 2) => (Number.isFinite(v) ? v.toLocaleString('id-ID', { maximumFractionDigits: d }) : '–');

const tone = (v: number) => (!Number.isFinite(v) ? 'text-slate-500' : v > 0 ? 'text-emerald-400' : v < 0 ? 'text-rose-400' : 'text-slate-400');

/** How hard a correlation is allowed to look. */
function corrTone(r: number): string {
  const a = Math.abs(r);
  if (!Number.isFinite(r)) return 'text-slate-600';
  if (a >= 0.45) return 'font-bold text-amber-300';
  if (a >= WEAK_BELOW) return 'text-slate-200';
  return 'text-slate-500';
}

/** Plain words for a correlation, so nobody has to remember what 0.31 means. */
function corrWord(r: number): string {
  const a = Math.abs(r);
  if (!Number.isFinite(r)) return 'nggak keukur';
  if (a >= 0.6) return 'nempel banget';
  if (a >= 0.45) return 'lumayan nempel';
  if (a >= WEAK_BELOW) return 'ada tipis';
  return 'nggak nyambung';
}

export const MacroMonitor: React.FC<Props> = ({ db }) => {
  const [file, setFile] = useState<MacroFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<string>('IHSG');
  const [klass, setKlass] = useState<MacroClass | 'semua'>('semua');

  useEffect(() => {
    let alive = true;
    const url = `${import.meta.env.BASE_URL || '/'}data/idx/macro.json`.replace(/\/{2,}/g, '/');
    void fetch(url, { cache: 'no-cache' })
      .then((r) => (r.ok ? (r.json() as Promise<MacroFile>) : Promise.reject(new Error(`HTTP ${r.status}`))))
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

  const result = useMemo(() => (file ? buildMacroLinkage(file, db) : null), [file, db]);
  const byId = useMemo(
    () => new Map<string, MacroInstrument>((result?.instruments ?? []).map((i) => [i.id, i])),
    [result]
  );
  const surprises = useMemo(() => (result ? findSurprises(result) : []), [result]);

  const links: Linkage[] = useMemo(() => {
    if (!result) return [];
    const all = result.bySector.get(target) ?? [];
    return klass === 'semua' ? all : all.filter((l) => byId.get(l.instrumentId)?.klass === klass);
  }, [result, target, klass, byId]);

  if (loading) return <Spinner label="Narik harga dunia luar…" />;

  if (!file || !result) {
    return (
      <EmptyState icon={ServerCrash} title="Data makro belum ditarik" tone="error">
        <p>Layar ini butuh harga aset di luar IDX, dan berkasnya belum pernah dibangun di sini.</p>
        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950 p-3 text-left">
          <code className="text-[11px] text-blue-400">npm run data:macro</code>
          <p className="mt-1 text-[10px] text-slate-500">Narik 29 instrumen, sekitar 5 detik.</p>
        </div>
      </EmptyState>
    );
  }

  const targets = ['IHSG', ...[...result.bySector.keys()].filter((k) => k !== 'IHSG')];
  const strongest = links[0];

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* ---------------------------------------------------------------- */}
      <Panel>
        <PanelHeader
          icon={Globe}
          title="Dunia Luar"
          tone="text-cyan-400"
          subtitle={`${result.instruments.length} instrumen di luar IDX — kurs, komoditas, indeks global, bunga, kripto — disamain ke ${file.sessions} tanggal sesi bursa kita, biar korelasinya bisa dihitung beneran, bukan dikira-kira.`}
        />

        <StatGrid cols={4} className="mt-4">
          <Stat label="INSTRUMEN" value={String(result.instruments.length)} hint="6 kelas aset" />
          <Stat
            label="JENDELA"
            value={`${file.sessions} sesi`}
            hint={`${file.from} → ${file.to}`}
          />
          <Stat
            label="PALING NEMPEL KE IHSG"
            value={byId.get(result.bySector.get('IHSG')?.[0]?.instrumentId ?? '')?.name ?? '–'}
            hint={`r = ${num(result.bySector.get('IHSG')?.[0]?.correlation ?? NaN)}`}
            tone="accent"
          />
          <Stat label="YANG NGGAK ADA" value={String(file.absent.length)} hint="komoditas kunci tanpa data publik" tone="warn" />
        </StatGrid>

        <div className="mt-4 flex gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3.5 py-3">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden="true" />
          <div className="text-[11px] leading-relaxed text-amber-200/90">
            <strong>Angkanya kecil-kecil, dan itu emang jawabannya.</strong> Nggak ada satu pun barang di luar sana
            yang nerangin lebih dari ~13% gerakan harian satu sektor IDX. Yang paling nempel malah indeks Asia, bukan
            komoditas. Jadi kalau ada yang bilang "batu bara naik, pasti PTBA ikut hari ini" — di data harian, itu
            nggak kelihatan. Eksposur komoditas munculnya di laporan keuangan dan gerakan kuartalan, bukan di tick
            harian.
          </div>
        </div>
      </Panel>

      {/* ---------------------------------------------------------------- */}
      <Panel>
        <PanelHeader
          icon={Activity}
          title="Siapa yang gerak bareng siapa"
          tone="text-amber-400"
          subtitle={`Korelasi return harian. Barang yang pasarnya tutup belakangan dari Jakarta (Amerika, futures, kripto) dibandingin sama penutupan KEMARIN — soalnya harga New York hari ini baru ada setelah Jakarta pulang.`}
          actions={
            <Segmented
              options={CLASS_ORDER.map((c) => ({ id: c, label: CLASS_LABEL[c], shortLabel: CLASS_LABEL[c] }))
                .reduce(
                  (acc, o) => acc.concat(o),
                  [{ id: 'semua' as const, label: 'Semua kelas', shortLabel: 'Semua' }] as {
                    id: MacroClass | 'semua';
                    label: string;
                    shortLabel: string;
                  }[]
                )}
              value={klass}
              onChange={setKlass}
              ariaLabel="Saring kelas aset"
              size="sm"
              activeClass="bg-cyan-600 text-white shadow-md shadow-cyan-900/40"
            />
          }
        />

        <div className="mt-3 flex flex-wrap gap-1.5">
          {targets.map((t) => (
            <button
              key={t}
              onClick={() => setTarget(t)}
              className={cx(
                'cursor-pointer rounded-md border px-2 py-1 text-[10px] font-bold transition-colors touch-target',
                target === t
                  ? 'border-amber-600 bg-amber-500/15 text-amber-300'
                  : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200'
              )}
            >
              {t === 'IHSG' ? 'IHSG (semua)' : t}
            </button>
          ))}
        </div>

        {strongest && (
          <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
            Buat <span className="font-bold text-slate-200">{target}</span>, yang paling nempel{' '}
            <span className="font-bold text-amber-300">{byId.get(strongest.instrumentId)?.name}</span> —{' '}
            {corrWord(strongest.correlation)} (r = {num(strongest.correlation)}), dan cuma nerangin{' '}
            {(strongest.r2 * 100).toFixed(0)}% gerakannya. Sisanya urusan dalam negeri.
          </p>
        )}

        <TableScroll className="mt-3">
          <table className="w-full min-w-[720px] text-xs">
            <thead className="border-b border-slate-800">
              <tr>
                <Th align="left" sticky>
                  Instrumen
                </Th>
                <Th align="left">Kelas</Th>
                <Th>Harga</Th>
                <Th>1 Bln</Th>
                <Th title="Korelasi return harian sepanjang jendela">Korelasi</Th>
                <Th title={`Korelasi ${RECENT_WINDOW} sesi terakhir — buat lihat hubungan yang lagi menguat`}>{RECENT_WINDOW} sesi</Th>
                <Th title="Berapa persen gerakan target yang terlacak instrumen ini">R²</Th>
                <Th title="Gerakan target per 1% gerakan instrumen">Beta</Th>
                <Th align="left">Bacanya</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {links.map((l) => {
                const inst = byId.get(l.instrumentId);
                if (!inst) return null;
                const menguat =
                  Number.isFinite(l.correlationRecent) && Math.abs(l.correlationRecent) - Math.abs(l.correlation) > 0.12;
                return (
                  <tr key={l.instrumentId} className="hover:bg-slate-800/30">
                    <Td align="left" sticky>
                      <span className="font-bold text-slate-100">{inst.name}</span>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <span className="font-mono text-[10px] text-slate-600">{inst.symbol}</span>
                        {l.expected && <Pill tone="accent">dikira nyambung</Pill>}
                        {inst.after && <Pill tone="muted">lag 1</Pill>}
                      </div>
                    </Td>
                    <Td align="left" className="text-slate-400">
                      {CLASS_LABEL[inst.klass]}
                    </Td>
                    <Td className="text-slate-200">
                      {num(inst.last, 2)} <span className="text-[10px] text-slate-600">{inst.unit}</span>
                    </Td>
                    <Td className={tone(inst.change1m)}>{pct(inst.change1m)}</Td>
                    <Td className={corrTone(l.correlation)}>{num(l.correlation)}</Td>
                    <Td className={cx(corrTone(l.correlationRecent), menguat && 'text-amber-300')}>
                      {num(l.correlationRecent)}
                      {menguat && <span className="ml-1 text-[9px] font-bold">naik</span>}
                    </Td>
                    <Td className="text-slate-300">{(l.r2 * 100).toFixed(0)}%</Td>
                    <Td className="text-slate-300">{num(l.beta)}</Td>
                    <Td align="left" className="text-slate-400">
                      {corrWord(l.correlation)}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>

        {!links.length && (
          <p className="mt-3 text-xs text-slate-500">Nggak ada instrumen di kelas ini yang cukup datanya buat diukur.</p>
        )}

        <div className="mt-4">
          <SourceNote icon={Activity}>
            Semua angka di kolom korelasi dihitung dari return harian di {file.sessions} sesi yang sama, dan cuma
            dihitung kalau kedua sisi sama-sama dagang di hari itu — hari libur nggak dianggap "harga diam", tapi
            dibuang dari pasangannya. Minimal 60 sesi tumpang tindih, di bawah itu nggak ditampilin sama sekali.
            Korelasi itu gerak bareng, <strong>bukan sebab-akibat</strong>: Hang Seng dan IDX Energy bisa nempel karena
            Tiongkok beli batu bara, bisa juga karena dua-duanya aset berisiko yang ditinggal bareng.
          </SourceNote>
        </div>
      </Panel>

      {/* ---------------------------------------------------------------- */}
      {surprises.length > 0 && (
        <Panel>
          <PanelHeader
            icon={TrendingDown}
            title="Yang katanya nyambung, ternyata nggak"
            tone="text-rose-400"
            subtitle="Pasangan yang secara logika bisnis mestinya nempel, tapi di data nggak kebukti. Ini bagian paling berguna dari tabel di atas: cerita yang semua orang ulang, tapi nggak ngapa-ngapain."
          />
          <div className="mt-3 space-y-1.5">
            {surprises.slice(0, 8).map((s, i) => {
              const inst = byId.get(s.link.instrumentId);
              return (
                <div
                  key={`${s.link.target}-${s.link.instrumentId}-${i}`}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-2 text-[11px]"
                >
                  <Pill tone={s.kind === 'mati' ? 'down' : 'up'}>{s.kind === 'mati' ? 'nggak kebukti' : 'malah nempel'}</Pill>
                  <span className="font-bold text-slate-200">{s.link.target}</span>
                  <span className="text-slate-600">×</span>
                  <span className="text-slate-300">{inst?.name}</span>
                  <span className={cx('font-mono', corrTone(s.link.correlation))}>r = {num(s.link.correlation)}</span>
                  <span className="text-slate-500">{inst?.why}</span>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {/* ---------------------------------------------------------------- */}
      <Panel>
        <PanelHeader
          icon={TrendingUp}
          title="Harga terakhir, semua kelas"
          subtitle="Buat lihat cepat lagi pada di mana. Nilai di hari libur pasar asalnya dibawa dari penutupan terakhir."
        />
        <TableScroll className="mt-3">
          <table className="w-full min-w-[600px] text-xs">
            <thead className="border-b border-slate-800">
              <tr>
                <Th align="left" sticky>
                  Instrumen
                </Th>
                <Th align="left">Kelas</Th>
                <Th>Terakhir</Th>
                <Th>1 Hari</Th>
                <Th>1 Bulan</Th>
                <Th>3 Bulan</Th>
                <Th title="Sesi dengan harga sungguhan, bukan bawaan hari libur">Cakupan</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {CLASS_ORDER.flatMap((c) =>
                result.instruments
                  .filter((i) => i.klass === c)
                  .map((i) => (
                    <tr key={i.id} className="hover:bg-slate-800/30">
                      <Td align="left" sticky>
                        <span className="font-bold text-slate-100">{i.name}</span>
                        <div className="font-mono text-[10px] text-slate-600">{i.symbol}</div>
                      </Td>
                      <Td align="left" className="text-slate-400">
                        {CLASS_LABEL[i.klass]}
                      </Td>
                      <Td className="text-slate-200">
                        {num(i.last, 2)} <span className="text-[10px] text-slate-600">{i.unit}</span>
                      </Td>
                      <Td className={tone(i.change1d)}>{pct(i.change1d)}</Td>
                      <Td className={tone(i.change1m)}>{pct(i.change1m)}</Td>
                      <Td className={tone(i.change3m)}>{pct(i.change3m)}</Td>
                      <Td className={i.coverage < 0.6 ? 'text-amber-400' : 'text-slate-400'}>
                        {(i.coverage * 100).toFixed(0)}%
                      </Td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </TableScroll>
      </Panel>

      {/* ---------------------------------------------------------------- */}
      <Panel tone="accent">
        <PanelHeader
          icon={AlertTriangle}
          title="Yang nggak ada di sini — dan ini penting"
          tone="text-amber-400"
          subtitle="Dua komoditas paling penting buat bursa kita justru nggak punya data harian publik. Nggak saya gantiin pakai yang mirip-mirip, soalnya korelasi dari barang pengganti bakal kebaca sebagai bukti padahal bukan."
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
          <SourceNote icon={Globe}>
            Sumber: {file.source}. Ditarik {file.generatedAt.slice(0, 10)}.{' '}
            {file.failed.length > 0 && `${file.failed.length} simbol gagal ditarik dan nggak dipakai sama sekali.`}
          </SourceNote>
        </div>
      </Panel>
    </div>
  );
};
