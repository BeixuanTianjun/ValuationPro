/**
 * ingest-news.mjs — a real-time financial newswire and a forward economic
 * calendar, for the screen that replaced Country Risk.
 *
 *   node scripts/ingest-news.mjs [--keep 120]
 *
 * WHY THIS REPLACED COUNTRY RISK. That screen scored Indonesia on conflict
 * tone, earthquakes and sanctions and then told you the score was probably
 * meaningless. It was right about that, which is the problem: a panel whose own
 * caption says to ignore it is taking up a tab. What a trader actually opens a
 * terminal for at 08:30 is what happened overnight and what prints today.
 *
 * SOURCES, all free, unauthenticated, and public RSS/JSON:
 *
 *   WSJ Markets            feeds.a.dj.com                  markets, macro
 *   CNBC Finance           cnbc.com RSS                    US market news
 *   Yahoo Finance          finance.yahoo.com/news/rssindex broad wire
 *   Investing.com          investing.com/rss/news.rss      global macro
 *   CNBC Indonesia         cnbcindonesia.com RSS           domestic
 *   ForexFactory calendar  nfs.faireconomy.media JSON      this week's releases,
 *                                                          with impact, forecast
 *                                                          and previous
 *
 * BLOOMBERG IS ABSENT ON PURPOSE. Bloomberg killed its public RSS years ago and
 * its terminal feed is licensed per seat; there is no free endpoint to read, and
 * scraping bloomberg.com is both blocked and against its terms. Financial Juice
 * is the same story — its value IS the paid squawk. Rather than pretend, the
 * screen names the wires it actually reads. WSJ and CNBC cover most of what a
 * Bloomberg headline feed would carry anyway.
 *
 * WHAT "REALTIME" HONESTLY MEANS HERE. RSS updates on the publisher's schedule,
 * typically every few minutes. This script is cheap enough to run on the
 * intraday cycle, so the feed is minutes old, not seconds. The UI prints the
 * fetch time so nobody has to guess.
 *
 * IDX TAGGING. Every headline is matched against the emiten universe by ticker
 * and by company name, so a Reuters story about Adaro surfaces under ADRO. The
 * match is deliberately conservative — a bare four-letter ticker inside prose
 * produces too many false hits, so a ticker only counts when it stands alone in
 * caps or the company's distinctive name appears.
 *
 * Writes public/data/idx/news.json
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'data', 'idx');

const argv = process.argv.slice(2);
const argVal = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const KEEP = Number(argVal('--keep', 120));

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const log = (...a) => console.log(`[news ${new Date().toISOString().slice(11, 19)}]`, ...a);

const FEEDS = [
  { id: 'wsj', name: 'WSJ Markets', url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml', scope: 'global' },
  { id: 'cnbc', name: 'CNBC Finance', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', scope: 'global' },
  { id: 'yahoo', name: 'Yahoo Finance', url: 'https://finance.yahoo.com/news/rssindex', scope: 'global' },
  { id: 'investing', name: 'Investing.com', url: 'https://www.investing.com/rss/news.rss', scope: 'global' },
  { id: 'cnbcid', name: 'CNBC Indonesia', url: 'https://www.cnbcindonesia.com/market/rss', scope: 'indonesia' },
];

const CALENDAR_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

function curl(args) {
  return new Promise((resolve, reject) => {
    execFile('curl', args, { maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

const get = (url) => curl(['-s', '-L', '-m', '40', '-A', UA, url]);

// ─────────────────────────────────────────────────────────────────── RSS ──

const decodeEntities = (s) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();

const stripTags = (s) => decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decodeEntities(m[1]) : '';
};

/**
 * Both RSS 2.0 (<item>) and Atom (<entry>) appear across these publishers, and
 * the difference is not cosmetic: Atom puts the link in an attribute, not in
 * element text. Handling only <item> silently produced entries with empty URLs.
 */
function parseFeed(xml) {
  const out = [];
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  for (const b of blocks) {
    const title = stripTags(tag(b, 'title'));
    if (!title) continue;

    let link = stripTags(tag(b, 'link'));
    if (!link) {
      const href = b.match(/<link[^>]*href=["']([^"']+)["']/i);
      if (href) link = decodeEntities(href[1]);
    }

    const published =
      tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date') || '';
    const ts = published ? Date.parse(published) : NaN;

    out.push({
      title,
      url: link,
      summary: stripTags(tag(b, 'description') || tag(b, 'summary')).slice(0, 320),
      publishedAt: Number.isFinite(ts) ? new Date(ts).toISOString() : null,
    });
  }
  return out;
}

// ──────────────────────────────────────────────────────────── IDX tagging ──

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
 */
const NAME_NOISE = /\b(PT|TBK|PERSERO|PERSEROAN|TERBUKA)\b\.?/g;

function buildMatchers(universe) {
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

function tagEmiten(text, matchers) {
  // Original case preserved for the ticker test; a separate normalised copy for
  // the phrase test, where case genuinely does not matter.
  const spaced = ` ${text.replace(/[^A-Za-z0-9]/g, ' ').replace(/\s+/g, ' ')} `;
  const upper = spaced.toUpperCase();

  const hits = new Set();
  for (const m of matchers) {
    if (spaced.includes(` ${m.code} `)) {
      hits.add(m.code);
      continue;
    }
    if (m.phrase && upper.includes(` ${m.phrase} `)) hits.add(m.code);
  }
  return [...hits].slice(0, 6);
}

// ────────────────────────────────────────────────────────────── calendar ──

/** ForexFactory impact strings → the three levels the UI colours. */
const IMPACT = { High: 'tinggi', Medium: 'sedang', Low: 'rendah', Holiday: 'libur' };

async function fetchCalendar() {
  try {
    const raw = JSON.parse(await get(CALENDAR_URL));
    if (!Array.isArray(raw)) throw new Error('bentuk tak terduga');
    return raw
      .map((r) => {
        const ts = Date.parse(r.date);
        return {
          title: String(r.title || '').trim(),
          country: String(r.country || '').trim(),
          at: Number.isFinite(ts) ? new Date(ts).toISOString() : null,
          impact: IMPACT[r.impact] || 'rendah',
          forecast: String(r.forecast ?? '').trim(),
          previous: String(r.previous ?? '').trim(),
        };
      })
      .filter((r) => r.title && r.at)
      .sort((a, b) => a.at.localeCompare(b.at));
  } catch (err) {
    log(`!! kalender ekonomi gagal: ${err.message}`);
    return [];
  }
}

// ────────────────────────────────────────────────────────────────── main ──

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  let universe = [];
  try {
    universe = JSON.parse(await readFile(join(OUT_DIR, 'universe.json'), 'utf8')).emiten || [];
  } catch {
    log('!! universe.json belum ada — berita tidak akan ditandai kode emiten');
  }
  const matchers = buildMatchers(universe);

  const failed = [];
  const settled = await Promise.all(
    FEEDS.map(async (f) => {
      try {
        const xml = await get(f.url);
        const items = parseFeed(xml);
        if (!items.length) throw new Error('tidak ada item terbaca');
        log(`${f.name}: ${items.length} berita`);
        return items.map((it) => ({
          ...it,
          source: f.name,
          sourceId: f.id,
          scope: f.scope,
          emiten: tagEmiten(`${it.title} ${it.summary}`, matchers),
        }));
      } catch (err) {
        log(`!! ${f.name} gagal: ${err.message}`);
        failed.push({ id: f.id, name: f.name, why: err.message.slice(0, 140) });
        return [];
      }
    })
  );

  // De-duplicate on URL first, then on title: the same wire story reaches two
  // aggregators under different links, and showing it twice makes the feed look
  // busier than the news actually is.
  const seenUrl = new Set();
  const seenTitle = new Set();
  const items = [];
  for (const it of settled.flat()) {
    const keyU = (it.url || '').split('?')[0];
    const keyT = it.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 70);
    if (keyU && seenUrl.has(keyU)) continue;
    if (seenTitle.has(keyT)) continue;
    if (keyU) seenUrl.add(keyU);
    seenTitle.add(keyT);
    items.push(it);
  }

  items.sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
  const kept = items.slice(0, KEEP);

  const calendar = await fetchCalendar();
  log(`kalender ekonomi: ${calendar.length} agenda minggu ini`);

  const payload = {
    generatedAt: new Date().toISOString(),
    source:
      'RSS publik: WSJ Markets, CNBC, Yahoo Finance, Investing.com, CNBC Indonesia. Kalender: ForexFactory (nfs.faireconomy.media).',
    scope:
      'Berita disegarkan pada siklus intraday, jadi umurnya menit — bukan detik. Bloomberg dan Financial Juice tidak ada di sini karena keduanya tidak punya feed publik gratis; keduanya berbayar per-seat dan tidak boleh diambil otomatis.',
    feeds: FEEDS.map((f) => ({ id: f.id, name: f.name, scope: f.scope })),
    failed,
    count: kept.length,
    items: kept,
    calendar,
  };

  await writeFile(join(OUT_DIR, 'news.json'), JSON.stringify(payload));
  const tagged = kept.filter((i) => i.emiten.length).length;
  log(`ditulis news.json — ${kept.length} berita (${tagged} tertaut emiten), ${calendar.length} agenda`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
