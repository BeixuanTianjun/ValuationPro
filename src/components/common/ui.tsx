// Shared UI primitives.
//
// Every surface in the terminal is built from these, for one reason: a trading
// screen is read by scanning, and scanning only works when the same kind of
// thing looks the same everywhere. Before this file each panel invented its own
// padding, radius and border, and the eye had to re-learn the layout in every
// tab.
//
// RESPONSIVE RULES ENCODED HERE, so no caller has to remember them:
//   · Nothing is allowed to force the page to scroll sideways. Wide content
//     scrolls inside its own container (`TableScroll`), never the body.
//   · Tap targets are at least 40px on touch. `Segmented` and `Toolbar` size
//     themselves up on coarse pointers.
//   · Dense tables collapse to stacked cards below `md`, because a 9-column
//     table on a 390px screen is unreadable at any font size.

import React from 'react';

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

interface PanelProps {
  children: React.ReactNode;
  className?: string;
  /** `flat` drops the gradient — use inside another panel. */
  tone?: 'raised' | 'flat' | 'accent';
  padded?: boolean;
  as?: 'div' | 'section' | 'article';
}

export const Panel: React.FC<PanelProps> = ({ children, className, tone = 'raised', padded = true, as = 'section' }) => {
  const Tag = as;
  return (
    <Tag
      className={cx(
        'rounded-xl sm:rounded-2xl border overflow-hidden',
        tone === 'raised' && 'border-slate-800 bg-slate-900',
        tone === 'flat' && 'border-slate-800 bg-slate-950',
        tone === 'accent' && 'border-amber-800/60 bg-slate-900',
        padded && 'p-4 sm:p-5',
        className
      )}
    >
      {children}
    </Tag>
  );
};

interface PanelHeaderProps {
  icon?: React.ElementType;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  tone?: string;
}

export const PanelHeader: React.FC<PanelHeaderProps> = ({ icon: Icon, title, subtitle, actions, tone = 'text-amber-400' }) => (
  <div className="flex flex-col gap-3 border-b border-slate-800 pb-3 sm:flex-row sm:items-start sm:justify-between">
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        {Icon && <Icon className={cx('w-3.5 h-3.5 shrink-0', tone)} aria-hidden="true" />}
        <h3 className="truncate text-[12px] font-bold uppercase tracking-wider text-slate-100">{title}</h3>
      </div>
      {subtitle && <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">{subtitle}</p>}
    </div>
    {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
  </div>
);

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export interface SegmentedOption<T extends string> {
  id: T;
  label: string;
  shortLabel?: string;
  icon?: React.ElementType;
  badge?: string | number | null;
  /** Mark a recently added tab with a dot, so a phone user notices it exists. */
  isNew?: boolean;
}

interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
  /** Tailwind classes applied to the active pill. */
  activeClass?: string;
  size?: 'sm' | 'md';
  /** Stretch each option to an equal share of the row. */
  fill?: boolean;
  className?: string;
}

/**
 * The one tab control.
 *
 * It scrolls horizontally rather than wrapping, with the scroll contained.
 * Wrapping tab rows reflow the whole page every time a label changes length,
 * which on a live terminal is constantly.
 *
 * TWO THINGS MAKE THE SCROLL HONEST, and both were missing while the comment
 * above already claimed them. A seven-tab row on a 390px phone shows four; the
 * rest are off-screen with nothing on screen saying so, which is how a shipped
 * screen can be invisible to the person who asked for it. So: a fade on
 * whichever edge still has content behind it, and the active tab scrolled into
 * view — jumping to a function from the launcher used to leave its tab
 * highlighted somewhere past the right edge.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  activeClass = 'bg-cyan-600 text-white shadow-md shadow-cyan-900/40',
  size = 'md',
  fill = false,
  className,
}: SegmentedProps<T>) {
  const navRef = React.useRef<HTMLElement | null>(null);
  const activeRef = React.useRef<HTMLButtonElement | null>(null);
  const [edges, setEdges] = React.useState({ left: false, right: false });

  const measure = React.useCallback(() => {
    const el = navRef.current;
    if (!el) return;
    const slack = el.scrollWidth - el.clientWidth;
    // 2px of slack is sub-pixel rounding, not content.
    setEdges({ left: el.scrollLeft > 2, right: slack - el.scrollLeft > 2 });
  }, []);

  React.useEffect(() => {
    measure();
    const el = navRef.current;
    if (!el) return;
    // ResizeObserver rather than a window listener: the row also changes width
    // when a sibling panel appears, which no resize event reports.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [measure, options.length]);

  React.useEffect(() => {
    const el = navRef.current;
    const btn = activeRef.current;
    if (el && btn) {
      // Deliberately NOT scrollIntoView: that scrolls every scrollable ancestor,
      // so arriving at a function from the launcher would also yank the page
      // itself. Nudging the row's own scrollLeft cannot move anything else.
      const b = btn.getBoundingClientRect();
      const n = el.getBoundingClientRect();
      if (b.left < n.left) el.scrollBy({ left: b.left - n.left - 12, behavior: 'smooth' });
      else if (b.right > n.right) el.scrollBy({ left: b.right - n.right + 12, behavior: 'smooth' });
    }
    measure();
  }, [value, measure]);

  return (
    <div className={cx('relative -mx-1 min-w-0 max-w-full px-1', className)}>
      {edges.left && (
        <span
          className="pointer-events-none absolute inset-y-0 left-1 z-10 w-6 rounded-l-xl bg-gradient-to-r from-slate-950 to-transparent"
          aria-hidden="true"
        />
      )}
      {edges.right && (
        <span
          className="pointer-events-none absolute inset-y-0 right-1 z-10 w-6 rounded-r-xl bg-gradient-to-l from-slate-950 to-transparent"
          aria-hidden="true"
        />
      )}
      <nav
        ref={navRef}
        onScroll={measure}
        aria-label={ariaLabel}
        className={cx(
          'flex gap-1 rounded-xl border border-slate-800 bg-slate-900 p-1 sm:p-1.5',
          'overflow-x-auto scrollbar-thin snap-x',
          // max-w-full matters as much as the overflow rule: a `w-fit` bar sizes
          // to its content, and without the clamp a five-tab row simply grows
          // past the viewport instead of scrolling inside itself.
          fill ? 'w-full' : 'w-full max-w-full sm:w-fit'
        )}
      >
        {options.map(({ id, label, shortLabel, icon: Icon, badge, isNew }) => {
          const on = value === id;
          return (
            <button
              key={id}
              type="button"
              ref={on ? activeRef : undefined}
              onClick={() => onChange(id)}
              aria-current={on ? 'page' : undefined}
              className={cx(
                'flex items-center justify-center gap-1.5 sm:gap-2 rounded-lg font-bold whitespace-nowrap snap-start',
                'transition-colors duration-200 cursor-pointer touch-target',
                fill && 'flex-1',
                size === 'sm' ? 'px-2.5 py-2 text-[11px]' : 'px-3 sm:px-4 py-2 text-[11px] sm:text-xs',
                on ? activeClass : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
              )}
            >
              {Icon && <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
              <span className={shortLabel ? 'hidden sm:inline' : undefined}>{label}</span>
              {shortLabel && <span className="sm:hidden">{shortLabel}</span>}
              {badge != null && badge !== '' && (
                <span className="ml-0.5 rounded bg-black/25 px-1.5 py-0.5 text-[10px] tabular-nums">{badge}</span>
              )}
              {isNew && !on && (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-label="baru" />
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

interface StatProps {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: 'neutral' | 'up' | 'down' | 'accent' | 'warn';
  icon?: React.ElementType;
  className?: string;
}

const TONE_TEXT: Record<string, string> = {
  neutral: 'text-slate-100',
  up: 'text-emerald-400',
  down: 'text-rose-400',
  accent: 'text-amber-400',
  warn: 'text-amber-300',
};

export const Stat: React.FC<StatProps> = ({ label, value, hint, tone = 'neutral', icon: Icon, className }) => (
  <div className={cx('min-w-0 rounded-xl border border-slate-800 bg-slate-950 p-3 sm:p-3.5', className)}>
    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
      {Icon && <Icon className="w-3 h-3 shrink-0" aria-hidden="true" />}
      <span className="truncate">{label}</span>
    </div>
    <div className={cx('mt-1.5 text-lg font-bold leading-tight tabular-nums sm:text-xl', TONE_TEXT[tone])}>
      {value}
    </div>
    {hint && <div className="mt-1 text-[10px] leading-snug text-slate-500">{hint}</div>}
  </div>
);

/** A responsive grid of Stat tiles: 2 up on phones, 4 on desktop. */
export const StatGrid: React.FC<{ children: React.ReactNode; cols?: 2 | 3 | 4; className?: string }> = ({
  children,
  cols = 4,
  className,
}) => (
  <div
    className={cx(
      'grid gap-2.5 sm:gap-3 grid-cols-2',
      cols === 3 && 'lg:grid-cols-3',
      cols === 4 && 'md:grid-cols-4',
      className
    )}
  >
    {children}
  </div>
);

interface PillProps {
  children: React.ReactNode;
  tone?: 'neutral' | 'up' | 'down' | 'accent' | 'warn' | 'muted';
  className?: string;
  title?: string;
}

const PILL_TONE: Record<string, string> = {
  neutral: 'bg-slate-800 text-slate-300 border-slate-700',
  up: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  down: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  accent: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  warn: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  muted: 'bg-slate-900 text-slate-500 border-slate-800',
};

export const Pill: React.FC<PillProps> = ({ children, tone = 'neutral', className, title }) => (
  <span
    title={title}
    className={cx(
      'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap',
      PILL_TONE[tone],
      className
    )}
  >
    {children}
  </span>
);

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/**
 * Horizontal scroll container for a wide table.
 *
 * The negative margin lets the scroll region run to the panel edge so the
 * cut-off column is visibly cut off, rather than appearing to be the last one.
 */
export const TableScroll: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={cx('-mx-4 sm:-mx-5 overflow-x-auto scrollbar-thin', className)}>
    <div className="min-w-full px-4 sm:px-5 inline-block align-middle">{children}</div>
  </div>
);

export const Th: React.FC<{
  children?: React.ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
  sticky?: boolean;
  onClick?: () => void;
  title?: string;
}> = ({ children, align = 'right', className, sticky, onClick, title }) => (
  <th
    onClick={onClick}
    title={title}
    scope="col"
    className={cx(
      'whitespace-nowrap px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500',
      align === 'left' && 'text-left',
      align === 'right' && 'text-right',
      align === 'center' && 'text-center',
      sticky && 'sticky left-0 z-10 bg-slate-900',
      onClick && 'cursor-pointer hover:text-slate-300 select-none',
      className
    )}
  >
    {children}
  </th>
);

export const Td: React.FC<{
  children?: React.ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
  sticky?: boolean;
  colSpan?: number;
}> = ({ children, align = 'right', className, sticky, colSpan }) => (
  <td
    colSpan={colSpan}
    className={cx(
      'py-2.5 px-2 whitespace-nowrap sm:py-2',
      align === 'left' && 'text-left',
      align === 'right' && 'text-right tabular-nums',
      align === 'center' && 'text-center',
      sticky && 'sticky left-0 z-10 bg-slate-900/95 backdrop-blur-sm',
      className
    )}
  >
    {children}
  </td>
);

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export const EmptyState: React.FC<{
  icon?: React.ElementType;
  title: string;
  children?: React.ReactNode;
  tone?: 'neutral' | 'warn' | 'error';
}> = ({ icon: Icon, title, children, tone = 'neutral' }) => (
  <div
    className={cx(
      'rounded-2xl border p-6 sm:p-8 text-center',
      tone === 'neutral' && 'border-slate-800 bg-slate-900',
      tone === 'warn' && 'border-amber-900/50 bg-amber-950/10',
      tone === 'error' && 'border-rose-900/50 bg-rose-950/10'
    )}
  >
    {Icon && (
      <Icon
        className={cx(
          'w-7 h-7 mx-auto mb-3',
          tone === 'neutral' && 'text-slate-500',
          tone === 'warn' && 'text-amber-400',
          tone === 'error' && 'text-rose-400'
        )}
        aria-hidden="true"
      />
    )}
    <div className="text-sm font-bold text-white">{title}</div>
    {children && <div className="mt-2 text-xs leading-relaxed text-slate-400">{children}</div>}
  </div>
);

export const Spinner: React.FC<{ label?: string }> = ({ label }) => (
  <div className="flex flex-col items-center justify-center gap-3 py-16 sm:py-24">
    <div className="relative w-12 h-12 rounded-2xl border border-slate-800 bg-slate-900 grid place-items-center overflow-hidden">
      <div className="w-5 h-5 rounded-full border-2 border-slate-700 border-t-cyan-400 animate-spin" />
      <div className="absolute inset-0 pointer-events-none">
        <div className="h-full w-8 bg-gradient-to-r from-transparent via-cyan-500/15 to-transparent animate-sweep" />
      </div>
    </div>
    {label && <div className="text-xs text-slate-400">{label}</div>}
  </div>
);

/**
 * A caveat the app owes the reader.
 *
 * Used wherever the data cannot answer the question fully — a monthly feed
 * being asked for a daily read, a category aggregate standing in for a named
 * holder. It is deliberately not dismissible.
 */
export const SourceNote: React.FC<{ children: React.ReactNode; icon?: React.ElementType }> = ({
  children,
  icon: Icon,
}) => (
  <div className="flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2.5 text-[10px] leading-relaxed text-slate-500">
    {Icon && <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-600" aria-hidden="true" />}
    <div className="min-w-0">{children}</div>
  </div>
);
