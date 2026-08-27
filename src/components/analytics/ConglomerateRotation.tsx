import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Crown, Landmark, Network, Trophy, XCircle } from 'lucide-react';
import { MarketDatabase } from '../../data/marketRepository';
import { FactorSnapshot } from '../../types/market';
import { GroupMember, GroupRotation, computeAllGroupRotations } from '../../models/conglomerateRotation';
import { EmptyState, Panel, PanelHeader, Pill, Segmented, SourceNote, TableScroll, Td, Th, cx } from '../common/ui';

interface Props {
  db: MarketDatabase;
  factors: Map<string, FactorSnapshot> | null;
  onSelectEmiten: (code: string) => void;
}

const pct = (v: number, d = 1) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%` : '–');
const num = (v: number, d = 0) => (Number.isFinite(v) ? v.toLocaleString('id-ID', { maximumFractionDigits: d }) : '–');
const tone = (v: number) =>
  !Number.isFinite(v) ? 'text-slate-500' : v > 0 ? 'text-emerald-400' : v < 0 ? 'text-rose-400' : 'text-slate-400';

const VERDICT: Record<
  GroupRotation['verdict']['level'],
  { label: string; short: string; cls: string; icon: React.ElementType }
> = {
  kuat: {
    label: 'Kondisi rotasi ada',
    short: 'Rotasi',
    cls: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
    icon: CheckCircle2,
  },
  lemah: {
    label: 'Sinyal lemah',
    short: 'Lemah',
    cls: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
    icon: AlertTriangle,
  },
  'tidak-valid': {
    label: 'Tidak bergerak sebagai grup',
    short: 'Tak kohesif',
    cls: 'text-rose-400 border-rose-500/30 bg-rose-500/10',
    icon: XCircle,
  },
};

type Filter = 'semua' | 'keluarga' | 'negara' | 'valid';

const FILTERS: { id: Filter; label: string; shortLabel: string }[] = [
  { id: 'semua', label: 'Semua grup', shortLabel: 'Semua' },
  { id: 'valid', label: 'Hanya yang kohesif', shortLabel: 'Kohesif' },
  { id: 'keluarga', label: 'Keluarga', shortLabel: 'Keluarga' },
  { id: 'negara', label: 'BUMN / negara', shortLabel: 'BUMN' },
];

export const ConglomerateRotation: React.FC<Props> = ({ db, factors, onSelectEmiten }) => {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('semua');

  const groups = useMemo(() => (factors ? computeAllGroupRotations(db, factors) : []), [db, factors]);

  const shown = useMemo(
    () =>
      groups.filter((g) => {
        if (filter === 'valid') return g.verdict.level !== 'tidak-valid';
        if (filter === 'keluarga') return g.group.kind === 'keluarga';
        if (filter === 'negara') return g.group.kind === 'negara';
        return true;
      }),
    [groups, filter]
  );

  // "Who is leading" is a group-level question, and it is answered by ranking
  // the groups themselves rather than by scrolling 30 cards. Sorted on the
  // 1-month cap-weighted move because that is the horizon a rotation plays out
  // over; cohesion is shown beside it so a fast-moving incoherent group is
  // visibly not a group.
  const leaderboard = useMemo(
    () => [...groups].sort((a, b) => (b.groupReturn1m || -Infinity) - (a.groupReturn1m || -Infinity)),
    [groups]
  );

  return (
    <div className="space-y-4 sm:space-y-5">
      <Panel>
        <PanelHeader
          icon={Network}
          title="Rotasi Konglomerasi"
          tone="text-indigo-400"
          subtitle={`${groups.length} grup pengendali terpantau. Alat ini mengukur tiga hal yang harus ada sebelum sebuah rotasi layak dipertimbangkan: apakah grupnya memang sedang bergerak, apakah anggotanya benar-benar bergerak bersama, dan siapa yang paling tertinggal.`}
          actions={
            <Segmented
              options={FILTERS}
              value={filter}
              onChange={setFilter}
              ariaLabel="Saring grup"
              size="sm"
              activeClass="bg-indigo-600 text-white shadow-md shadow-indigo-900/40"
            />
          }
        />

        <div className="mt-4 flex gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3.5 py-3 sm:px-4">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" aria-hidden="true" />
          <p className="text-[11px] leading-relaxed text-amber-200/90">
            <strong>Ini bukan ramalan harga.</strong> Keanggotaan grup dikurasi dari afiliasi yang dilaporkan publik —
            IDX tidak menerbitkan peta pengendali yang terbaca mesin — dan kepemilikan bisa berubah. Angka{' '}
            <em>kohesi</em> di tiap kartu adalah bukti terukur apakah anggota grup benar-benar bergerak bersama; kalau
            rendah, "rotasi" di grup itu tidak punya dasar.
          </p>
        </div>
      </Panel>

      {/* ------------------------------------------------------------------ */}
      {/* Who is leading                                                      */}
      {/* ------------------------------------------------------------------ */}
      {leaderboard.length > 0 && (
        <Panel>
          <PanelHeader
            icon={Trophy}
            title="Siapa yang sedang memimpin"
            tone="text-amber-400"
            subtitle="Return grup tertimbang kapitalisasi, 1 bulan. Kolom kohesi menentukan apakah angka di sebelah kiri benar-benar gerakan satu grup atau kebetulan satu anggota besar saja yang lari."
          />
          <TableScroll className="mt-3">
            <table className="w-full min-w-[680px] text-xs">
              <thead className="border-b border-slate-800">
                <tr>
                  <Th align="left" sticky>
                    Grup
                  </Th>
                  <Th>1 Bln</Th>
                  <Th>3 Bln</Th>
                  <Th>Kohesi</Th>
                  <Th>Sebaran</Th>
                  <Th>Asing 20H</Th>
                  <Th align="left">Kandidat tertinggal</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {leaderboard.map((g) => (
                  <tr key={g.group.id} className="hover:bg-slate-800/30">
                    <Td align="left" sticky>
                      <button
                        type="button"
                        onClick={() => setExpanded(g.group.id)}
                        className="font-bold text-slate-100 hover:text-indigo-300 cursor-pointer"
                      >
                        {g.group.name}
                      </button>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {g.group.kind === 'negara' && (
                          <Pill tone="muted">
                            <Landmark className="w-2.5 h-2.5" aria-hidden="true" /> negara
                          </Pill>
                        )}
                        <span className="text-[10px] text-slate-600">{g.membersFound} emiten</span>
                      </div>
                    </Td>
                    <Td className={cx('font-bold', tone(g.groupReturn1m))}>{pct(g.groupReturn1m)}</Td>
                    <Td className={tone(g.groupReturn3m)}>{pct(g.groupReturn3m)}</Td>
                    <Td
                      className={cx(
                        'font-semibold',
                        !Number.isFinite(g.cohesion) ? 'text-slate-600' : g.cohesion >= 0.4 ? 'text-emerald-400' : g.cohesion >= 0.25 ? 'text-amber-400' : 'text-rose-400'
                      )}
                    >
                      {Number.isFinite(g.cohesion) ? g.cohesion.toFixed(2) : '–'}
                    </Td>
                    <Td className="text-slate-300">{(g.dispersion3m * 100).toFixed(0)} pp</Td>
                    <Td className={tone(g.groupForeignNet20IdrBn)}>{num(g.groupForeignNet20IdrBn, 1)}</Td>
                    <Td align="left">
                      {g.verdict.level === 'kuat' && g.candidate ? (
                        <button
                          type="button"
                          onClick={() => onSelectEmiten(g.candidate!.code)}
                          className="font-bold text-cyan-300 hover:text-cyan-200 cursor-pointer"
                        >
                          {g.candidate.code}
                        </button>
                      ) : (
                        <span className="text-[10px] text-slate-600">{VERDICT[g.verdict.level].short}</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Panel>
      )}

      {!groups.length && <EmptyState title="Data faktor belum siap">Basis data pasar masih dimuat.</EmptyState>}

      {groups.length > 0 && shown.length === 0 && (
        <EmptyState title="Tidak ada grup pada saringan ini">Ubah saringan di atas untuk melihat grup lain.</EmptyState>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Group cards                                                         */}
      {/* ------------------------------------------------------------------ */}
      <div className="space-y-3">
        {shown.map((g) => {
          const v = VERDICT[g.verdict.level];
          const Icon = v.icon;
          const open = expanded === g.group.id;

          return (
            <Panel key={g.group.id} padded={false} tone="flat">
              <div className="p-4 sm:p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-base font-bold text-white">{g.group.name}</h4>
                      <span className={cx('rounded-full border px-2 py-0.5 text-[10px] font-bold', v.cls)}>
                        <Icon className="mr-1 inline w-2.5 h-2.5" aria-hidden="true" />
                        {v.label}
                      </span>
                      {g.group.kind === 'negara' && (
                        <Pill tone="muted">
                          <Landmark className="w-2.5 h-2.5" aria-hidden="true" /> klaster negara
                        </Pill>
                      )}
                      {g.confidence === 'medium' && <Pill tone="warn">afiliasi perlu diverifikasi</Pill>}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      {g.group.principal} · {g.membersFound} dari {g.membersListed} emiten ditemukan
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:w-auto lg:shrink-0">
                    <Metric label="Return grup 3 bln" value={pct(g.groupReturn3m)} cls={tone(g.groupReturn3m)} />
                    <Metric label="Kohesi" value={Number.isFinite(g.cohesion) ? g.cohesion.toFixed(2) : '–'} />
                    <Metric label="Sebaran" value={`${(g.dispersion3m * 100).toFixed(0)} pp`} />
                    <Metric
                      label="Asing 20H"
                      value={`Rp ${num(g.groupForeignNet20IdrBn, 1)} miliar`}
                      cls={tone(g.groupForeignNet20IdrBn)}
                    />
                  </div>
                </div>

                <p className="mt-3 text-[11px] leading-relaxed text-slate-400">{g.verdict.reason}</p>

                {g.verdict.level === 'kuat' && g.leader && g.candidate && (
                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <MemberCard title="Pemimpin grup" member={g.leader} accent="emerald" onSelect={onSelectEmiten} />
                    <MemberCard
                      title="Paling tertinggal & layak dipantau"
                      member={g.candidate}
                      accent="blue"
                      onSelect={onSelectEmiten}
                    />
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : g.group.id)}
                  className="mt-4 flex cursor-pointer items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-[11px] font-bold text-slate-200 transition-colors hover:bg-slate-700 touch-target"
                  aria-expanded={open}
                >
                  {open ? (
                    <ChevronUp className="w-3 h-3" aria-hidden="true" />
                  ) : (
                    <ChevronDown className="w-3 h-3" aria-hidden="true" />
                  )}
                  {open ? 'Sembunyikan anggota' : `Lihat ${g.membersFound} anggota`}
                </button>
              </div>

              {open && (
                <div className="border-t border-slate-800 bg-slate-950/50">
                  <div className="overflow-x-auto scrollbar-thin">
                    <table className="w-full min-w-[760px] text-xs">
                      <thead className="border-b border-slate-800">
                        <tr>
                          <Th align="left" sticky className="bg-slate-950">
                            Emiten
                          </Th>
                          <Th>Harga</Th>
                          <Th>1 Bln</Th>
                          <Th>3 Bln</Th>
                          <Th>vs Grup</Th>
                          <Th>Korelasi</Th>
                          <Th>RSI</Th>
                          <Th>Asing 20H</Th>
                          <Th>Skor rotasi</Th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {g.members.map((m) => (
                          <tr
                            key={m.code}
                            onClick={() => onSelectEmiten(m.code)}
                            className="cursor-pointer transition-colors hover:bg-slate-800/40"
                          >
                            <Td align="left" sticky className="bg-slate-950/95">
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-slate-100">{m.code}</span>
                                {m.role === 'leader' && <Crown className="w-3 h-3 text-amber-400" aria-hidden="true" />}
                              </div>
                              <div className="max-w-[170px] truncate text-[10px] text-slate-600">{m.name}</div>
                            </Td>
                            <Td className="text-slate-100">{num(m.price)}</Td>
                            <Td className={tone(m.return1m)}>{pct(m.return1m)}</Td>
                            <Td className={tone(m.return3m)}>{pct(m.return3m)}</Td>
                            <Td className={tone(m.relativeToGroup3m)}>{pct(m.relativeToGroup3m)}</Td>
                            <Td className="text-slate-300">
                              {Number.isFinite(m.correlationWithGroup) ? m.correlationWithGroup.toFixed(2) : '–'}
                            </Td>
                            <Td className="text-slate-300">{Number.isFinite(m.rsi14) ? m.rsi14.toFixed(0) : '–'}</Td>
                            <Td className={tone(m.foreignNet20IdrBn)}>{num(m.foreignNet20IdrBn, 1)}</Td>
                            <Td className="font-bold text-slate-100">
                              {m.role === 'leader' ? '–' : m.rotationScore.toFixed(2)}
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {g.group.note && (
                    <p className="px-4 py-3 text-[10px] leading-relaxed text-slate-500 sm:px-5">{g.group.note}</p>
                  )}
                </div>
              )}
            </Panel>
          );
        })}
      </div>

      <SourceNote icon={AlertTriangle}>
        Tabel keanggotaan grup ada di <code className="text-slate-400">src/data/conglomerates.ts</code> dan sengaja
        dibuat mudah disunting — memperbaiki satu anggota adalah perubahan satu baris yang langsung mengalir ke seluruh
        model. Grup berlabel <em>klaster negara</em> bukan konglomerasi keluarga: pengendalinya satu (Danantara /
        MIND ID), dan mereka dikelompokkan karena arus dana serta kebijakannya sama.
      </SourceNote>
    </div>
  );
};

const Metric: React.FC<{ label: string; value: string; cls?: string }> = ({ label, value, cls = 'text-slate-100' }) => (
  <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-2 min-w-0">
    <div className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
    <div className={cx('text-sm font-bold tabular-nums', cls)}>{value}</div>
  </div>
);

const MemberCard: React.FC<{
  title: string;
  member: GroupMember;
  accent: 'emerald' | 'blue';
  onSelect: (code: string) => void;
}> = ({ title, member, accent, onSelect }) => (
  <div
    className={cx(
      'rounded-xl border p-3.5 sm:p-4',
      accent === 'emerald' ? 'border-emerald-500/25 bg-emerald-500/5' : 'border-blue-500/25 bg-blue-500/5'
    )}
  >
    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{title}</div>
    <div className="mt-1 flex flex-wrap items-baseline gap-2">
      <button
        type="button"
        onClick={() => onSelect(member.code)}
        className="cursor-pointer text-base font-extrabold text-white transition-colors hover:text-blue-400"
      >
        {member.code}
      </button>
      <span className="min-w-0 truncate text-[11px] text-slate-400">{member.name}</span>
    </div>

    <div className="mt-3 grid grid-cols-3 gap-3">
      <Metric label="3 Bln" value={pct(member.return3m)} cls={tone(member.return3m)} />
      <Metric label="vs Grup" value={pct(member.relativeToGroup3m)} cls={tone(member.relativeToGroup3m)} />
      <Metric label="Likuiditas" value={`Rp ${num(member.liquidityIdrBn, 1)} miliar`} />
    </div>

    {member.evidence.length > 0 && (
      <ul className="mt-3 space-y-1">
        {member.evidence.slice(0, 3).map((e, i) => (
          <li key={i} className="flex gap-1.5 text-[10px] leading-relaxed text-slate-400">
            <span className="text-slate-600">•</span>
            <span>{e}</span>
          </li>
        ))}
      </ul>
    )}
  </div>
);
