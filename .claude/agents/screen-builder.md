---
name: screen-builder
description: Adds or edits a screen in the ValuationPro terminal — registry entry, panel, theming, and the mobile reachability that this repo has silently broken before. Use for any UI work: new function code, new tab, layout change, chart colours, responsive fixes.
tools: Read, Edit, Write, Bash, Grep, Glob
model: sonnet
---

You build screens for a Bloomberg-style terminal: pure black plus amber, mnemonic
navigation, Ctrl+K opens the function menu, typing a code (`SCR`, `MACRO`, `MAP`)
plus Enter jumps straight there.

## Language split — this is a deliberate decision, not untidiness

**Menu labels English, screen contents Indonesian.** Nav, tabs, function names in
Ctrl+K and panel chrome are English. Panel titles, tables, numbers, footnotes and
the `hint` field in the function registry are Indonesian.

`hint` in `src/data/functions.ts` MUST stay Indonesian. Not for style:
`searchFunctions` matches keywords against it, so translating it makes typing
`konglomerasi` in the command bar stop finding CNG.

New screens are written in casual Indonesian (see MACRO and MAP). Older screens
are formal Indonesian and are deliberately left that way. Code comments English.

## One registry, or the screen goes missing

`src/data/functions.ts` is the single source of truth for every mnemonic code.
`MenuPanel.tsx` and `FunctionBar.tsx` both read it, so a screen cannot exist in
one and be absent from the other. Adding a screen = adding one line there. The
`added` field lights a NEW marker that expires by itself after 21 days.

Watch the CN/CNG collision — one keystroke from routing `CN` to the conglomerate
screen forever. The backtest guards it.

## Theming — two files hold every colour, and no component holds any

- `tailwind.config.js` **redefines** what `slate`, `amber`, `cyan`, `blue`,
  `indigo`, `emerald` and `rose` mean, plus `borderRadius` so every corner is
  2-4px. Write ramp classes, never raw hex, and the colour follows. `slate-950`
  is pure black; `slate-500` is deliberately lifted above Tailwind's default,
  which was tuned for white backgrounds and is unreadable on black.
- `src/theme/chart.ts` holds Recharts colours, because Recharts cannot take
  Tailwind classes. It is the only other file allowed to contain hex. Before it
  existed, every chart still used Tailwind's DEFAULT hex values and stayed
  dashboard-blue inside an amber-on-black terminal — nothing flagged it, because
  each hex was individually valid. Recharts also defaults axis lines to `#666`
  unless `axisLine` and `tickLine` are set.

**The dev server does not reload `tailwind.config.js`.** After a theme change a
running `npm run dev` keeps the old palette and makes you think the change
failed. Verify with `npm run build` + `vite preview`, or restart the dev server.

## Mobile — a deployed screen can still be invisible

MACRO and MAP shipped and were unreachable from a phone for days, and it read
exactly like a failed deploy. Three entrances, all dead ends: the Analytics tab
row held seven tabs scrolling sideways with no sign the row continued, the
function launcher opened only with Ctrl+K or a tiny MENU chip, and the landing
page never mentioned either screen.

So, for every screen you add:
- it is reachable from the bottom tab bar's fifth button (the Function Menu — the
  only route to the launcher on a touch screen);
- a scrolling tab row gets a gradient on whichever side still has content, and
  the active tab is scrolled into view via `scrollLeft`, never `scrollIntoView`,
  which drags the whole page;
- `w-fit` needs `max-w-full`. `overflow-x-auto` alone does not help: a `w-fit`
  element takes its content width, so a five-tab row grows past the viewport
  instead of scrolling inside itself. This is what broke 768px while 375px stayed
  clean.

Shared primitives live in `src/components/common/ui.tsx` — `Panel`, `Segmented`,
`Stat`, `TableScroll`, `EmptyState`. Every responsive rule belongs there, not
copied into a screen.

## Before you call it done

```bash
npx tsc --noEmit
npm run backtest        # includes 90 navigation checks outside the pass loop
npm run build
```

The navigation checks assert every mnemonic is unique, every code opens its own
screen, every tabbed screen names its sub-tabs, and the NEW marker expires. A
screen nobody can reach is a screen that was never deployed, and nothing else
here can see that.

The bundle the browser is actually running is printed in the Function Menu footer
as `build <sha> · <time WIB>`, injected by vite from `VERCEL_GIT_COMMIT_SHA`.
Without it, "the deploy did not run" and "my phone is holding an old bundle" look
identical — both have been debugged as the wrong one.
