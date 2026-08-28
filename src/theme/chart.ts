// Chart colours, as literal hex — the one place in the app allowed to have any.
//
// WHY THIS FILE EXISTS. The Bloomberg palette is applied by remapping Tailwind's
// ramps in tailwind.config.js, so every component says `text-emerald-400` and
// gets the terminal green. Recharts cannot: it takes colours as props and SVG
// attributes, not as classes. Before this file, every chart carried Tailwind's
// DEFAULT hexes — #3b82f6, #10b981, #0f172a — which stopped being the app's
// colours the moment the ramps were remapped. The charts stayed a web-dashboard
// blue on a terminal that had turned amber-on-black, and nothing flagged it
// because each hex was individually valid.
//
// THE RULE: these values must mirror tailwind.config.js. Changing the theme
// means changing two files, and this is the second one. Any chart colour that
// is not here is a bug.
//
// Recharts also has its own defaults — axis and tick lines come out #666 unless
// told otherwise — so axes must set `axisLine` and `tickLine` explicitly, not
// only `tick`.

export const CHART = {
  /** Hairline rules: grid, axis lines, tooltip borders. slate-800. */
  grid: '#26262c',
  /** Axis labels on a chart that has room for them. slate-400. */
  axis: '#8f8f9c',
  /** Dense tick labels. slate-500. */
  tick: '#74747f',
  /** Secondary axis, deliberately dimmer than the primary. slate-600. */
  tickMuted: '#5a5a64',
  /** Tooltip surface. slate-900 — the panel colour, not pure black. */
  tooltipBg: '#0e0e12',
  /** Tooltip heading. slate-200. */
  tooltipLabel: '#d4d4dc',

  // --- series ---------------------------------------------------------------
  /** Primary series. blue-400. */
  blue: '#4f8ff5',
  /** Up / gains. emerald-400. */
  green: '#22d46f',
  /** Down / losses. rose-400. */
  red: '#ff5b50',
  /** Third series and the LBO accent. indigo-400. */
  violet: '#7d80e8',
  /** The signature — foreign flow, the amber overlay. amber-400. */
  amber: '#ffa733',
  /** Information blue, for the fourth series. cyan-400. */
  cyan: '#5da4ff',
} as const;
