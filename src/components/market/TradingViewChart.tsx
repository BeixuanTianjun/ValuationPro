import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, LineChart, Maximize2, Minimize2 } from 'lucide-react';
import { cx } from '../common/ui';

interface Props {
  /** TradingView symbol, e.g. "IDX:BBCA". */
  symbol: string;
  /**
   * Starting height in px. The widget needs a fixed box — it cannot size to
   * content — so this is a real number, not a CSS rule. 560 is the smallest
   * height at which a daily candle chart with a volume pane and a moving
   * average is actually readable; below about 420 the panes squeeze into a
   * band and the whole thing becomes decorative.
   */
  height?: number;
  interval?: Interval;
  className?: string;
}

type Interval = 'D' | 'W' | '60' | '240';

const INTERVALS: { id: Interval; label: string }[] = [
  { id: '60', label: '1J' },
  { id: '240', label: '4J' },
  { id: 'D', label: 'Harian' },
  { id: 'W', label: 'Mingguan' },
];

/**
 * TradingView advanced-chart embed.
 *
 * WHY EMBED RATHER THAN DRAW. Everything else in this terminal is computed from
 * data we ingested and can reconcile. A candlestick chart with drawing tools,
 * indicators and multiple timeframes is not that — it is a piece of software,
 * and TradingView already covers IDX with it. Rebuilding a worse one would add
 * no traceability and cost the last stage of the watchlist workflow its
 * usefulness.
 *
 * WHAT THIS COSTS, stated plainly because it is the only third-party runtime
 * dependency in the app: the widget loads a script from s3.tradingview.com and
 * renders in an iframe, so TradingView sees that a chart was requested and the
 * chart itself is out of our control. Nothing from this app is sent to them
 * beyond the ticker. If the script is blocked — corporate proxy, ad blocker,
 * offline — the component says so and falls back to a direct link rather than
 * showing an empty box.
 */
export const TradingViewChart: React.FC<Props> = ({ symbol, height = 560, interval = 'D', className }) => {
  const holder = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [tf, setTf] = useState<Interval>(interval);
  const [tall, setTall] = useState(false);

  useEffect(() => {
    const node = holder.current;
    if (!node) return;

    setFailed(false);
    node.innerHTML = '';

    // The embed contract: a container div, then a script tag whose text body is
    // the JSON config. The widget replaces the container's contents on load.
    const container = document.createElement('div');
    container.className = 'tradingview-widget-container__widget';
    container.style.height = '100%';
    node.appendChild(container);

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.async = true;
    script.type = 'text/javascript';
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval: tf,
      timezone: 'Asia/Jakarta',
      theme: 'dark',
      style: '1',
      locale: 'id',
      backgroundColor: 'rgba(2, 6, 23, 1)',
      gridColor: 'rgba(30, 41, 59, 0.6)',
      hide_side_toolbar: false,
      allow_symbol_change: false,
      calendar: false,
      studies: ['STD;MA%1Cross'],
      support_host: 'https://www.tradingview.com',
    });
    script.onerror = () => setFailed(true);
    node.appendChild(script);

    // A blocked script never fires onerror in every browser, so also check
    // whether anything actually rendered.
    const timer = window.setTimeout(() => {
      if (node.querySelector('iframe')) return;
      setFailed(true);
    }, 6000);

    return () => {
      window.clearTimeout(timer);
      node.innerHTML = '';
    };
  }, [symbol, tf]);

  const plain = symbol.replace('IDX:', '');

  return (
    <div className={cx('rounded-xl border border-slate-800 bg-slate-950 overflow-hidden', className)}>
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <LineChart className="w-3.5 h-3.5 shrink-0 text-cyan-400" aria-hidden="true" />
          <span className="truncate text-[11px] font-bold text-slate-200">Chart {plain}</span>
          <span className="hidden text-[10px] text-slate-500 sm:inline">TradingView · {symbol}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <div className="flex overflow-hidden rounded-md border border-slate-700" role="group" aria-label="Rentang waktu">
            {INTERVALS.map((i) => (
              <button
                key={i.id}
                type="button"
                onClick={() => setTf(i.id)}
                aria-pressed={tf === i.id}
                className={cx(
                  'px-2 py-1 text-[10px] font-bold transition-colors cursor-pointer',
                  tf === i.id ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-100'
                )}
              >
                {i.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setTall((v) => !v)}
            title={tall ? 'Perkecil chart' : 'Perbesar chart'}
            className="rounded-md border border-slate-700 p-1.5 text-slate-300 hover:border-cyan-700 hover:text-cyan-300 cursor-pointer"
          >
            {tall ? <Minimize2 className="w-3 h-3" aria-hidden="true" /> : <Maximize2 className="w-3 h-3" aria-hidden="true" />}
          </button>
          <a
            href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-[10px] font-bold text-slate-300 hover:border-cyan-700 hover:text-cyan-300"
          >
            <span className="hidden sm:inline">Buka penuh</span>
            <ExternalLink className="w-2.5 h-2.5" aria-hidden="true" />
          </a>
        </div>
      </div>

      {failed ? (
        <div className="px-4 py-10 text-center">
          <p className="text-xs text-slate-400">Chart TradingView tidak bisa dimuat di browser ini.</p>
          <p className="mt-1 text-[10px] text-slate-500">
            Biasanya karena pemblokir skrip atau proxy jaringan yang menahan s3.tradingview.com.
          </p>
          <a
            href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-[11px] font-bold text-slate-200 hover:bg-slate-700"
          >
            Buka {plain} di TradingView
            <ExternalLink className="w-3 h-3" aria-hidden="true" />
          </a>
        </div>
      ) : (
        <div
          ref={holder}
          className="tradingview-widget-container w-full"
          // `clamp` rather than a bare pixel number so the box scales with the
          // screen: a phone gets ~60% of its viewport, a monitor gets the full
          // height. 560px on an 812px-tall phone leaves nothing but chart and
          // the reader loses everything above and below it; 400px on a monitor
          // squeezes the candle and volume panes into a decorative band.
          style={{ height: `clamp(300px, ${tall ? 88 : 60}vh, ${tall ? Math.round(height * 1.6) : height}px)` }}
        />
      )}
    </div>
  );
};
