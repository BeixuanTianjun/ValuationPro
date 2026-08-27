/** @type {import('tailwindcss').Config} */

// Bloomberg palette, applied by REMAPPING Tailwind's ramps rather than by
// editing thirty components.
//
// WHY THIS WAY. Every panel in this app already speaks in `slate-900`,
// `emerald-400`, `rose-400`, `amber-300`. Hand-editing those to new hex values
// would be a thousand-line diff across every screen, and the first missed class
// would show up as a stray blue-grey box on a black terminal. Redefining what
// `slate-900` MEANS changes all of them at once, cannot miss one, and is
// reversible in a single file.
//
// THE MAPPING, and what each ramp is for on a Bloomberg screen:
//
//   slate    the chassis — pure black ground, near-black panels, hairline rules
//   amber    the signature. Input fields, the command line, active state.
//   cyan     information blue: links, tickers, secondary headers
//   blue     the same blue one step deeper, for primary actions
//   indigo   a violet-blue for the third accent (LBO, rotation)
//   emerald  up
//   rose     down
//
// Greys are deliberately lifted from Tailwind's defaults at the 400-600 end.
// Tailwind's slate is tuned for white backgrounds; on pure black its muted
// tones fall below readable contrast, and a terminal is read for hours.

const bloomberg = {
  // --- chassis -------------------------------------------------------------
  slate: {
    50: '#f7f7f9',
    100: '#e9e9ee',
    200: '#d4d4dc',
    300: '#b3b3be',
    400: '#8f8f9c',
    500: '#74747f',
    600: '#5a5a64',
    700: '#3a3a42',
    800: '#26262c',
    900: '#0e0e12',
    950: '#000000',
  },

  // --- the signature -------------------------------------------------------
  amber: {
    50: '#fff8ed',
    100: '#ffeed4',
    200: '#ffd9a1',
    300: '#ffc06a',
    400: '#ffa733',
    500: '#ff9e18',
    600: '#e8850a',
    700: '#b96607',
    800: '#8a4b09',
    900: '#5f350b',
    950: '#331b04',
  },

  // --- information blue ----------------------------------------------------
  cyan: {
    50: '#eff7ff',
    100: '#dcedff',
    200: '#bcdcff',
    300: '#8fc4ff',
    400: '#5da4ff',
    500: '#3d86e8',
    600: '#2c69c4',
    700: '#22539c',
    800: '#1c4076',
    900: '#152e53',
    950: '#0c1a30',
  },
  blue: {
    50: '#eef5ff',
    100: '#d9e8ff',
    200: '#b5d1ff',
    300: '#84b3ff',
    400: '#4f8ff5',
    500: '#2f70d8',
    600: '#2358ad',
    700: '#1c4587',
    800: '#173563',
    900: '#122645',
    950: '#0a1526',
  },
  indigo: {
    50: '#f1f1ff',
    100: '#e2e3ff',
    200: '#c6c8ff',
    300: '#a2a5f8',
    400: '#7d80e8',
    500: '#5f62cc',
    600: '#4a4da6',
    700: '#3b3d82',
    800: '#2e3062',
    900: '#232445',
    950: '#131425',
  },

  // --- direction -----------------------------------------------------------
  emerald: {
    50: '#eafff2',
    100: '#c9ffe0',
    200: '#8ff9bf',
    300: '#4fe999',
    400: '#22d46f',
    500: '#12b257',
    600: '#0c8e45',
    700: '#0a6f37',
    800: '#0a552c',
    900: '#083d21',
    950: '#032112',
  },
  green: {
    400: '#22d46f',
    500: '#12b257',
    600: '#0c8e45',
  },
  rose: {
    50: '#fff0ef',
    100: '#ffdedc',
    200: '#ffbab6',
    300: '#ff8d86',
    400: '#ff5b50',
    500: '#ef3b30',
    600: '#c72c22',
    700: '#9d241c',
    800: '#761d17',
    900: '#4f1611',
    950: '#2a0a07',
  },
  red: {
    400: '#ff5b50',
    500: '#ef3b30',
    600: '#c72c22',
  },
};

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: bloomberg,

      fontFamily: {
        // IBM Plex is the closest widely available face to Bloomberg's own:
        // a neutral grotesque with a matching monospace whose digits are the
        // same width, so a column of prices does not shimmer as it ticks.
        sans: ['"IBM Plex Sans"', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"IBM Plex Mono"', '"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },

      // A terminal is square. Every existing `rounded-2xl` becomes a 4px corner
      // rather than a 16px one, which flips the whole app from "web dashboard"
      // to "trading screen" without touching a component.
      borderRadius: {
        DEFAULT: '2px',
        sm: '1px',
        md: '2px',
        lg: '2px',
        xl: '3px',
        '2xl': '4px',
        '3xl': '6px',
      },
    },
  },
  plugins: [],
};
