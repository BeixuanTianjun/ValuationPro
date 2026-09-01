// Chat transport.
//
// The query engine is isomorphic, so the browser can answer on its own. The
// local service is tried first because it may have an Anthropic key for
// free-form questions; if it is not running, the browser falls back to the
// deterministic engine and the feature still works with zero setup.

import { MarketDatabase } from './marketRepository';
import { FundamentalsDatabase } from './fundamentalsRepository';
import { FactorSnapshot } from '../types/market';
import { EmitenRow, parseIndonesianQuery, queryEmiten } from '../models/emitenQueryEngine';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatAnswer {
  reply: string;
  rows: EmitenRow[];
  totalMatched: number;
  appliedFilters: string[];
  engine: 'lokal' | 'claude' | 'lokal (browser)';
  understood: string[];
  note?: string;
}

const API = '/api/chat';

/**
 * Whether POST /api/chat answered the last time it was tried.
 *
 * THIS IS A SEPARATE FLAG ON PURPOSE, and collapsing it back into
 * `serviceAvailable` is the bug it exists to prevent. On Vercel there is no
 * /api/status — only `api/live.ts` and `api/chat.ts` are deployed — so the
 * status probe 404s and the local service looks absent, which it is. But the
 * chat function is right there and works. Gating chat on the status probe made
 * the deployed app answer every question with the in-browser parser without
 * ever issuing the request, and the fallback made that invisible: the reply
 * still arrived, just from the weaker engine, under a footnote blaming a
 * missing API key that had nothing to do with it.
 *
 * Only a real 404 from /api/chat itself may set this, because only that proves
 * there is no chat backend.
 */
let chatEndpointAvailable: boolean | null = null;

/**
 * Set once /api/status answers 404 — the route is not deployed at all.
 *
 * A static deploy has no status endpoint (only `api/live.ts` and `api/chat.ts`
 * ship), and no amount of waiting will conjure one: a deployment that adds it
 * also reloads the page. Without this the poller re-asked every 60 seconds
 * forever, logging a console error each time — fourteen of them in one short
 * session on the live site — and burying any real error in the noise.
 *
 * A network failure or a 5xx is deliberately NOT enough: that is a service that
 * is merely down, and it is expected to come back mid-session.
 */
let statusEndpointAbsent = false;

export const isStatusEndpointAbsent = () => statusEndpointAbsent;

function answerInBrowser(
  message: string,
  db: MarketDatabase,
  factors: Map<string, FactorSnapshot> | null,
  fundamentals: FundamentalsDatabase | null
): ChatAnswer {
  const parsed = parseIndonesianQuery(message);
  const result = queryEmiten(db, factors, fundamentals, parsed.query);

  const reply = !result.rows.length
    ? parsed.fellBackToTextSearch
      ? 'Saya belum menemukan emiten yang cocok. Coba sebutkan sektor, batas P/E, likuiditas, atau kode emitennya — misalnya "saham batu bara P/E di bawah 10 yang likuid".'
      : `Tidak ada emiten yang memenuhi ${parsed.understood.join(', ')}. Coba longgarkan salah satu kriterianya.`
    : `${
        parsed.understood.length ? `Kriteria yang saya pakai: ${parsed.understood.join(', ')}.` : 'Pencarian kata kunci.'
      } Ditemukan ${result.totalMatched} emiten, menampilkan ${result.rows.length} teratas berdasarkan ${result.sortLabel}.`;

  return {
    reply,
    rows: result.rows,
    totalMatched: result.totalMatched,
    appliedFilters: result.appliedFilters,
    engine: 'lokal (browser)',
    understood: parsed.understood,
  };
}

/**
 * Set when the last /api/chat call failed for a reason worth telling the user.
 *
 * WHY THIS EXISTS. The fallback below used to swallow EVERY non-ok response in
 * silence: a 401 from the auth gate produced the same output as a healthy
 * offline install — a keyword-search answer with no explanation. Signed out
 * with a perfectly good Anthropic key configured, the app answered free-form
 * questions with the dumb parser and said nothing, so the only available
 * conclusion was "the chatbot is broken". It was not; it was locked, and the
 * one fact that would have resolved it in a second was the one fact the code
 * threw away. The fallback still happens — an answer beats an error page — but
 * it now arrives carrying its reason.
 */
let lastTransportNote: string | null = null;

export async function askEmitenChat(
  message: string,
  history: ChatTurn[],
  db: MarketDatabase,
  factors: Map<string, FactorSnapshot> | null,
  fundamentals: FundamentalsDatabase | null
): Promise<ChatAnswer> {
  if (chatEndpointAvailable === false) return answerInBrowser(message, db, factors, fundamentals);

  lastTransportNote = null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history: history.slice(-6) }),
      signal: controller.signal,
      // Explicit rather than relying on the same-origin default: the session
      // cookie is what the /api/chat auth gate reads, and the two sibling
      // callers below already say this out loud.
      credentials: 'include',
    });
    clearTimeout(timer);
    if (res.ok) {
      chatEndpointAvailable = true;
      return (await res.json()) as ChatAnswer;
    }
    if (res.status === 404) {
      chatEndpointAvailable = false;
    } else if (res.status === 401) {
      lastTransportNote =
        'Anda belum masuk. Chatbot Claude butuh sesi login — tekan "Masuk" di kanan atas. Jawaban di bawah ini dari mesin lokal yang jauh lebih terbatas.';
    } else {
      const detail = await res
        .json()
        .then((b: { error?: string }) => b?.error)
        .catch(() => null);
      lastTransportNote = `Layanan chat menjawab HTTP ${res.status}${detail ? ` — ${detail}` : ''}. Dijawab mesin lokal.`;
    }
  } catch {
    /* service not running — fall through, silently: this is the expected
       state on a static deploy and saying so on every question is noise. */
  }

  const local = answerInBrowser(message, db, factors, fundamentals);
  if (lastTransportNote) local.note = lastTransportNote;
  return local;
}

/**
 * Every detail field is optional because a signed-out caller gets a deliberately
 * stripped response — `{ accountsExist, locked }` and nothing more. Typing them
 * as required is what let `status.now.phase` reach a `now` that was not there
 * and take the whole page down.
 */
export interface ServiceStatus {
  now?: { date: string; weekday: string; hour: number; minute: number; phase: string };
  next?: { label: string; atWib: string };
  strategy?: string;
  running?: boolean;
  files?: Record<string, { exists: boolean; ageMinutes: number; modified: string | null }>;
  alerts?: { configured: boolean; to: string[]; recipientSource?: string; note: string | null };
  chat?: { claudeEnabled: boolean };
  history?: { at: string; job: string; reason: string; ok: boolean; detail: string }[];
  viewer?: { email: string; name: string; role: string } | null;
  admin?: { email: string; name: string } | null;
  accountsExist?: boolean;
  /** True when accounts exist but nobody is signed in on this browser. */
  locked?: boolean;
}

/** Null when the local service is not running — the app degrades, not breaks. */
export async function fetchServiceStatus(): Promise<ServiceStatus | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch('/api/status', {
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'include',
    });
    clearTimeout(timer);
    // A null return is the whole signal: callers render the degraded state from
    // it. Nothing here may touch `chatEndpointAvailable` — /api/status being
    // absent says nothing about whether /api/chat exists, and on Vercel the
    // answer to those two questions is genuinely different.
    if (res.status === 404) statusEndpointAbsent = true;
    if (!res.ok) return null;
    return (await res.json()) as ServiceStatus;
  } catch {
    return null;
  }
}

export async function triggerRefresh(tier: 'intraday' | 'eod' = 'intraday'): Promise<string> {
  const res = await fetch(`/api/refresh?tier=${tier}`, { method: 'POST', credentials: 'include' });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Refresh gagal');
  return body.detail as string;
}
