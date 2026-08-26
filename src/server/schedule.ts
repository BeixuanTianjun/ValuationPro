// IDX-aware scheduling, expressed in Jakarta wall-clock time.
//
// Everything here is computed from Asia/Jakarta rather than the machine's local
// zone, so the schedule stays correct if the laptop travels or the OS timezone
// is wrong.

export interface WibNow {
  date: string; // YYYY-MM-DD
  weekday: string; // Mon..Sun
  hour: number;
  minute: number;
  minutesOfDay: number;
}

export function wibNow(at: Date = new Date()): WibNow {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hour12: false,
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value])
  ) as Record<string, string>;

  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday,
    hour,
    minute,
    minutesOfDay: hour * 60 + minute,
  };
}

export const isWeekend = (w: WibNow) => w.weekday === 'Sat' || w.weekday === 'Sun';

/**
 * IDX trading holidays, derived by the ingest from sessions that never existed
 * (see meta.json). IDX publishes no machine-readable holiday calendar, so this
 * is the only reliable source — and it is exact for any date already covered by
 * the crawl.
 */
let holidays = new Set<string>();

export function setHolidays(dates: string[]): void {
  holidays = new Set(dates);
}

export const isHoliday = (w: WibNow) => holidays.has(w.date);

/** No trading today: weekend or a public holiday. */
export const isClosedDay = (w: WibNow) => isWeekend(w) || isHoliday(w);

/**
 * IDX trading hours, current regime:
 *   Mon-Thu  Sesi I 09:00-12:00 · Sesi II 13:30-15:49 (closing auction to 16:15)
 *   Fri      Sesi I 09:00-11:30 · Sesi II 14:00-15:49
 *
 * Public holidays come from the derived calendar above, so no job that assumes
 * a live session fires on one.
 */
export function tradingHours(w: WibNow) {
  const friday = w.weekday === 'Fri';
  return {
    open: 9 * 60,
    sesi1End: friday ? 11 * 60 + 30 : 12 * 60,
    sesi2Start: friday ? 14 * 60 : 13 * 60 + 30,
    sesi2End: 16 * 60 + 15,
  };
}

export type Phase = 'weekend' | 'holiday' | 'pre-open' | 'sesi-1' | 'break' | 'sesi-2' | 'closed';

export function phaseOf(w: WibNow): Phase {
  if (isWeekend(w)) return 'weekend';
  if (isHoliday(w)) return 'holiday';
  const h = tradingHours(w);
  if (w.minutesOfDay < h.open) return 'pre-open';
  if (w.minutesOfDay < h.sesi1End) return 'sesi-1';
  if (w.minutesOfDay < h.sesi2Start) return 'break';
  if (w.minutesOfDay < h.sesi2End) return 'sesi-2';
  return 'closed';
}

export type JobId = 'intraday' | 'post-sesi-1' | 'post-close' | 'eod' | 'weekly';

export interface JobDecision {
  id: JobId;
  /** Stable key for "already ran" bookkeeping — one run per key. */
  runKey: string;
  reason: string;
  /** Whether this run should email the digest. */
  sendAlert: boolean;
}

/**
 * Which jobs are due right now, given what has already run.
 *
 * `lastRunKeys` maps a job id to the last runKey it completed, so a job fires
 * at most once per window even though the loop ticks every minute.
 */
export function dueJobs(w: WibNow, lastRunKeys: Partial<Record<JobId, string>>): JobDecision[] {
  const out: JobDecision[] = [];
  const h = tradingHours(w);
  const push = (d: JobDecision) => {
    if (lastRunKeys[d.id] !== d.runKey) out.push(d);
  };

  // The headline requirement: refresh and alert once Sesi I has closed.
  // Five minutes of slack lets the last prints settle before we screen on them.
  if (!isClosedDay(w) && w.minutesOfDay >= h.sesi1End + 5 && w.minutesOfDay < h.sesi2Start) {
    push({
      id: 'post-sesi-1',
      runKey: w.date,
      reason: `Sesi I selesai (${fmtHm(h.sesi1End)} WIB)`,
      sendAlert: true,
    });
  }

  // After the closing auction: the definitive read for the day.
  if (!isClosedDay(w) && w.minutesOfDay >= h.sesi2End + 5) {
    push({
      id: 'post-close',
      runKey: w.date,
      reason: 'Pasar tutup',
      sendAlert: true,
    });
  }

  // Rolling refresh so the open app never drifts far from the tape.
  const phase = phaseOf(w);
  if (phase === 'sesi-1' || phase === 'sesi-2') {
    const bucket = Math.floor(w.minutesOfDay / 15);
    push({
      id: 'intraday',
      runKey: `${w.date}-${bucket}`,
      reason: `Refresh berkala (${phase})`,
      sendAlert: false,
    });
  }

  // IDX publishes end-of-day one to two days late, so we retry twice daily and
  // simply pick up whatever has appeared since.
  if (!isClosedDay(w) && w.minutesOfDay >= 18 * 60 + 30 && w.minutesOfDay < 19 * 60 + 30) {
    push({ id: 'eod', runKey: `${w.date}-sore`, reason: 'Tarik data resmi IDX (sore)', sendAlert: false });
  }
  if (!isWeekend(w) && w.minutesOfDay >= 7 * 60 && w.minutesOfDay < 8 * 60) {
    push({ id: 'eod', runKey: `${w.date}-pagi`, reason: 'Tarik data resmi IDX (pagi)', sendAlert: false });
  }

  // Fundamentals and valuation ratios move slowly; once a week is plenty.
  if (w.weekday === 'Sat' && w.minutesOfDay >= 8 * 60 && w.minutesOfDay < 9 * 60) {
    push({ id: 'weekly', runKey: w.date, reason: 'Perbarui fundamental & rasio valuasi', sendAlert: false });
  }

  return out;
}

export const fmtHm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Human-readable description of the next scheduled milestone. */
export function nextMilestone(w: WibNow): { label: string; atWib: string } {
  const h = tradingHours(w);
  if (isWeekend(w)) return { label: 'Pasar libur akhir pekan — refresh berikutnya Senin pagi', atWib: '07:00' };
  if (isHoliday(w)) return { label: 'Hari libur bursa — tidak ada sesi perdagangan hari ini', atWib: '—' };
  if (w.minutesOfDay < h.open) return { label: 'Pembukaan Sesi I', atWib: fmtHm(h.open) };
  if (w.minutesOfDay < h.sesi1End) return { label: 'Refresh & alert setelah Sesi I', atWib: fmtHm(h.sesi1End + 5) };
  if (w.minutesOfDay < h.sesi2Start) return { label: 'Pembukaan Sesi II', atWib: fmtHm(h.sesi2Start) };
  if (w.minutesOfDay < h.sesi2End) return { label: 'Refresh & alert setelah penutupan', atWib: fmtHm(h.sesi2End + 5) };
  if (w.minutesOfDay < 18 * 60 + 30) return { label: 'Tarik data resmi IDX', atWib: '18:30' };
  return { label: 'Tarik data resmi IDX', atWib: '07:00' };
}
