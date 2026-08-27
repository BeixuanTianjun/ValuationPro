import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, LineChart } from 'lucide-react';
import { cx } from '../common/ui';

interface Props {
  /** TradingView symbol, e.g. "IDX:BBCA". */
  symbol: string;
  /** Chart height in px. Kept explicit because the widget needs a fixed box. */
  height?: number;
  interval?: 'D' | 'W' | '60' | '240';
  className?: string;
}

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
export const TradingViewChart: React.FC<Props> = ({ symbol, height = 420, interval = 'D', className }) => {
  const holder = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);

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
      interval,
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
  }, [symbol, interval]);

  const plain = symbol.replace('IDX:', '');

  return (
    <div className={cx('rounded-xl border border-slate-800 bg-slate-950 overflow-hidden', className)}>
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <LineChart className="w-3.5 h-3.5 shrink-0 text-cyan-400" aria-hidden="true" />
          <span className="truncate text-[11px] font-bold text-slate-200">Chart {plain}</span>
          <span className="hidden text-[10px] text-slate-500 sm:inline">TradingView · {symbol}</span>
        </div>
        <a
          href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex shrink-0 items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-[10px] font-bold text-slate-300 hover:border-cyan-700 hover:text-cyan-300"
        >
          Buka penuh
          <ExternalLink className="w-2.5 h-2.5" aria-hidden="true" />
        </a>
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
        <div ref={holder} className="tradingview-widget-container w-full" style={{ height }} />
      )}
    </div>
  );
};
