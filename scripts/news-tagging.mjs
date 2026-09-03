// Pencocokan judul berita ke kode emiten IDX — logika murni, tanpa I/O.
//
// KENAPA BERKAS SENDIRI. Ia dipisahkan dari ingest-news.mjs pada 2026-09-03
// karena tesnya harus bisa mengimpornya, dan mengimpor skrip ingest berarti
// MENJALANKANNYA: percobaan pertama menarik lima feed RSS dan menimpa news.json
// hanya karena seseorang menjalankan `npm run test`. Penjaga entry-point
// (`import.meta.url === argv[1]`) tidak menolong, karena esbuild membundel
// modulnya menjadi berkas tes itu sendiri sehingga keduanya memang sama.
//
// Aturannya sendiri tidak berubah; komentar di bawah ini pindah utuh.

/**
 * Matching headlines to emiten is where this file can most easily lie, and the
 * first version did, loudly.
 *
 * IDX tickers are four letters, and a great many of them are ordinary words:
 * PADA, NAIK, UANG, BANK, FAST, EAST, RISE, LINK, NINE, BLUE, FUJI. Matching
 * case-insensitively on a standalone token tagged "Fast-fashion giant Shein" as
 * FAST, "Bursa Asia Berguguran ... Kembali Memanas" as PADA, and a story about
 * US mortgage rates as EAST and RISE. Sixty-five percent of the feed came back
 * "about" some Indonesian company. That is worse than no tagging at all,
 * because it looks like a feature.
 *
 * Two rules fix it, and both are about being strict rather than clever:
 *
 *   1. TICKERS ARE MATCHED CASE-SENSITIVELY, in the original text, as a
 *      standalone all-caps token. Real mentions are written "BBRI"; the English
 *      word is written "fast". Case is the signal, and lowercasing the text
 *      before matching throws away the one thing that separates them.
 *
 *   2. COMPANY NAMES MUST APPEAR AS A PHRASE, not as scattered tokens. The old
 *      code reduced "Bank Central Asia Tbk." to the token CENTRAL and tagged
 *      BBCA onto any headline containing that word anywhere. Requiring the
 *      consecutive phrase "BANK CENTRAL ASIA" costs a few real matches
 *      (a headline saying only "Adaro" will be missed) and buys the ability to
 *      trust every match that does appear.
 *
 *   3. ON FOREIGN WIRES, A BARE TICKER IS NOT ENOUGH.
 *
 *      Rule 1 works because ordinary English words are written in lower case.
 *      ACRONYMS ARE NOT, and that is the hole it leaves. "Putin floats 'chance'
 *      at peace with Ukraine as NATO chief warns Russia is becoming
 *      increasingly reckless" was tagged NATO — which really is an IDX ticker,
 *      Olympus Strategic Indonesia Tbk. Case cannot separate those two, because
 *      both are genuinely written NATO.
 *
 *      What separates them is the paper it was printed in. Measured over the
 *      whole feed: of eighteen tickers appearing as all-caps tokens, seventeen
 *      were correct and every one of those came from CNBC Indonesia. The single
 *      wrong one was the single match on a foreign wire. So on a `global` feed
 *      a bare ticker must be corroborated by something Indonesian in the text —
 *      the country, the city, the exchange, the currency, "Tbk". A Reuters story
 *      saying "Indonesia's GOTO plunges" still tags; a story about NATO does not.
 *
 *      The phrase rule is deliberately exempt. "TELKOM INDONESIA" is evidence of
 *      itself no matter who published it.
 */

/**
 * Something that places the story in the Indonesian market.
 *
 * Deliberately broad — it is a corroborating signal, not a filter. Anything
 * that would make a foreign editor write the sentence about Indonesia at all
 * belongs here.
 */
const ID_CUE = /\b(INDONESIA|INDONESIAN|JAKARTA|IDX|IHSG|BEI|RUPIAH|IDR|TBK|EMITEN|BURSA|SAHAM|PERSERO)\b/i;
const NAME_NOISE = /\b(PT|TBK|PERSERO|PERSEROAN|TERBUKA)\b\.?/g;

export function buildMatchers(universe) {
  return universe.map((e) => {
    const phrase = (e.name || '')
      .toUpperCase()
      .replace(/[().,]/g, ' ')
      .replace(NAME_NOISE, ' ')
      .replace(/[^A-Z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // Too short to be distinctive on its own ("MAP", "AKR") — the ticker rule
    // still covers those, and a two-letter phrase would match everything.
    const usable = phrase.length >= 8 ? phrase : '';
    return { code: e.code, phrase: usable };
  });
}

export function tagEmiten(text, matchers, scope = 'indonesia') {
  // Original case preserved for the ticker test; a separate normalised copy for
  // the phrase test, where case genuinely does not matter.
  const spaced = ` ${text.replace(/[^A-Za-z0-9]/g, ' ').replace(/\s+/g, ' ')} `;
  const upper = spaced.toUpperCase();
  const tickerAllowed = scope !== 'global' || ID_CUE.test(text);

  const hits = new Set();
  for (const m of matchers) {
    if (tickerAllowed && spaced.includes(` ${m.code} `)) {
      hits.add(m.code);
      continue;
    }
    if (m.phrase && upper.includes(` ${m.phrase} `)) hits.add(m.code);
  }
  return [...hits].slice(0, 6);
}

