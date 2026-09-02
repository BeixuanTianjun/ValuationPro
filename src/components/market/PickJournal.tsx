import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ClipboardList, Download, Info, Laptop, RefreshCw } from 'lucide-react';
import {
  EvaluatedPick,
  MAX_HOLD_SESSIONS,
  MIN_RESOLVED_FOR_WINRATE,
  PickSummary,
  monthOf,
} from '../../models/pickJournal';
import { exportPickJournalToExcel } from '../../models/pickReport';
import { EmptyState, Panel, PanelHeader, Pill, SourceNote, Spinner, Stat, StatGrid, TableScroll, Td, Th, cx } from '../common/ui';

/**
 * JRN — did our own lists actually work?
 *
 * WHY A SEPARATE SCREEN FROM THE STRATEGY BOARD. The board answers "does this
 * mechanical rule work" over two years of history and is the stronger evidence
 * of the two. It cannot answer "does the list this terminal printed, in the
 * order it printed it, make money" — that needs the actual output recorded
 * forward, which is what the journal is. They will disagree, and where they do,
 * the journal is the one describing what a person using this app experienced.
 *
 * THE SCREEN'S FIRST JOB IS TO REFUSE TO ANSWER TOO EARLY. Recording began
 * 2026-09-02. A win rate off the first handful of resolved picks is noise with
 * a decimal point, so the number is withheld below MIN_RESOLVED_FOR_WINRATE and
 * the screen says exactly how many more are needed rather than showing a
 * confident-looking figure nobody should act on.
 */

interface Props {
  onSelectEmiten: (code: string) => void;
}

interface JournalPayload {
  startedOn: string;
  note: string;
  latestSession: string;
  total: number;
  provisionalExcluded: number;
  summaries: PickSummary[];
  picks: EvaluatedPick[];
}

const pct = (v: number, d = 1) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%` : '–');
const rp = (v: number, d = 0) => (Number.isFinite(v) ? v.toLocaleString('id-ID', { maximumFractionDigits: d }) : '–');

const OUTCOME_PILL: Record<string, { tone: 'up' | 'down' | 'muted' | 'warn'; label: string }> = {
  target: { tone: 'up', label: 'target' },
  stop: { tone: 'down', label: 'stop' },
  expired: { tone: 'warn', label: 'habis waktu' },
  open: { tone: 'muted', label: 'berjalan' },
};

export const PickJournal: React.FC<Props> = ({ onSelectEmiten }) => {
  const [data, setData] = useState<JournalPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [month, setMonth] = useState<string>('semua');
  const [busy, setBusy] = useState(false);

  const load = React.useCallback(() => {
    setLoading(true);
    void fetch('/api/picks', { cache: 'no-cache' })
      .then((r) => (r.ok ? (r.json() as Promise<JournalPayload>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        setData(d);
        setOffline(false);
      })
      .catch(() => setOffline(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const months = useMemo(() => {
    const set = new Set((data?.picks ?? []).map((p) => monthOf(p.session)));
    return [...set].sort().reverse();
  }, [data]);

  const rows = useMemo(() => {
    const all = data?.picks ?? [];
    const scoped = month === 'semua' ? all : all.filter((p) => monthOf(p.session) === month);
    return [...scoped].sort((a, b) => (a.session === b.session ? a.rank - b.rank : b.session.localeCompare(a.session)));
  }, [data, month]);

  if (loading) return <Spinner label="Membaca jurnal pick…" />;

  // NOT an error state, and the copy has to make that obvious. This screen is
  // local-only BY DESIGN: the journal is written to a file by a scheduler that
  // has to be alive at 16:15 WIB every session, and serverless has neither the
  // disk nor the process. A visitor on the deployed site should read this as
  // "this lives on his machine", not as "something is down".
  if (offline || !data) {
    return (
      <EmptyState icon={Laptop} title="Fitur lokal — jurnal ini hidup di mesin Michael" tone="neutral">
        <p>
          Winrate dihitung dari catatan yang ditulis penjadwal ke <code>.data/picks.json</code> setiap sesi setelah
          penutupan. Itu butuh disk permanen dan proses yang hidup tiap sore — dua hal yang tidak dimiliki hosting
          serverless, jadi layar ini memang tidak dirancang untuk jalan di situs terdeploy.
        </p>
        <p className="mt-2">
          Di mesin lokal ia sudah berjalan penuh: jalankan <code>npm run auto</code>, buka lagi layar ini, dan
          catatannya ada. Ini bukan kegagalan yang perlu diperbaiki.
        </p>
      </EmptyState>
    );
  }

  const total = data.summaries.find((s) => s.source === 'SEMUA');
  const resolved = total?.resolved ?? 0;
  const enough = resolved >= MIN_RESOLVED_FOR_WINRATE;

  return (
    <div className="space-y-4 sm:space-y-5">
      <Panel>
        <PanelHeader
          icon={ClipboardList}
          title="Jurnal Pick — winrate kita sendiri"
          tone="text-violet-300"
          subtitle={
            <>
              Tiap sesi, sepuluh teratas dari tiap layar Screener dan Watchlist dicatat pada harga penutupan, sebelum
              hasilnya diketahui. Dinilai memakai stop dan target ATR yang sama dengan yang dicetak layar, dengan
              horizon {MAX_HOLD_SESSIONS} sesi (±3 bulan). Dicatat sejak {data.startedOn || '—'} · sesi terakhir{' '}
              {data.latestSession}.
            </>
          }
          actions={
            <>
              <button
                type="button"
                onClick={load}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-[11px] font-bold text-slate-200 hover:bg-slate-700 touch-target"
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Muat ulang
              </button>
              <button
                type="button"
                disabled={busy || !data.picks.length}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await exportPickJournalToExcel(data.picks, data.summaries, {
                      startedOn: data.startedOn,
                      latestSession: data.latestSession,
                      month: month === 'semua' ? null : month,
                      provisionalExcluded: data.provisionalExcluded,
                    });
                  } finally {
                    setBusy(false);
                  }
                }}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-emerald-700 bg-emerald-600/15 px-3 py-2 text-[11px] font-bold text-emerald-300 hover:bg-emerald-600/25 disabled:cursor-not-allowed disabled:opacity-40 touch-target"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                {busy ? 'Menyusun…' : 'Laporan Excel'}
              </button>
            </>
          }
        />

        <StatGrid cols={4} className="mt-4">
          <Stat label="Pick tercatat" value={rp(total?.picks ?? 0)} hint={`sejak ${data.startedOn || '—'}`} />
          <Stat label="Sudah selesai" value={rp(resolved)} hint="kena stop, target, atau habis waktu" />
          <Stat label="Masih berjalan" value={rp(total?.open ?? 0)} hint="tidak dihitung ke winrate" />
          <Stat
            label="Winrate"
            value={enough ? pct((total?.winRate ?? NaN) * 1, 0).replace('+', '') : 'belum'}
            tone={enough ? 'accent' : 'neutral'}
            hint={enough ? `dari ${resolved} pick selesai` : `butuh ${MIN_RESOLVED_FOR_WINRATE - resolved} lagi`}
          />
        </StatGrid>

        {!enough && (
          <div className="mt-4">
            <EmptyState icon={AlertTriangle} title="Winrate belum layak dicetak" tone="warn">
              Baru {resolved} pick yang selesai; ambangnya {MIN_RESOLVED_FOR_WINRATE}. Dari sampel sekecil itu satu
              trade saja menggeser angkanya belasan poin, jadi menampilkannya sekarang hanya akan menghasilkan
              keyakinan yang tidak ditopang apa pun. Tabel di bawah tetap menampilkan tiap pick beserta statusnya —
              yang belum ada hanyalah kesimpulannya.
            </EmptyState>
          </div>
        )}

        {data.provisionalExcluded > 0 && (
          <p className="mt-3 text-[11px] text-amber-300">
            {data.provisionalExcluded} catatan sementara (dicatat saat sesi masih berjalan) dikecualikan dari semua
            angka di halaman ini. Baris-barisnya tetap ada di berkas.
          </p>
        )}
      </Panel>

      {/* Per source ---------------------------------------------------- */}
      <Panel>
        <PanelHeader icon={Info} title="Per layar" tone="text-violet-300" subtitle="Winrate dihitung hanya dari pick yang sudah selesai. Yang masih berjalan disebutkan di sebelahnya, tidak pernah dilebur ke dalamnya." />
        <TableScroll className="mt-3">
          <table className="w-full min-w-[760px] text-xs">
            <thead className="border-b border-slate-800">
              <tr>
                <Th align="left" sticky>Sumber</Th>
                <Th>Pick</Th>
                <Th>Selesai</Th>
                <Th>Berjalan</Th>
                <Th>Menang</Th>
                <Th>Kalah</Th>
                <Th>Winrate</Th>
                <Th title="Rata-rata hasil dalam satuan risiko yang diambil. -1 berarti stop penuh.">Expectancy</Th>
                <Th>Median 1 bln</Th>
                <Th>Median 3 bln</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {data.summaries.map((s) => (
                <tr key={s.source} className={cx('hover:bg-slate-800/30', s.source === 'SEMUA' && 'bg-slate-900/60')}>
                  <Td align="left" sticky className="font-bold text-slate-200">{s.label}</Td>
                  <Td className="text-slate-300">{s.picks}</Td>
                  <Td className="text-slate-300">{s.resolved}</Td>
                  <Td className="text-slate-500">{s.open}</Td>
                  <Td className="text-emerald-400">{s.wins}</Td>
                  <Td className="text-rose-400">{s.losses}</Td>
                  <Td className="font-bold text-slate-100">
                    {s.resolved >= MIN_RESOLVED_FOR_WINRATE ? `${(s.winRate * 100).toFixed(0)}%` : <span className="text-slate-600">belum</span>}
                  </Td>
                  <Td className={Number.isFinite(s.expectancyR) && s.expectancyR > 0 ? 'text-emerald-400' : 'text-slate-400'}>
                    {Number.isFinite(s.expectancyR) ? `${s.expectancyR >= 0 ? '+' : ''}${s.expectancyR.toFixed(2)}R` : '–'}
                  </Td>
                  <Td className="text-slate-300">{pct(s.medianReturn1m)}</Td>
                  <Td className="text-slate-300">{pct(s.medianReturn3m)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </Panel>

      {/* Every pick ---------------------------------------------------- */}
      <Panel>
        <PanelHeader
          icon={ClipboardList}
          title={`${rows.length} pick`}
          tone="text-violet-300"
          subtitle="Terbaru dulu. Klik kode untuk membuka profil emiten."
          actions={
            months.length > 1 && (
              <>
                <label htmlFor="jrn-month" className="sr-only">Bulan</label>
                <select
                  id="jrn-month"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="cursor-pointer rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 touch-target"
                >
                  <option value="semua">Semua bulan</option>
                  {months.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </>
            )
          }
        />

        {rows.length === 0 ? (
          <div className="mt-4">
            <EmptyState icon={ClipboardList} title="Belum ada pick tercatat">
              Penjadwal menulis catatan setiap sesi setelah penutupan. Kalau layanan lokal baru dinyalakan hari ini,
              baris pertama muncul sore ini.
            </EmptyState>
          </div>
        ) : (
          <TableScroll className="mt-3">
            <table className="w-full min-w-[900px] text-xs">
              <thead className="border-b border-slate-800">
                <tr>
                  <Th align="left" sticky>Emiten</Th>
                  <Th align="left">Sumber</Th>
                  <Th>Sesi</Th>
                  <Th>#</Th>
                  <Th>Entry</Th>
                  <Th>Stop</Th>
                  <Th>Target</Th>
                  <Th>Status</Th>
                  <Th>Sesi ditahan</Th>
                  <Th>Hasil</Th>
                  <Th>R</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {rows.slice(0, 300).map((p) => {
                  const o = OUTCOME_PILL[p.outcome] ?? OUTCOME_PILL.open;
                  return (
                    <tr key={p.id} className="hover:bg-slate-800/30">
                      <Td align="left" sticky>
                        <button
                          type="button"
                          onClick={() => onSelectEmiten(p.code)}
                          className="cursor-pointer font-bold text-violet-300 hover:text-violet-200"
                        >
                          {p.code}
                        </button>
                        {!p.entryIsFinalClose && <span className="ml-1.5 text-[9px] text-amber-400">sementara</span>}
                      </Td>
                      <Td align="left" className="text-[10px] text-slate-500">{p.source}</Td>
                      <Td className="text-slate-400">{p.session}</Td>
                      <Td className="text-slate-500">{p.rank}</Td>
                      <Td className="text-slate-200">{rp(p.entry)}</Td>
                      <Td className="text-rose-300">{rp(p.stop)}</Td>
                      <Td className="text-emerald-300">{rp(p.target)}</Td>
                      <Td><Pill tone={o.tone}>{o.label}</Pill></Td>
                      <Td className="text-slate-400">{p.sessionsHeld}</Td>
                      <Td className={p.returnPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{pct(p.returnPercent)}</Td>
                      <Td className={p.rMultiple >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        {Number.isFinite(p.rMultiple) ? `${p.rMultiple >= 0 ? '+' : ''}${p.rMultiple.toFixed(2)}` : '–'}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        )}

        <SourceNote icon={Info}>
          <strong className="text-slate-400">Kenapa ini bukan backtest.</strong> Papan Strategi menguji aturan mekanis
          atas 715 sesi riwayat dan itu bukti yang lebih kuat. Jurnal ini menjawab pertanyaan lain: daftar yang
          BENAR-BENAR dicetak terminal ini, dalam urutan yang dipakainya, menghasilkan apa. Tidak ada backfill —
          rumus conviction berubah 2 September 2026 dan lapisan narasi Watchlist hanya punya 45 hari pengajuan, jadi
          pick 2024 hasil rekonstruksi akan dinilai memakai masukan yang tidak pernah ia miliki. Entry memakai
          penutupan sesi saat dicatat; kalau satu sesi menyentuh stop dan target sekaligus, yang dihitung adalah
          STOP-nya, karena bar harian tidak bisa mengatakan mana yang lebih dulu. Ini catatan hasil, bukan
          rekomendasi.
        </SourceNote>
      </Panel>
    </div>
  );
};
