// Tipe untuk news-tagging.mjs.
//
// Modulnya sendiri JavaScript biasa karena ia dijalankan langsung oleh skrip
// ingest lewat `node`, tanpa langkah kompilasi. Berkas ini ada supaya tesnya
// yang berbahasa TypeScript bisa memanggilnya tanpa `any` — dan supaya urutan
// argumen `tagEmiten` dijaga tipe, karena menukar `matchers` dengan `scope`
// akan menghasilkan daftar kosong, bukan sebuah error.

export interface EmitenMatcher {
  code: string;
  /** Nama perusahaan sebagai frasa berurutan, atau '' kalau terlalu pendek. */
  phrase: string;
}

export function buildMatchers(universe: { code: string; name?: string }[]): EmitenMatcher[];

/**
 * @param scope 'indonesia' untuk feed lokal, 'global' untuk kawat asing.
 *   Pada 'global' sebuah ticker telanjang butuh petunjuk pasar Indonesia di
 *   teksnya sebelum ia dihitung.
 */
export function tagEmiten(text: string, matchers: EmitenMatcher[], scope?: string): string[];
