// What the browser is actually running.
//
// The values are substituted by vite at build time (see `define` in
// vite.config.ts), so they describe the BUNDLE, not the repository — which is
// the whole point. A phone showing an old commit here is a caching or
// deployment problem; a phone showing the newest commit while a screen is
// missing is a code problem. Before this existed the two were indistinguishable
// and both got debugged as the wrong one.

declare const __BUILD_SHA__: string;
declare const __BUILD_REF__: string;
declare const __BUILD_AT__: string;

export const BUILD_SHA = __BUILD_SHA__;
export const BUILD_REF = __BUILD_REF__;
export const BUILD_AT = __BUILD_AT__;

/** `28 Agu 18:20 WIB` — the build time in the only timezone this app cares about. */
export function buildTimeWib(): string {
  const t = new Date(BUILD_AT);
  if (Number.isNaN(t.getTime())) return 'tidak diketahui';
  return `${t.toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })} WIB`;
}
