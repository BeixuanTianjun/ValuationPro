import React, { useEffect, useRef, useState } from 'react';
import { Bot, CornerDownLeft, Info, Loader2, Sparkles, User } from 'lucide-react';
import { MarketDatabase } from '../../data/marketRepository';
import { FundamentalsDatabase } from '../../data/fundamentalsRepository';
import { FactorSnapshot } from '../../types/market';
import { ChatAnswer, ChatTurn, askEmitenChat } from '../../data/chatClient';
import { EmitenRow } from '../../models/emitenQueryEngine';

interface Props {
  db: MarketDatabase;
  factors: Map<string, FactorSnapshot> | null;
  fundamentals: FundamentalsDatabase | null;
  onSelectEmiten: (code: string) => void;
}

interface Message {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  answer?: ChatAnswer;
}

const SUGGESTIONS = [
  'Saham batu bara P/E di bawah 10 yang likuid',
  'Emiten yang diakumulasi asing dan trennya naik di atas MA200',
  'Saham dividen tinggi kapitalisasi besar',
  'Emiten teknologi yang oversold',
  'Saham perbankan dengan P/BV di bawah 1',
  'Emiten konsumer yang bisa dimodelkan DCF',
];

const pct = (v: number, d = 1) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%` : '–');
const num = (v: number, d = 0) => (Number.isFinite(v) ? v.toLocaleString('id-ID', { maximumFractionDigits: d }) : '–');
const tone = (v: number) =>
  !Number.isFinite(v) ? 'text-slate-500' : v > 0 ? 'text-emerald-400' : v < 0 ? 'text-rose-400' : 'text-slate-400';

export const EmitenChat: React.FC<Props> = ({ db, factors, fundamentals, onSelectEmiten }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(0);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, busy]);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;

    const history: ChatTurn[] = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { id: ++idRef.current, role: 'user', content: question }]);
    setInput('');
    setBusy(true);

    try {
      const answer = await askEmitenChat(question, history, db, factors, fundamentals);
      setMessages((prev) => [
        ...prev,
        { id: ++idRef.current, role: 'assistant', content: answer.reply, answer },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: ++idRef.current,
          role: 'assistant',
          content: `Maaf, terjadi kesalahan: ${(err as Error).message}`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 overflow-hidden flex flex-col h-[calc(100vh-260px)] min-h-[520px]">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-800 bg-slate-950/50">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-600 to-blue-700 flex items-center justify-center">
          <Sparkles className="w-4 h-4 text-white" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-bold">Tanya Emiten</h3>
          <p className="text-[11px] text-slate-500">
            Menyaring {db.emiten.length} emiten tercatat · data per sesi {db.meta.latestSession}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
        {messages.length === 0 && (
          <div className="max-w-2xl">
            <p className="text-sm text-slate-300 leading-relaxed">
              Jelaskan saham seperti apa yang Anda cari, dalam bahasa sehari-hari. Saya menyaring seluruh database
              IDX — sektor, valuasi, likuiditas, momentum, dan arus dana asing.
            </p>
            <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-2 stagger">
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={s}
                  onClick={() => void send(s)}
                  className="text-left px-4 py-3 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-blue-600/50 hover:bg-slate-900 text-[13px] text-slate-300 transition-all duration-200 cursor-pointer animate-rise"
                  style={{ ['--i' as string]: i }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="flex gap-3 justify-end animate-fade">
              <div className="max-w-[78%] rounded-2xl rounded-br-sm bg-blue-600 px-4 py-2.5 text-sm text-white">
                {m.content}
              </div>
              <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center shrink-0">
                <User className="w-4 h-4 text-slate-400" aria-hidden="true" />
              </div>
            </div>
          ) : (
            <div key={m.id} className="flex gap-3 animate-fade">
              <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-600/30 flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4 text-indigo-400" aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0 space-y-3">
                <div className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">{m.content}</div>

                {m.answer?.note && (
                  <div className="flex gap-2 text-[11px] text-amber-400/90 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2">
                    <Info className="w-3 h-3 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{m.answer.note}</span>
                  </div>
                )}

                {!!m.answer?.rows.length && <ResultTable rows={m.answer.rows} onSelect={onSelectEmiten} />}

                {m.answer && (
                  <div className="text-[10px] text-slate-600">
                    Dijawab oleh mesin {m.answer.engine}
                    {m.answer.totalMatched > m.answer.rows.length &&
                      ` · ${m.answer.totalMatched - m.answer.rows.length} emiten lain juga cocok`}
                  </div>
                )}
              </div>
            </div>
          )
        )}

        {busy && (
          <div className="flex gap-3 animate-fade">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-600/30 flex items-center justify-center shrink-0">
              <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" aria-hidden="true" />
            </div>
            <div className="text-sm text-slate-500 pt-1.5">Menyaring {db.emiten.length} emiten…</div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="border-t border-slate-800 bg-slate-950/50 p-4"
      >
        <div className="flex items-end gap-2">
          <label htmlFor="chat-input" className="sr-only">
            Pertanyaan tentang emiten
          </label>
          <input
            id="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={busy}
            placeholder="mis. saham infrastruktur likuid yang P/E-nya di bawah 12…"
            className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-blue-600 transition-colors disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="flex items-center gap-2 px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold transition-all cursor-pointer"
          >
            Cari
            <CornerDownLeft className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
        <p className="mt-2 text-[10px] text-slate-600">
          Jawaban dihitung dari database IDX yang tersimpan, bukan dari ingatan model. Alat riset, bukan rekomendasi
          investasi.
        </p>
      </form>
    </div>
  );
};

const ResultTable: React.FC<{ rows: EmitenRow[]; onSelect: (code: string) => void }> = ({ rows, onSelect }) => (
  <div className="rounded-xl border border-slate-800 overflow-hidden bg-slate-950/50">
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full text-xs">
        <thead className="bg-slate-900/70 text-slate-500">
          <tr>
            <th scope="col" className="text-left px-3 py-2 font-semibold">
              Emiten
            </th>
            <th scope="col" className="text-right px-3 py-2 font-semibold">
              Harga
            </th>
            <th scope="col" className="text-right px-3 py-2 font-semibold">
              3 Bln
            </th>
            <th scope="col" className="text-right px-3 py-2 font-semibold">
              Kap (Rp M)
            </th>
            <th scope="col" className="text-right px-3 py-2 font-semibold">
              Likuiditas
            </th>
            <th scope="col" className="text-right px-3 py-2 font-semibold">
              P/E
            </th>
            <th scope="col" className="text-right px-3 py-2 font-semibold">
              Asing 20H
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.emiten.code}
              onClick={() => onSelect(r.emiten.code)}
              className="border-t border-slate-800/60 hover:bg-slate-800/40 cursor-pointer transition-colors"
            >
              <td className="px-3 py-2">
                <div className="font-bold text-slate-100">{r.emiten.code}</div>
                <div className="text-[10px] text-slate-500 truncate max-w-[170px]">{r.emiten.name}</div>
              </td>
              <td className="px-3 py-2 text-right font-semibold text-slate-100">{num(r.price)}</td>
              <td className={`px-3 py-2 text-right ${tone(r.return3m)}`}>{pct(r.return3m)}</td>
              <td className="px-3 py-2 text-right text-slate-300">{num(r.marketCapIdrBn)}</td>
              <td className="px-3 py-2 text-right text-slate-400">{num(r.liquidityIdrBn, 1)}</td>
              <td className="px-3 py-2 text-right text-slate-300">{num(r.pe, 1)}</td>
              <td className={`px-3 py-2 text-right ${tone(r.foreignNet20IdrBn)}`}>{num(r.foreignNet20IdrBn, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);
