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
 * Whether the local service answered the last time anything asked.
 *
 * On a static deploy there is no service, and every chat question would
 * otherwise burn a round-trip on a request that is certain to 404 before
 * falling back. Once a probe has established the service is absent, the
 * browser engine answers immediately. `fetchServiceStatus` keeps this fresh,
 * so a service that comes up later is picked up on the next poll.
 */
let serviceAvailable: boolean | null = null;

export const isServiceKnownDown = () => serviceAvailable === false;

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

export async function askEmitenChat(
  message: string,
  history: ChatTurn[],
  db: MarketDatabase,
  factors: Map<string, FactorSnapshot> | null,
  fundamentals: FundamentalsDatabase | null
): Promise<ChatAnswer> {
  if (serviceAvailable === false) return answerInBrowser(message, db, factors, fundamentals);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history: history.slice(-6) }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      serviceAvailable = true;
      return (await res.json()) as ChatAnswer;
    }
    if (res.status === 404) serviceAvailable = false;
  } catch {
    /* service not running — fall through */
  }
  return answerInBrowser(message, db, factors, fundamentals);
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
    if (!res.ok) {
      serviceAvailable = false;
      return null;
    }
    serviceAvailable = true;
    return (await res.json()) as ServiceStatus;
  } catch {
    serviceAvailable = false;
    return null;
  }
}

export async function triggerRefresh(tier: 'intraday' | 'eod' = 'intraday'): Promise<string> {
  const res = await fetch(`/api/refresh?tier=${tier}`, { method: 'POST', credentials: 'include' });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Refresh gagal');
  return body.detail as string;
}
