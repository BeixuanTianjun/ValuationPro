// Broker (anggota bursa) activity.
//
// SCOPE — READ THIS BEFORE TRUSTING ANY NUMBER HERE: IDX's public feed reports
// each broker's TOTAL volume, value and trade count per session. It does NOT
// publish the per-stock broker breakdown that bandarmology tools use ("broker
// XL accumulated 40 million BBCA today"). That feed is a commercial IDX Data
// Services product. The `code=` parameter on the public endpoint is silently
// ignored and returns the same market-wide rows, so anything claiming per-stock
// broker attribution from this source would be fabricated.
//
// What the market-wide data does support is a participant-structure read, and
// one number carries most of it: AVERAGE TICKET SIZE = value / trade count.
// A retail-heavy broker prints hundreds of thousands of small tickets; a house
// executing institutional and foreign order flow prints far fewer, far larger
// ones. Tracking how share moves between those two populations says something
// real about who is driving the tape.

export interface BrokerIdentity {
  id: string;
  name: string;
}

export interface RawBrokerSeries {
  v: string; // volume in thousand shares
  t: string; // value in IDR million
  f: string; // trade count
}

export interface BrokersFile {
  generatedAt: string;
  dates: string[];
  latestSession: string;
  brokerCount: number;
  source: string;
  scope: string;
  brokers: BrokerIdentity[];
  series: Record<string, RawBrokerSeries>;
}

export type ParticipantClass = 'ritel' | 'campuran' | 'institusi';

export interface BrokerStat {
  id: string;
  name: string;
  valueIdrBn: number;
  volumeMnShares: number;
  trades: number;
  marketShare: number;
  /** IDR per trade — the retail vs institutional discriminator. */
  averageTicketIdr: number;
  participant: ParticipantClass;
  /** Market share now minus market share over the prior comparable window. */
  shareChange: number;
  /** 20-session average value, for stability. */
  avgValueIdrBn: number;
}

export interface ParticipantSplit {
  participant: ParticipantClass;
  label: string;
  valueIdrBn: number;
  share: number;
  brokers: number;
  trades: number;
  averageTicketIdr: number;
}

export interface BrokerFlowResult {
  session: string;
  windowSessions: number;
  totalValueIdrBn: number;
  totalTrades: number;
  brokers: BrokerStat[];
  participants: ParticipantSplit[];
  /** Herfindahl index of broker value share, 0-1. Higher = more concentrated. */
  concentration: number;
  top10Share: number;
  scope: string;
  gainers: BrokerStat[];
  losers: BrokerStat[];
}

const PARTICIPANT_LABELS: Record<ParticipantClass, string> = {
  ritel: 'Ritel (tiket kecil)',
  campuran: 'Campuran',
  institusi: 'Institusi & asing (tiket besar)',
};

/**
 * Classify by average ticket size.
 *
 * The thresholds are read off the actual distribution on IDX: retail platforms
 * cluster well under Rp 10 juta per trade, institutional houses well above
 * Rp 50 juta. The band between them is genuinely mixed, and is labelled as such
 * rather than being forced into one side.
 */
function classify(averageTicketIdr: number): ParticipantClass {
  if (!Number.isFinite(averageTicketIdr) || averageTicketIdr <= 0) return 'campuran';
  if (averageTicketIdr < 10_000_000) return 'ritel';
  if (averageTicketIdr > 50_000_000) return 'institusi';
  return 'campuran';
}

function decode(csv: string): number[] {
  if (!csv) return [];
  return csv.split(',').map((x) => (x === '' ? NaN : Number(x)));
}

function sumWindow(arr: number[], from: number, to: number): number {
  let s = 0;
  for (let i = Math.max(0, from); i < Math.min(arr.length, to); i++) {
    if (Number.isFinite(arr[i])) s += arr[i];
  }
  return s;
}

export function computeBrokerFlow(file: BrokersFile, windowSessions = 20): BrokerFlowResult {
  const n = file.dates.length;
  const from = Math.max(0, n - windowSessions);
  const priorFrom = Math.max(0, from - windowSessions);

  const decoded = new Map<string, { v: number[]; t: number[]; f: number[] }>();
  for (const b of file.brokers) {
    const raw = file.series[b.id];
    if (!raw) continue;
    decoded.set(b.id, { v: decode(raw.v), t: decode(raw.t), f: decode(raw.f) });
  }

  let totalValueMn = 0;
  let priorTotalValueMn = 0;
  let totalTrades = 0;
  for (const s of decoded.values()) {
    totalValueMn += sumWindow(s.t, from, n);
    priorTotalValueMn += sumWindow(s.t, priorFrom, from);
    totalTrades += sumWindow(s.f, from, n);
  }

  const brokers: BrokerStat[] = [];
  for (const b of file.brokers) {
    const s = decoded.get(b.id);
    if (!s) continue;

    const valueMn = sumWindow(s.t, from, n);
    const trades = sumWindow(s.f, from, n);
    const volumeK = sumWindow(s.v, from, n);
    if (valueMn <= 0 && trades <= 0) continue;

    const share = totalValueMn > 0 ? valueMn / totalValueMn : 0;
    const priorValueMn = sumWindow(s.t, priorFrom, from);
    const priorShare = priorTotalValueMn > 0 ? priorValueMn / priorTotalValueMn : 0;

    // valueMn is IDR million and trades is a raw count, so the ticket is in IDR.
    const averageTicketIdr = trades > 0 ? (valueMn * 1e6) / trades : 0;
    const sessions = n - from || 1;

    brokers.push({
      id: b.id,
      name: b.name,
      valueIdrBn: valueMn / 1e3,
      volumeMnShares: volumeK / 1e3,
      trades,
      marketShare: share,
      averageTicketIdr,
      participant: classify(averageTicketIdr),
      shareChange: priorTotalValueMn > 0 ? share - priorShare : 0,
      avgValueIdrBn: valueMn / 1e3 / sessions,
    });
  }

  brokers.sort((a, b) => b.valueIdrBn - a.valueIdrBn);

  const byClass = new Map<ParticipantClass, ParticipantSplit>();
  for (const cls of ['institusi', 'campuran', 'ritel'] as ParticipantClass[]) {
    byClass.set(cls, {
      participant: cls,
      label: PARTICIPANT_LABELS[cls],
      valueIdrBn: 0,
      share: 0,
      brokers: 0,
      trades: 0,
      averageTicketIdr: 0,
    });
  }
  for (const b of brokers) {
    const entry = byClass.get(b.participant)!;
    entry.valueIdrBn += b.valueIdrBn;
    entry.trades += b.trades;
    entry.brokers++;
  }
  const totalValueBn = totalValueMn / 1e3;
  for (const entry of byClass.values()) {
    entry.share = totalValueBn > 0 ? entry.valueIdrBn / totalValueBn : 0;
    entry.averageTicketIdr = entry.trades > 0 ? (entry.valueIdrBn * 1e9) / entry.trades : 0;
  }

  const concentration = brokers.reduce((s, b) => s + b.marketShare * b.marketShare, 0);
  const top10Share = brokers.slice(0, 10).reduce((s, b) => s + b.marketShare, 0);

  const byShift = [...brokers].filter((b) => b.marketShare > 0.002).sort((a, b) => b.shareChange - a.shareChange);

  return {
    session: file.latestSession,
    windowSessions: n - from,
    totalValueIdrBn: totalValueBn,
    totalTrades,
    brokers,
    participants: [...byClass.values()],
    concentration,
    top10Share,
    scope: file.scope,
    gainers: byShift.slice(0, 6),
    losers: byShift.slice(-6).reverse(),
  };
}
