// One memoised loader for the side files under public/data/idx.
//
// WHY THIS EXISTS. `marketRepository` has memoised the core database since it
// was written — `loadMarketDatabase` caches the PROMISE, so two panels mounting
// in the same tick share one download instead of racing. The side files never
// got that treatment, and four components each grew their own copy of the same
// fetch: AnnouncementFeed, StockWatchlist, EventRadar and strategyLab. Measured
// on a single pass through the Market tabs, announcements.json (720 KB) was
// pulled twice and strategies.json four times, and the only reason it was not
// worse is that nobody had added a fifth panel yet.
//
// The URL construction was copied four times too, including the
// `.replace(/\/{2,}/g, '/')` that exists because BASE_URL already ends in a
// slash. A detail duplicated four times is a detail that will be fixed in three
// places the day it turns out to be wrong.
//
// WHAT IS DELIBERATELY NOT CACHED: failures. A rejected or missing file drops
// its entry, so the next panel to mount tries again. Caching the null would
// turn one bad response — a service still starting, a file mid-rewrite by the
// ingest — into a permanent "data belum dibangun" for the rest of the session,
// and the user's only recovery would be a full page reload.
//
// The HTTP layer still sends `cache: 'no-cache'`, so the FIRST read of each
// file per session revalidates against the server exactly as before. What this
// removes is the second, third and fourth read of the same bytes.

// Optional chaining, dan itu bukan kehati-hatian berlebih: `import.meta.env`
// disuntik Vite di browser dan TIDAK ada ketika berkas ini di-bundle untuk
// Node oleh test runner. Tanpa `?.` tesnya mati saat impor dengan pesan yang
// tidak menyebut-nyebut soal environment.
const BASE_URL = (import.meta.env as { BASE_URL?: string } | undefined)?.BASE_URL || '/';
const DATA_BASE = `${BASE_URL}data/idx`.replace(/\/{2,}/g, '/');

const cache = new Map<string, Promise<unknown>>();

/**
 * Read one JSON file from public/data/idx, at most once per session.
 *
 * Resolves to `null` rather than throwing: every caller of these files treats a
 * missing one as "this feed has not been built yet" and renders a note saying
 * so, which is a different thing from an error and is shown differently.
 */
export function loadIdxFile<T>(file: string): Promise<T | null> {
  const hit = cache.get(file);
  if (hit) return hit as Promise<T | null>;

  const p = fetch(`${DATA_BASE}/${file}`, { cache: 'no-cache' })
    .then((res) => (res.ok ? (res.json() as Promise<T>) : null))
    .catch(() => null)
    .then((value) => {
      // Only a successful read is worth keeping. See the note above on why a
      // cached failure is worse than no cache at all.
      if (value === null) cache.delete(file);
      return value;
    });

  cache.set(file, p);
  return p;
}

/**
 * Drop every memoised side file.
 *
 * Called from the market data hook's `reload`, alongside the invalidation of
 * the core database and fundamentals — the point of that button is to re-read
 * what is on disk, and a side file that survived it would make the refresh a
 * half-truth. It is deliberately NOT called from the 45-second live re-quote:
 * that path exists to swap prices in place, and re-downloading 2 MB of filings
 * every 45 seconds to watch a price tick would be worse than the duplication
 * this file was written to remove.
 */
export function invalidateIdxFiles(): void {
  cache.clear();
}
