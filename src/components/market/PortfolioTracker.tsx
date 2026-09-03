import React, { useEffect, useMemo, useRef, useState } from 'react';
import { loadIdxFile } from '../../data/idxFiles';
import {
  AlertTriangle,
  Briefcase,
  Check,
  Download,
  Info,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { MarketDatabase } from '../../data/marketRepository';
import { FactorSnapshot } from '../../types/market';
import { runStockScreener } from '../../models/stockScreener';
import { OwnershipFile, computeOwnershipProfile } from '../../models/ownershipFlow';
import {
  Position,
  PositionReading,
  SHARES_PER_LOT,
  buildPortfolio,
  fetchPositions,
  newPositionId,
  savePositions,
} from '../../models/portfolio';
import {
  EmptyState,
  Panel,
  PanelHeader,
  Pill,
  SourceNote,
  Stat,
  StatGrid,
  TableScroll,
  Td,
  Th,
  cx,
} from '../common/ui';

/**
 * PORTFOLIO — your positions, priced live, read against the same rules the
 * rest of the terminal applies to every other stock.
 *
 * THE QUESTION THIS SCREEN WAS ASKED TO ANSWER was "should I dump this or
 * not". It deliberately does not answer that, and the refusal is the design,
 * not a gap. Whether to sell depends on your horizon, your tax position, what
 * else you hold and why you bought — none of which this app knows. What it CAN
 * do, and what nothing else on your screen does, is put the mechanical facts
 * next to your own entry price and name the rule behind each one:
 *
 *   - has the price fallen through the ATR stop measured FROM YOUR ENTRY
 *   - does it still pass the screener's three hard rules today
 *   - what RSI and distance-to-MA say about where it sits
 *   - whether KSEI institutions added or cut over three months
 *
 * Every one of those is checkable. Stacked together they make the decision
 * obvious far more often than a verdict would, and when they disagree, that
 * disagreement is itself the useful information — which a single "SELL" badge
 * would have hidden.
 *
 * WHY THE STOP IS MEASURED FROM YOUR ENTRY AND NOT FROM TODAY'S CLOSE. A stop
 * drawn from the current price answers "where would a new buy today be cut".
 * A holder is asking something else: "has the trade I actually took broken".
 * Those give different numbers and only the second one is about your position.
 */

interface Props {
  db: MarketDatabase;
  factors: Map<string, FactorSnapshot> | null;
  onSelectEmiten: (code: string) => void;
}

const rp = (v: number, d = 0) => (Number.isFinite(v) ? v.toLocaleString('id-ID', { maximumFractionDigits: d }) : '–');
const pct = (v: number, d = 1) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%` : '–');
const money = (v: number) => {
  if (!Number.isFinite(v)) return '–';
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (a >= 1e9) return `${sign}Rp ${(a / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M`;
  if (a >= 1e6) return `${sign}Rp ${(a / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`;
  return `${sign}Rp ${a.toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;
};
const tone = (v: number) => (!Number.isFinite(v) ? 'text-slate-500' : v > 0 ? 'text-emerald-400' : v < 0 ? 'text-rose-400' : 'text-slate-400');

export const PortfolioTracker: React.FC<Props> = ({ db, factors, onSelectEmiten }) => {
  const [positions, setPositions] = useState<Position[]>([]);
  const [ownership, setOwnership] = useState<OwnershipFile | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [store, setStore] = useState<'layanan' | 'browser' | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // draft row
  const [code, setCode] = useState('');
  const [lots, setLots] = useState('');
  const [avg, setAvg] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchPositions().then(({ positions: p, source }) => {
      if (!alive) return;
      setPositions(p);
      setStore(source);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void loadIdxFile<OwnershipFile>('ownership.json').then((f) => alive && setOwnership(f));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [pickerOpen]);

  const persist = (next: Position[]) => {
    setPositions(next);
    void savePositions(next).then((ok) => setSaveFailed(!ok));
  };

  const screenerRows = useMemo(() => runStockScreener(db).all, [db]);

  const instDelta = useMemo(() => {
    const m = new Map<string, number>();
    if (!ownership) return m;
    for (const p of positions) {
      const prof = computeOwnershipProfile(ownership, p.code);
      if (prof) m.set(p.code, prof.institusiChange3m * 100);
    }
    return m;
  }, [ownership, positions]);

  const summary = useMemo(
    () => buildPortfolio(positions, db, factors, screenerRows, instDelta),
    [positions, db, factors, screenerRows, instDelta]
  );

  const matches = useMemo(() => {
    const q = code.trim().toUpperCase();
    if (!q) return [];
    return db.emiten.filter((e) => e.code.includes(q) || e.name.toUpperCase().includes(q)).slice(0, 30);
  }, [db, code]);

  const draftValid =
    db.byCode.has(code.trim().toUpperCase()) && Number(lots) > 0 && Number(avg) > 0;

  const addPosition = () => {
    if (!draftValid) return;
    persist([
      ...positions,
      {
        id: newPositionId(),
        code: code.trim().toUpperCase(),
        lots: Number(lots),
        avgPrice: Number(avg),
        boughtOn: new Date().toISOString().slice(0, 10),
      },
    ]);
    setCode('');
    setLots('');
    setAvg('');
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(positions, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `portofolio-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = (f: File) => {
    void f.text().then((t) => {
      try {
        const parsed = JSON.parse(t) as Position[];
        // Routed through persist() so an imported file lands in the service
        // too, not only in this browser — otherwise importing would look like
        // it worked and then vanish with the next fresh profile.
        if (Array.isArray(parsed)) persist(parsed);
      } catch {
        /* a malformed file leaves the current portfolio untouched */
      }
    });
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      <Panel>
        <PanelHeader
          icon={Briefcase}
          title="Portofolio"
          tone="text-violet-300"
          subtitle={
            store === 'browser'
              ? 'Posisi Anda, dihargai dengan harga sesi berjalan. Layanan lokal tidak menjawab, jadi ini tersimpan di browser ini saja dan ikut terhapus kalau data situs dibersihkan — jalankan "npm run auto" supaya tersimpan permanen di .data/portfolio.json.'
              : 'Posisi Anda, dihargai dengan harga sesi berjalan. Tersimpan di .data/portfolio.json oleh layanan lokal, jadi tetap ada di sesi berikutnya. Salinan cadangan disimpan di browser ini juga.'
          }
          actions={
            <>
              <button
                type="button"
                onClick={exportJson}
                disabled={!positions.length}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-[11px] font-bold text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 touch-target"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                Ekspor
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-[11px] font-bold text-slate-300 hover:bg-slate-800 touch-target"
              >
                <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                Impor
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importJson(f);
                  e.target.value = '';
                }}
              />
            </>
          }
        />

        {saveFailed && (
          <div className="mt-4 flex gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-3">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" aria-hidden="true" />
            <div className="text-[11px] leading-relaxed text-rose-200/90">
              Browser menolak menyimpan. Biasanya karena jendela penyamaran atau penyimpanan situs dimatikan — posisi di
              layar tetap terhitung, tapi akan hilang saat halaman dimuat ulang. Ekspor kalau mau menyimpannya.
            </div>
          </div>
        )}

        {positions.length > 0 && (
          <StatGrid cols={4} className="mt-4">
            <Stat label="Nilai sekarang" value={money(summary.valueIdr)} hint={`modal ${money(summary.costIdr)}`} />
            <Stat
              label="Untung / rugi"
              value={money(summary.gainIdr)}
              tone={summary.gainIdr >= 0 ? 'up' : 'down'}
              hint={pct(summary.gainPercent)}
            />
            <Stat
              label="Di bawah stop entry"
              value={`${summary.belowStopCount} dari ${positions.length}`}
              tone={summary.belowStopCount > 0 ? 'warn' : 'neutral'}
              hint="harga < stop ATR dari harga beli Anda"
            />
            <Stat
              label="Posisi terbesar"
              value={summary.topWeightCode ? `${summary.topWeightCode} ${(summary.topWeight * 100).toFixed(0)}%` : '–'}
              tone={summary.topWeight > 0.4 ? 'warn' : 'neutral'}
              hint="konsentrasi di satu nama"
            />
          </StatGrid>
        )}

        {/* Add form ------------------------------------------------------ */}
        <div className="mt-4 grid gap-2.5 rounded-xl border border-slate-800 bg-slate-950 p-3.5 sm:grid-cols-[1.6fr_1fr_1fr_auto]">
          <div ref={pickerRef} className="relative">
            <label htmlFor="pf-code" className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Emiten
            </label>
            <Search className="pointer-events-none absolute left-3 top-[30px] w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
            <input
              id="pf-code"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setPickerOpen(true);
              }}
              onFocus={() => setPickerOpen(true)}
              placeholder="Cari kode atau nama…"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-xs uppercase text-slate-200 placeholder:normal-case placeholder:text-slate-600 focus:border-violet-600 touch-target"
            />
            {pickerOpen && matches.length > 0 && (
              <ul className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto scrollbar-thin rounded-lg border border-slate-700 bg-slate-900 shadow-2xl">
                {matches.map((e) => (
                  <li key={e.code}>
                    <button
                      type="button"
                      onClick={() => {
                        setCode(e.code);
                        setPickerOpen(false);
                        const q = db.daily.get(e.code);
                        if (q && q.close > 0 && !avg) setAvg(String(q.close));
                      }}
                      className="flex w-full items-baseline gap-2 px-3 py-2 text-left hover:bg-slate-800 touch-target"
                    >
                      <span className="w-12 shrink-0 text-xs font-bold text-violet-300">{e.code}</span>
                      <span className="truncate text-[11px] text-slate-400">{e.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <label htmlFor="pf-lots" className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Jumlah lot
            </label>
            <input
              id="pf-lots"
              type="number"
              min="0"
              step="1"
              value={lots}
              onChange={(e) => setLots(e.target.value)}
              placeholder="10"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-violet-200 focus:border-violet-600 touch-target"
            />
          </div>

          <div>
            <label htmlFor="pf-avg" className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Harga beli rata-rata
            </label>
            <input
              id="pf-avg"
              type="number"
              min="0"
              step="1"
              value={avg}
              onChange={(e) => setAvg(e.target.value)}
              placeholder="4250"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-violet-200 focus:border-violet-600 touch-target"
            />
          </div>

          <div className="flex items-end">
            <button
              type="button"
              onClick={addPosition}
              disabled={!draftValid}
              className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-[11px] font-bold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500 touch-target"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              Tambah
            </button>
          </div>
        </div>
        {code.trim() && !db.byCode.has(code.trim().toUpperCase()) && (
          <p className="mt-2 text-[11px] text-amber-300">{code.trim().toUpperCase()} tidak ada di 962 emiten tercatat.</p>
        )}
        <p className="mt-2 text-[10px] text-slate-500">
          1 lot = {SHARES_PER_LOT} lembar. Harga beli diisi per lembar, sama seperti yang tertera di aplikasi sekuritas.
        </p>
      </Panel>

      {/* Holdings -------------------------------------------------------- */}
      {positions.length === 0 ? (
        <EmptyState icon={Briefcase} title="Belum ada posisi">
          Tambahkan emiten, jumlah lot, dan harga beli rata-rata Anda di atas. Setelah itu tiap posisi dibaca dengan
          aturan mekanis yang sama dengan yang dipakai screener — termasuk apakah harganya sudah jatuh di bawah stop
          ATR yang diukur dari harga beli Anda sendiri.
        </EmptyState>
      ) : (
        <Panel>
          <PanelHeader
            icon={Briefcase}
            title={`${positions.length} posisi`}
            subtitle="Klik satu baris untuk membuka pembacaan mekanisnya. Kolom bobot menunjukkan porsi tiap posisi terhadap nilai portofolio."
          />
          <TableScroll className="mt-3">
            <table className="w-full min-w-[860px] text-xs">
              <thead className="border-b border-slate-800">
                <tr>
                  <Th align="left" sticky>
                    Emiten
                  </Th>
                  <Th>Lot</Th>
                  <Th>Harga beli</Th>
                  <Th>Harga kini</Th>
                  <Th>Ubah hari ini</Th>
                  <Th>Nilai</Th>
                  <Th>Untung / rugi</Th>
                  <Th>Bobot</Th>
                  <Th align="center">Status</Th>
                  <Th align="center">Hapus</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {summary.positions.map((r) => (
                  <React.Fragment key={r.position.id}>
                    <tr
                      className="cursor-pointer hover:bg-slate-800/30"
                      onClick={() => setExpanded(expanded === r.position.id ? null : r.position.id)}
                    >
                      <Td align="left" sticky>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectEmiten(r.position.code);
                          }}
                          className="cursor-pointer font-bold text-violet-300 hover:text-violet-200"
                        >
                          {r.position.code}
                        </button>
                        <div className="max-w-[170px] truncate text-[10px] text-slate-500">{r.name}</div>
                      </Td>
                      <Td className="text-slate-300">{rp(r.position.lots)}</Td>
                      <Td className="text-slate-300">{rp(r.position.avgPrice)}</Td>
                      <Td className="font-semibold text-slate-100">{rp(r.price)}</Td>
                      <Td className={tone(r.changePercent)}>{pct(r.changePercent)}</Td>
                      <Td className="text-slate-200">{money(r.valueIdr)}</Td>
                      <Td className={cx('font-bold', tone(r.gainIdr))}>
                        {money(r.gainIdr)}
                        <div className="text-[10px] font-normal">{pct(r.gainPercent)}</div>
                      </Td>
                      <Td className="text-slate-400">{(r.weight * 100).toFixed(1)}%</Td>
                      <Td align="center">
                        <div className="flex flex-wrap justify-center gap-1">
                          {r.belowEntryStop && <Pill tone="down">di bawah stop</Pill>}
                          {r.screener?.passAll && <Pill tone="up">lolos screener</Pill>}
                          {r.screener && !r.screener.passAll && !r.belowEntryStop && (
                            <Pill tone="muted">tidak lolos screener</Pill>
                          )}
                        </div>
                      </Td>
                      <Td align="center">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            persist(positions.filter((p) => p.id !== r.position.id));
                          }}
                          title={`Hapus ${r.position.code}`}
                          className="cursor-pointer rounded-md border border-slate-700 px-2 py-1 text-slate-500 hover:border-rose-700 hover:text-rose-300"
                        >
                          <Trash2 className="w-3 h-3" aria-hidden="true" />
                        </button>
                      </Td>
                    </tr>
                    {expanded === r.position.id && (
                      <tr>
                        <Td align="left" colSpan={10} className="bg-slate-950 p-0">
                          <PositionDetail r={r} />
                        </Td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Panel>
      )}

      <SourceNote icon={Info}>
        <strong className="text-slate-400">Layar ini tidak menyuruh Anda menjual, dan itu disengaja.</strong> Keputusan
        jual bergantung pada horizon, posisi pajak, keyakinan Anda, dan apa lagi yang Anda pegang — tidak satu pun
        diketahui aplikasi ini. Yang bisa dilakukannya adalah menaruh fakta mekanis di sebelah harga beli Anda sendiri
        dan menyebutkan aturan di balik tiap angka: stop ATR dihitung dari harga beli Anda (bukan dari harga hari ini,
        karena itu menjawab pertanyaan orang yang baru mau masuk, bukan yang sudah pegang), ketiga aturan keras
        screener, RSI, jarak ke MA, dan pergeseran kepemilikan institusi di register KSEI. Kalau semuanya menunjuk arah
        yang sama, keputusannya biasanya sudah jelas tanpa perlu dilabeli. Kalau saling bertentangan, pertentangan itu
        sendiri informasinya — dan label "JUAL" justru akan menyembunyikannya.
      </SourceNote>
    </div>
  );
};

// ---------------------------------------------------------------------------

const PositionDetail: React.FC<{ r: PositionReading }> = ({ r }) => {
  const s = r.setupFromEntry;
  return (
    <div className="space-y-3 border-t border-slate-800 p-4">
      <StatGrid cols={4}>
        <Stat label="Modal" value={money(r.costIdr)} hint={`${rp(r.shares)} lembar`} />
        <Stat
          label="Stop ATR dari harga beli"
          value={s ? rp(s.stop) : '–'}
          tone={r.belowEntryStop ? 'down' : 'neutral'}
          hint={s ? `beli ${rp(s.entry)} − 1,5×ATR` : 'ATR14 belum tersedia'}
        />
        <Stat
          label="Target ATR dari harga beli"
          value={s ? rp(s.target) : '–'}
          hint={s ? `beli ${rp(s.entry)} + 2,5×ATR` : '–'}
        />
        <Stat
          label="Institusi KSEI 3 bln"
          value={
            Number.isFinite(r.institutionalDeltaPp)
              ? `${r.institutionalDeltaPp >= 0 ? '+' : '−'}${Math.abs(r.institutionalDeltaPp).toFixed(2)} pp`
              : '–'
          }
          tone={r.institutionalDeltaPp >= 0 ? 'up' : 'down'}
          hint="register kepemilikan"
        />
      </StatGrid>

      {r.belowEntryStop && s && (
        <div className="flex gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-3">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" aria-hidden="true" />
          <div className="text-[11px] leading-relaxed text-rose-200/90">
            Harga {rp(r.price)} sudah di bawah {rp(s.stop)} — stop mekanis 1,5×ATR dihitung dari harga beli Anda{' '}
            {rp(s.entry)}. Itu berarti pergerakannya sudah melewati batas volatilitas normal emiten ini, bukan sekadar
            naik-turun harian. Apa yang Anda lakukan dengan fakta itu tetap keputusan Anda.
          </div>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-3">
        <RuleRow
          ok={Boolean(r.screener?.passMa)}
          label="Di atas MA pendek & panjang"
          detail={r.screener ? `jarak ke MA panjang ${pct(r.screener.premiumToMaLong)}` : 'tidak bertransaksi sesi ini'}
        />
        <RuleRow
          ok={Boolean(r.screener?.passVolume)}
          label="Volume di atas ambang"
          detail={r.screener ? `${rp(r.screener.volumeShares / 1e6, 1)} juta lembar` : '–'}
        />
        <RuleRow
          ok={Boolean(r.screener?.passValue)}
          label="Nilai transaksi di atas ambang"
          detail={r.screener ? `Rp ${rp(r.screener.valueIdr / 1e9, 1)} miliar` : '–'}
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Pill tone="muted">RSI {Number.isFinite(r.rsi14) ? r.rsi14.toFixed(0) : '–'}</Pill>
        <Pill tone="muted">vs MA50 {pct(r.priceVsSma50)}</Pill>
        <Pill tone="muted">vs MA200 {pct(r.priceVsSma200)}</Pill>
        <Pill tone="muted">ATR harian {pct(r.atrPercent)}</Pill>
        <Pill tone="muted">{r.sector}</Pill>
        {r.position.boughtOn && <Pill tone="muted">dicatat {r.position.boughtOn}</Pill>}
      </div>
    </div>
  );
};

const RuleRow: React.FC<{ ok: boolean; label: string; detail: string }> = ({ ok, label, detail }) => (
  <div
    className={cx(
      'flex items-start gap-2 rounded-xl border p-3',
      ok ? 'border-emerald-800/60 bg-emerald-950/20' : 'border-rose-900/50 bg-rose-950/10'
    )}
  >
    <span
      className={cx(
        'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full',
        ok ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
      )}
    >
      {ok ? <Check className="h-2.5 w-2.5" aria-hidden="true" /> : <X className="h-2.5 w-2.5" aria-hidden="true" />}
    </span>
    <div className="min-w-0">
      <div className="text-[11px] font-bold text-slate-200">{label}</div>
      <div className="text-[10px] text-slate-500">{detail}</div>
    </div>
  </div>
);
