// The function registry — what a Bloomberg mnemonic is, for this terminal.
//
// WHY CODES AT ALL. Bloomberg's defining interaction is not its colour scheme,
// it is that every screen has a short name you can type. `DES <GO>` is faster
// than finding a tab, it is the same keystroke on every machine, and it turns a
// menu of twelve things into a thing you already know. Copying the amber-on-
// black without copying that would be copying the costume.
//
// The codes below are deliberately short, unique on their first two letters
// where possible, and mostly the real Bloomberg mnemonics for the equivalent
// function (DES for a company description, MOST for movers, CN for news) so
// muscle memory transfers for anyone who has used the real thing.
//
// Adding a screen means adding a row here. The menu panel, the command line and
// the function bar all read from this one list, so a screen cannot exist in the
// launcher and be missing from the command line.

export type FunctionArea = 'market' | 'analytics' | 'dcf' | 'lbo';

export interface TerminalFunction {
  /** The mnemonic the user types. Upper case, 2-5 letters. */
  code: string;
  name: string;
  /** One line, written for someone deciding whether to open it. */
  hint: string;
  group: string;
  area: FunctionArea;
  /** Sub-tab within the area, when the area has one. */
  sub?: string;
  /** Tailwind text colour for the code chip. */
  tone: string;
  /**
   * ISO date the screen shipped. Drives the NEW flag in the launcher, which
   * expires on its own after NEW_FOR_DAYS — a badge that has to be removed by
   * hand is a badge that stays on screen for a year.
   */
  added?: string;
}

export const TERMINAL_FUNCTIONS: TerminalFunction[] = [
  // --- market
  {
    code: 'MKT',
    name: 'Market Overview',
    hint: 'IHSG, 45 indeks, breadth, dan penggerak poin indeks hari ini.',
    group: 'Market',
    area: 'market',
    sub: 'overview',
    tone: 'text-emerald-300',
  },
  {
    code: 'SCR',
    name: 'Stock Screener',
    hint: 'Tiga aturan keras: di atas MA3 & MA5, volume > 1 juta lembar, nilai > Rp 1 miliar.',
    group: 'Market',
    area: 'market',
    sub: 'screener',
    tone: 'text-emerald-300',
  },
  {
    code: 'WL',
    name: 'Stock Watchlist',
    hint: 'Corong empat tahap: narasi, rotasi konglomerasi, price action, chart.',
    group: 'Market',
    area: 'market',
    sub: 'watchlist',
    tone: 'text-emerald-300',
  },
  {
    // CN is Bloomberg's own mnemonic for company news, and the registry note
    // above cites it. It collides with CNG on the first two letters, which the
    // search resolves the way a terminal should: an exact code match outranks a
    // prefix match, so `CN` opens this and `CNG` opens the conglomerate screen.
    code: 'CN',
    name: 'Company Disclosures',
    hint: 'Arsip pengajuan resmi emiten ke bursa, dikategorikan; PDF asli satu klik.',
    group: 'Market',
    area: 'market',
    sub: 'news',
    tone: 'text-emerald-300',
    added: '2026-08-28',
  },
  {
    code: 'DES',
    name: 'Company Database',
    hint: 'Profil, harga, faktor, dan laporan keuangan 962 emiten tercatat.',
    group: 'Market',
    area: 'market',
    sub: 'emiten',
    tone: 'text-emerald-300',
  },
  {
    code: 'CHAT',
    name: 'Ask a Company',
    hint: 'Tanya dalam bahasa Indonesia; bisa langsung membedah satu emiten.',
    group: 'Market',
    area: 'market',
    sub: 'chat',
    tone: 'text-indigo-300',
  },

  // --- analytics
  {
    code: 'MOST',
    name: 'Leaders & Laggards',
    hint: 'Kontribusi poin indeks per emiten, direkonsiliasi ke IHSG.',
    group: 'Analytics',
    area: 'analytics',
    sub: 'leaders',
    tone: 'text-cyan-300',
  },
  {
    code: 'CNG',
    name: 'Conglomerate Rotation',
    hint: '31 grup pengendali, papan pemimpin, dan kohesi terukur tiap grup.',
    group: 'Analytics',
    area: 'analytics',
    sub: 'conglo',
    tone: 'text-cyan-300',
  },
  {
    code: 'FUND',
    name: 'Mutual Fund Tracker',
    hint: 'Register kepemilikan KSEI: institusi vs ritel, 24 bulan ke belakang.',
    group: 'Analytics',
    area: 'analytics',
    sub: 'funds',
    tone: 'text-cyan-300',
  },
  {
    code: 'MACRO',
    name: 'Global Drivers',
    hint: 'Kurs, komoditas, indeks global, bunga, kripto — dan seberapa nempel ke tiap sektor IDX.',
    group: 'Analytics',
    area: 'analytics',
    sub: 'macro',
    tone: 'text-cyan-300',
    added: '2026-08-28',
  },
  {
    code: 'MAP',
    name: 'Chokepoint Map',
    hint: 'Tanker per hari di 28 selat kunci, 5 di antaranya perairan kita, plus alert yang bikin pelabuhan tutup.',
    group: 'Analytics',
    area: 'analytics',
    sub: 'map',
    tone: 'text-cyan-300',
    added: '2026-08-28',
  },
  {
    code: 'BRK',
    name: 'Broker Summary',
    hint: 'Aktivitas 88 anggota bursa dan struktur transaksi per emiten.',
    group: 'Analytics',
    area: 'analytics',
    sub: 'broker',
    tone: 'text-cyan-300',
  },
  {
    code: 'AVAL',
    name: 'Auto Valuation',
    hint: 'DCF massal atas seluruh emiten berlaporan keuangan. Penyaring, bukan valuasi.',
    group: 'Analytics',
    area: 'analytics',
    sub: 'valuation',
    tone: 'text-cyan-300',
  },

  // --- models
  {
    code: 'DCF',
    name: 'Model DCF',
    hint: 'Arus kas bebas unlevered, WACC, jembatan EV ke ekuitas, sensitivitas.',
    group: 'Models',
    area: 'dcf',
    tone: 'text-blue-300',
  },
  {
    code: 'LBO',
    name: 'Model LBO',
    hint: 'Struktur transaksi, air terjun utang, IRR sponsor, matriks sensitivitas.',
    group: 'Models',
    area: 'lbo',
    tone: 'text-indigo-300',
  },
];

export const FUNCTION_GROUPS = ['Market', 'Analytics', 'Models'];

/** How long a screen carries the NEW flag after it ships. */
export const NEW_FOR_DAYS = 21;

/**
 * Did this screen ship recently enough to still be worth pointing at?
 *
 * A new screen is invisible by construction here: the launcher lists twelve
 * functions in a fixed order and the analytics tab row scrolls sideways on a
 * phone, so anything added at the end lands off-screen. The flag is the one
 * thing that says "this row is not where you left it last week".
 */
export function isRecentlyAdded(fn: TerminalFunction, now: Date = new Date()): boolean {
  if (!fn.added) return false;
  const t = Date.parse(fn.added);
  if (Number.isNaN(t)) return false;
  const days = (now.getTime() - t) / 86_400_000;
  return days >= 0 && days <= NEW_FOR_DAYS;
}

/** Sub-tab ids in one area that are still flagged new, for the tab rows. */
export function recentSubs(area: FunctionArea, now: Date = new Date()): Set<string> {
  return new Set(
    recentFunctions(now)
      .filter((f) => f.area === area && f.sub)
      .map((f) => f.sub as string)
  );
}

/** The recently-shipped screens, newest first. Empty once they all age out. */
export function recentFunctions(now: Date = new Date()): TerminalFunction[] {
  return TERMINAL_FUNCTIONS.filter((f) => isRecentlyAdded(f, now)).sort((a, b) =>
    (b.added ?? '').localeCompare(a.added ?? '')
  );
}

export function findFunction(query: string): TerminalFunction | null {
  const q = query.trim().toUpperCase();
  if (!q) return null;
  return (
    TERMINAL_FUNCTIONS.find((f) => f.code === q) ??
    TERMINAL_FUNCTIONS.find((f) => f.code.startsWith(q)) ??
    null
  );
}

/** Fuzzy-ish search across code, name and hint, ranked so codes win. */
export function searchFunctions(query: string): TerminalFunction[] {
  const q = query.trim().toUpperCase();
  if (!q) return TERMINAL_FUNCTIONS;
  const scored = TERMINAL_FUNCTIONS.map((f) => {
    let score = 0;
    if (f.code === q) score = 100;
    else if (f.code.startsWith(q)) score = 80;
    else if (f.name.toUpperCase().startsWith(q)) score = 60;
    else if (f.name.toUpperCase().includes(q)) score = 40;
    else if (f.hint.toUpperCase().includes(q)) score = 20;
    return { f, score };
  }).filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.map((x) => x.f);
}
