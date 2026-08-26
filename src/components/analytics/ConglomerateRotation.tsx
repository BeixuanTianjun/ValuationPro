import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Crown, Network, XCircle } from 'lucide-react';
import { MarketDatabase } from '../../data/marketRepository';
import { FactorSnapshot } from '../../types/market';
import { GroupMember, GroupRotation, computeAllGroupRotations } from '../../models/conglomerateRotation';

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
  { label: string; cls: string; icon: React.ElementType }
> = {
  kuat: { label: 'Kondisi rotasi ada', cls: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/8', icon: CheckCircle2 },
  lemah: { label: 'Sinyal lemah', cls: 'text-amber-400 border-amber-500/30 bg-amber-500/8', icon: AlertTriangle },
  'tidak-valid': { label: 'Tidak bergerak sebagai grup', cls: 'text-rose-400 border-rose-500/30 bg-rose-500/8', icon: XCircle },
};

export const ConglomerateRotation: React.FC<Props> = ({ db, factors, onSelectEmiten }) => {
  const [expanded, setExpanded] = useState<string | null>(null);
  const groups = useMemo(() => (factors ? computeAllGroupRotations(db, factors) : []), [db, factors]);

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-900/40 p-5">
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-indigo-400" aria-hidden="true" />
          <h3 className="text-sm font-bold text-white">Rotasi Konglomerasi</h3>
        </div>
        <p className="text-[11px] text-slate-400 mt-2 leading-relaxed max-w-3xl">
          Uang sering berputar di antara emiten milik satu grup pengendali. Alat ini mengukur tiga hal yang harus ada
          sebelum sebuah rotasi layak dipertimbangkan: apakah grupnya memang sedang bergerak, apakah anggotanya
          benar-benar bergerak bersama, dan siapa yang paling tertinggal.
        </p>
        <div className="mt-4 flex gap-2 rounded-xl border border-amber-500/25 bg-amber-500/8 px-4 py-3">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" aria-hidden="true" />
          <p className="text-[11px] text-amber-200/90 leading-relaxed">
            <strong>Ini bukan ramalan harga.</strong> Keanggotaan grup dikurasi dari afiliasi yang dilaporkan publik —
            IDX tidak menerbitkan peta pengendali yang terbaca mesin — dan kepemilikan bisa berubah. Angka{' '}
            <em>kohesi</em> di tiap kartu adalah bukti terukur apakah anggota grup benar-benar bergerak bersama;
            kalau rendah, "rotasi" di grup itu tidak punya dasar.
          </p>
        </div>
      </div>

      {!groups.length && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-400">
          Data faktor belum siap.
        </div>
      )}

      <div className="space-y-3">
        {groups.map((g) => {
          const v = VERDICT[g.verdict.level];
          const Icon = v.icon;
          const open = expanded === g.group.id;

          return (
            <div key={g.group.id} className="rounded-2xl border border-slate-800 bg-slate-900/50 overflow-hidden">
              <div className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-base font-bold text-white">{g.group.name}</h4>
                      <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full border ${v.cls}`}>
                        <Icon className="w-2.5 h-2.5 inline mr-1" aria-hidden="true" />
                        {v.label}
                      </span>
                      {g.confidence === 'medium' && (
                        <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-slate-800 text-slate-400">
                          afiliasi perlu diverifikasi
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1">
                      {g.group.principal} · {g.membersFound} dari {g.membersListed} emiten ditemukan
                    </div>
                  </div>

                  <div className="flex gap-5 shrink-0">
                    <Metric label="Return grup 3 bln" value={pct(g.groupReturn3m)} cls={tone(g.groupReturn3m)} />
                    <Metric label="Kohesi" value={Number.isFinite(g.cohesion) ? g.cohesion.toFixed(2) : '–'} />
                    <Metric label="Sebaran" value={`${(g.dispersion3m * 100).toFixed(0)} pp`} />
                    <Metric
                      label="Asing 20H"
                      value={`Rp ${num(g.groupForeignNet20IdrBn, 1)} M`}
                      cls={tone(g.groupForeignNet20IdrBn)}
                    />
                  </div>
                </div>

                <p className="text-[11px] text-slate-400 mt-3 leading-relaxed">{g.verdict.reason}</p>

                {g.verdict.level === 'kuat' && g.leader && g.candidate && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
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
                  onClick={() => setExpanded(open ? null : g.group.id)}
                  className="flex items-center gap-1.5 mt-4 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold rounded-lg transition-colors cursor-pointer"
                >
                  {open ? <ChevronUp className="w-3 h-3" aria-hidden="true" /> : <ChevronDown className="w-3 h-3" aria-hidden="true" />}
                  {open ? 'Sembunyikan anggota' : `Lihat ${g.membersFound} anggota`}
                </button>
              </div>

              {open && (
                <div className="border-t border-slate-800 bg-slate-950/50 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-slate-500">
                      <tr>
                        <th scope="col" className="text-left px-5 py-2 font-semibold">Emiten</th>
                        <th scope="col" className="text-right px-3 py-2 font-semibold">Harga</th>
                        <th scope="col" className="text-right px-3 py-2 font-semibold">1 Bln</th>
                        <th scope="col" className="text-right px-3 py-2 font-semibold">3 Bln</th>
                        <th scope="col" className="text-right px-3 py-2 font-semibold">vs Grup</th>
                        <th scope="col" className="text-right px-3 py-2 font-semibold">Korelasi</th>
                        <th scope="col" className="text-right px-3 py-2 font-semibold">RSI</th>
                        <th scope="col" className="text-right px-3 py-2 font-semibold">Asing 20H</th>
                        <th scope="col" className="text-right px-5 py-2 font-semibold">Skor rotasi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.members.map((m) => (
                        <tr
                          key={m.code}
                          onClick={() => onSelectEmiten(m.code)}
                          className="border-t border-slate-800/60 hover:bg-slate-800/40 cursor-pointer transition-colors"
                        >
                          <td className="px-5 py-2">
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-slate-100">{m.code}</span>
                              {m.role === 'leader' && <Crown className="w-3 h-3 text-amber-400" aria-hidden="true" />}
                            </div>
                            <div className="text-[10px] text-slate-600 truncate max-w-[170px]">{m.name}</div>
                          </td>
                          <td className="px-3 py-2 text-right text-slate-100">{num(m.price)}</td>
                          <td className={`px-3 py-2 text-right ${tone(m.return1m)}`}>{pct(m.return1m)}</td>
                          <td className={`px-3 py-2 text-right ${tone(m.return3m)}`}>{pct(m.return3m)}</td>
                          <td className={`px-3 py-2 text-right ${tone(m.relativeToGroup3m)}`}>
                            {pct(m.relativeToGroup3m)}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-300">
                            {Number.isFinite(m.correlationWithGroup) ? m.correlationWithGroup.toFixed(2) : '–'}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-300">
                            {Number.isFinite(m.rsi14) ? m.rsi14.toFixed(0) : '–'}
                          </td>
                          <td className={`px-3 py-2 text-right ${tone(m.foreignNet20IdrBn)}`}>
                            {num(m.foreignNet20IdrBn, 1)}
                          </td>
                          <td className="px-5 py-2 text-right font-bold text-slate-100">
                            {m.role === 'leader' ? '–' : m.rotationScore.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {g.group.note && <p className="px-5 py-3 text-[10px] text-slate-500">{g.group.note}</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const Metric: React.FC<{ label: string; value: string; cls?: string }> = ({ label, value, cls = 'text-slate-100' }) => (
  <div className="text-right">
    <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">{label}</div>
    <div className={`text-sm font-bold tabular-nums ${cls}`}>{value}</div>
  </div>
);

const MemberCard: React.FC<{
  title: string;
  member: GroupMember;
  accent: 'emerald' | 'blue';
  onSelect: (code: string) => void;
}> = ({ title, member, accent, onSelect }) => (
  <div
    className={`rounded-xl border p-4 ${
      accent === 'emerald' ? 'border-emerald-500/25 bg-emerald-500/5' : 'border-blue-500/25 bg-blue-500/5'
    }`}
  >
    <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">{title}</div>
    <button
      onClick={() => onSelect(member.code)}
      className="text-base font-extrabold text-white hover:text-blue-400 transition-colors cursor-pointer mt-1"
    >
      {member.code}
    </button>
    <span className="text-[11px] text-slate-400 ml-2">{member.name}</span>

    <div className="grid grid-cols-3 gap-3 mt-3">
      <Metric label="3 Bln" value={pct(member.return3m)} cls={tone(member.return3m)} />
      <Metric label="vs Grup" value={pct(member.relativeToGroup3m)} cls={tone(member.relativeToGroup3m)} />
      <Metric label="Likuiditas" value={`Rp ${num(member.liquidityIdrBn, 1)} M`} />
    </div>

    {member.evidence.length > 0 && (
      <ul className="mt-3 space-y-1">
        {member.evidence.slice(0, 3).map((e, i) => (
          <li key={i} className="flex gap-1.5 text-[10px] text-slate-400 leading-relaxed">
            <span className="text-slate-600">•</span>
            <span>{e}</span>
          </li>
        ))}
      </ul>
    )}
  </div>
);
