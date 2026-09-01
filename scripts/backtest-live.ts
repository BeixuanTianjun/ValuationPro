/**
 * backtest-live.ts — run the invariants against the DEPLOYED site, not the disk.
 *
 *   npm run backtest:live
 *   npm run backtest:live -- https://my-preview.vercel.app
 *
 * WHY THIS EXISTS SEPARATELY FROM backtest.ts. The local backtest reads
 * public/data/idx from the working copy, so it passes whenever the developer's
 * machine is healthy — including when the deployment is serving data from three
 * commits ago, is missing a file that was never committed, or has a serverless
 * function that times out. Every one of those has happened in this repo:
 *
 *   - macro.json 404'd on the live site while the local file was fine, because
 *     the deploy had not finished
 *   - /api/chat returned an empty body for thirty seconds of testing before the
 *     cause turned out to be a 20-second gateway timeout, not a code bug
 *   - the UI answered every question from the browser parser for weeks because
 *     it never called its own deployed endpoint
 *
 * None of those are visible from a local run. This fetches everything over the
 * public URL, checks the data invariants on what the deployment actually serves,
 * and exercises the two API routes end to end.
 *
 * IT IS NOT A UI TEST. It cannot tell you a chart renders. It tells you the
 * bytes the browser will receive are the bytes you think they are.
 */

const BASE = (process.argv[2] || 'https://valuation-pro-lake.vercel.app').replace(/\/$/, '');

interface Finding {
  area: string;
  detail: string;
}
const findings: Finding[] = [];
let checks = 0;

const fail = (area: string, detail: string) => findings.push({ area, detail });
const check = (area: string, ok: boolean, detail: string) => {
  checks++;
  if (!ok) fail(area, detail);
};

async function getJson<T>(path: string): Promise<{ ok: boolean; status: number; body: T | null; ms: number; bytes: number }> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}${path}`, { headers: { accept: 'application/json' } });
    const text = await res.text();
    let body: T | null = null;
    try {
      body = JSON.parse(text) as T;
    } catch {
      body = null;
    }
    return { ok: res.ok, status: res.status, body, ms: Date.now() - t0, bytes: text.length };
  } catch (err) {
    return { ok: false, status: 0, body: null, ms: Date.now() - t0, bytes: 0 };
  }
}

/** Days between an ISO date and today. */
const ageDays = (iso: string) => Math.round((Date.now() - Date.parse(`${iso}T00:00:00Z`)) / 86400000);

async function main() {
  console.log(`target: ${BASE}\n`);

  // ---- the page itself ----------------------------------------------------
  const htmlRes = await fetch(BASE);
  const html = await htmlRes.text();
  check('halaman', htmlRes.ok, `GET / -> HTTP ${htmlRes.status}`);
  const bundle = html.match(/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0] ?? '';
  check('halaman', !!bundle, 'tidak ada bundel index di HTML');
  check('halaman', html.includes('favicon.svg'), 'favicon tidak dirujuk di HTML');
  console.log(`  bundel: ${bundle || '(tidak ketemu)'}`);

  // Every asset the HTML references must actually be served. A 404 here is a
  // half-finished deploy, which looks fine until the browser tries to boot.
  for (const asset of html.match(/assets\/[A-Za-z0-9_.-]+\.(js|css)/g) ?? []) {
    const r = await fetch(`${BASE}/${asset}`, { method: 'HEAD' });
    check('aset', r.ok, `${asset} -> HTTP ${r.status}`);
  }
  const fav = await fetch(`${BASE}/favicon.svg`, { method: 'HEAD' });
  check('aset', fav.ok, `favicon.svg -> HTTP ${fav.status}`);

  // ---- every data file that ships ------------------------------------------
  //
  // This list is hand-maintained, and that is its own failure mode: a file added
  // to `public/data/idx/` and never added here can fail to deploy while this
  // check still prints "LULUS, nol temuan" — the pass then means "the files I
  // know about are fine", not "the deploy is complete". `brokers.json` sat in
  // that blind spot while `BrokerFlow.tsx` fetched it in production; a 404 there
  // would have taken out a screen with nothing to catch it. The guard below
  // compares this list against what the repo actually holds, so the next file
  // to go missing from here fails the run instead of hiding in it.
  const FILES = [
    'meta.json',
    'universe.json',
    'daily.json',
    'history.json',
    'indices.json',
    'intraday.json',
    'fundamentals.json',
    'quotes.json',
    'announcements.json',
    'ownership.json',
    'brokers.json',
    'macro.json',
    'worldmap.json',
    'gdelt.json',
    'risk.json',
    'news.json',
    'strategies.json',
    'tanker.json',
  ];
  const data: Record<string, unknown> = {};
  for (const f of FILES) {
    const r = await getJson<Record<string, unknown>>(`/data/idx/${f}`);
    check('data', r.ok, `${f} -> HTTP ${r.status}`);
    check('data', r.body !== null, `${f} bukan JSON yang sah`);
    if (r.body) data[f] = r.body;
    console.log(`  ${f.padEnd(20)} HTTP ${r.status}  ${(r.bytes / 1024).toFixed(0).padStart(5)} KB  ${r.ms} ms`);
  }

  // The list above is hand-maintained, so it is checked against reality rather
  // than trusted. A file that ships but is not listed gets no HTTP check at all,
  // and this run would still report zero findings while it 404'd for visitors.
  try {
    const { readdir } = await import('node:fs/promises');
    const onDisk = (await readdir('public/data/idx')).filter((f) => f.endsWith('.json'));
    const unchecked = onDisk.filter((f) => !FILES.includes(f));
    check(
      'cakupan',
      unchecked.length === 0,
      `${unchecked.length} berkas dikirim tapi tidak pernah diperiksa di sini: ${unchecked.join(', ')} — tambahkan ke FILES`
    );
  } catch {
    // Running from somewhere without the repo checked out is fine; the HTTP
    // checks above still stand on their own.
  }

  // ---- the invariants, on what the deployment actually serves --------------
  const meta = data['meta.json'] as { latestSession?: string } | undefined;
  const universe = data['universe.json'] as { count?: number; emiten?: unknown[] } | undefined;
  const daily = data['daily.json'] as { stocks?: unknown[]; session?: string } | undefined;
  const history = data['history.json'] as { dates?: string[] } | undefined;

  check('data', (universe?.emiten?.length ?? 0) > 900, `universe hanya ${universe?.emiten?.length} emiten`);
  check('data', (daily?.stocks?.length ?? 0) > 900, `daily hanya ${daily?.stocks?.length} baris`);
  check('data', (history?.dates?.length ?? 0) > 200, `history hanya ${history?.dates?.length} sesi`);

  // Staleness is the failure this file exists to catch: a deployment can serve
  // perfectly valid JSON that is a month old, and nothing else notices.
  if (meta?.latestSession) {
    const age = ageDays(meta.latestSession);
    console.log(`\n  sesi terakhir: ${meta.latestSession} (${age} hari lalu)`);
    check('kesegaran', age <= 7, `data harga berumur ${age} hari — ingest terjadwal berhenti?`);
  }

  // gdelt.json and risk.json have no frontend consumer yet, which is exactly when
  // a feed rots unnoticed: every invariant in `npm run backtest` is internal
  // consistency and would still pass on a file frozen six months ago. Age is the
  // one thing only a live check can see.
  for (const [name, field] of [
    ['gdelt.json', 'generatedAt'],
    ['risk.json', 'generatedAt'],
  ] as const) {
    const f = data[name] as Record<string, string> | undefined;
    const stamp = f?.[field];
    if (!stamp) {
      check('kesegaran', false, `${name} tidak membawa ${field}`);
      continue;
    }
    const age = ageDays(stamp.slice(0, 10));
    console.log(`  ${name.padEnd(20)} dibuat ${stamp.slice(0, 10)} (${age} hari lalu)`);
    check('kesegaran', age <= 14, `${name} berumur ${age} hari — ingest-nya berhenti?`);
  }

  const risk = data['risk.json'] as
    | { composite?: number | null; componentsUsed?: number; method?: string; unavailable?: unknown[] }
    | undefined;
  // The composite must never reach a visitor without the method that produced it
  // and the list of inputs that could not be fetched. Those two fields are the
  // difference between a documented reading and an unexplained score.
  check('risk', typeof risk?.method === 'string' && risk.method.length > 40, 'risk.json tayang tanpa penjelasan metode');
  check('risk', Array.isArray(risk?.unavailable), 'risk.json tayang tanpa daftar input yang tidak tersedia');
  check(
    'risk',
    risk?.composite === null || (risk?.componentsUsed ?? 0) > 0,
    'komposit tayang padahal nol komponen punya z-score'
  );

  const macro = data['macro.json'] as
    | { instruments?: { id: string; after?: boolean }[]; dates?: string[]; to?: string }
    | undefined;
  check('makro', (macro?.instruments?.length ?? 0) >= 25, `hanya ${macro?.instruments?.length} instrumen makro`);
  check('makro', Array.isArray(macro?.dates) && macro!.dates!.length > 0, 'macro.json tidak membawa dates — penyelarasan per tanggal mustahil');
  check(
    'makro',
    (macro?.instruments ?? []).every((i) => typeof i.after === 'boolean'),
    'ada instrumen makro tanpa flag after'
  );

  const wm = data['worldmap.json'] as
    | { chokepoints?: { name: string; indonesian: boolean; tankers7d: number }[]; events?: { alert: string }[]; land?: unknown[] }
    | undefined;
  check('peta', (wm?.chokepoints?.length ?? 0) >= 25, `hanya ${wm?.chokepoints?.length} chokepoint`);
  check('peta', (wm?.chokepoints ?? []).filter((c) => c.indonesian).length === 5, 'selat Indonesia bukan 5');
  check('peta', (wm?.land?.length ?? 0) > 50, `garis pantai hanya ${wm?.land?.length} poligon`);
  check(
    'peta',
    (wm?.events ?? []).every((e) => ['RED', 'ORANGE', 'GREEN'].includes(e.alert)),
    'ada level alert yang tidak dikenal'
  );

  const ann = data['announcements.json'] as { to?: string; announcements?: { date: string }[] } | undefined;
  if (ann?.announcements?.length) {
    const newest = ann.announcements.map((a) => a.date).sort().pop()!;
    const gap = ann.to ? Math.round((Date.parse(ann.to) - Date.parse(newest)) / 86400000) : 999;
    console.log(`  pengajuan terbaru: ${newest} (jendela berakhir ${ann.to})`);
    // The pagination bug that silently dropped the newest 1,000 filings would
    // have shown up here as a seventeen-day gap.
    check('pengumuman', gap <= 5, `pengajuan terbaru ${gap} hari lebih tua dari akhir jendela — paginasi terpotong?`);
  }

  // ---- the API routes -----------------------------------------------------
  console.log('');
  const live = await getJson<{ quotes?: unknown }>('/api/live');
  check('api', live.ok, `/api/live -> HTTP ${live.status}`);
  console.log(`  /api/live   HTTP ${live.status}  ${live.ms} ms`);

  const t0 = Date.now();
  const chatRes = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'kupas PTBA' }),
  });
  const chatText = await chatRes.text();
  const chatMs = Date.now() - t0;
  let chat: { engine?: string; reply?: string; note?: string } | null = null;
  try {
    chat = JSON.parse(chatText);
  } catch {
    chat = null;
  }
  console.log(`  /api/chat   HTTP ${chatRes.status}  ${chatMs} ms  engine=${chat?.engine ?? '?'}`);
  check('api', chatRes.ok, `/api/chat -> HTTP ${chatRes.status}`);
  check('api', chat !== null, '/api/chat tidak mengembalikan JSON');
  // A 504 arrives as an empty body, which is exactly how the 20-second gateway
  // timeout presented. Naming the symptom keeps the next person from hunting
  // for a logic bug.
  check('api', chatMs < 55000, `/api/chat makan ${(chatMs / 1000).toFixed(1)} detik — mendekati batas fungsi`);
  if (chat?.engine === 'lokal') {
    fail('api', `chat jatuh ke mesin lokal: ${chat.note ?? 'tanpa catatan'}`);
  }
  check('api', (chat?.reply?.length ?? 0) > 200, `balasan chat hanya ${chat?.reply?.length ?? 0} karakter`);

  // The dossier layers must actually reach the answer, not merely exist.
  const reply = (chat?.reply ?? '').toLowerCase();
  check('api', /korelasi|r\s*=|r\s*0[.,]/.test(reply), 'jawaban tidak menyebut korelasi — lapisan makro tidak terpakai');

  // ---- report -------------------------------------------------------------
  console.log('');
  if (!findings.length) {
    console.log(`LULUS — ${checks} pemeriksaan terhadap deployment live, nol temuan.`);
    return;
  }
  const byArea = new Map<string, string[]>();
  for (const f of findings) {
    const list = byArea.get(f.area) ?? [];
    list.push(f.detail);
    byArea.set(f.area, list);
  }
  console.log(`GAGAL — ${findings.length} temuan dari ${checks} pemeriksaan:\n`);
  for (const [area, list] of byArea) {
    console.log(`  ${area} (${list.length})`);
    for (const d of list.slice(0, 8)) console.log(`     ${d}`);
  }
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
