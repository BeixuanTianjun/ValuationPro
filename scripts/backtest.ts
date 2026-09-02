/**
 * backtest.ts — run every engine over the whole universe and look for the
 * failures a unit test cannot see.
 *
 *   npm run backtest            # one pass
 *   npm run backtest -- 3       # three passes, to catch order-dependence
 *
 * WHAT THIS IS FOR, AND WHY IT IS NOT A UNIT TEST. `npm test` checks a handful
 * of hand-picked numbers against hand-computed answers: it proves the maths is
 * right on the cases somebody thought of. It cannot tell you that emiten 700 of
 * 962 produces a NaN target price, that one sector has no peers so a divide
 * lands on Infinity, or that the dossier throws on the one emiten with no price
 * history. Those only appear when every row goes through.
 *
 * So this sweeps the whole universe through every engine and asserts the things
 * that must hold for ALL of them:
 *
 *   - nothing throws
 *   - no NaN or Infinity reaches a field the UI will print
 *   - no percentage that should be bounded escapes its bounds
 *   - every screener mode's rules agree with the raw numbers they claim to read,
 *     including the two that select on WEAKNESS, where an inverted comparison
 *     returns a plausible list that is exactly backwards
 *   - a foreign-currency reporter is either translated or flagged, never both
 *     silent and stamped in rupiah
 *
 * WHY IT RUNS SEVERAL PASSES. Factor computation caches, Maps iterate in
 * insertion order, and the screener sorts on values that tie. A result that
 * changes between two passes over identical data is a bug even when both
 * answers look reasonable, so pass N is compared against pass 1.
 */
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { computeAllFactors } from '../src/models/factorEngine';
import { convictionScore, runStockScreener } from '../src/models/stockScreener';
import { buildWatchlist } from '../src/models/watchlist';
import {
  EvaluatedPick,
  MAX_HOLD_SESSIONS,
  Pick,
  buildPickSummaries,
  evaluatePick,
  levelsFor,
} from '../src/models/pickJournal';
import { STOP_ATR_MULT, TARGET_ATR_MULT } from '../src/models/tradeSetup';
import { runAutoValuation } from '../src/models/autoValuation';
import { buildEmitenModel } from '../src/models/idxCompanyBridge';
import { computeAttribution } from '../src/models/indexAttribution';
import { computeAllGroupRotations } from '../src/models/conglomerateRotation';
import { computeOwnershipProfile } from '../src/models/ownershipFlow';
import { resolveStatements } from '../src/data/fundamentalsRepository';
import { buildDossier } from '../src/server/chatApi';
import {
  MIN_SAMPLE,
  buildMacroLinkage,
  findSurprises,
  linkagesForEmiten,
} from '../src/models/macroLinkage';
import {
  loadChatContextFromDisk,
  loadFundamentalsFromDisk,
  loadMarketDatabaseFromDisk,
} from '../src/server/marketFromDisk';
import {
  TERMINAL_FUNCTIONS,
  findFunction,
  isRecentlyAdded,
  searchFunctions,
} from '../src/data/functions';

const DATA_DIR = join(process.cwd(), 'public', 'data', 'idx');
const PASSES = Math.max(1, Number(process.argv[2] || 1));

interface Finding {
  area: string;
  detail: string;
}
const findings: Finding[] = [];
let checks = 0;

const fail = (area: string, detail: string) => findings.push({ area, detail });
const ok = () => checks++;

/** Every number the UI will print must be finite. */
function assertFinite(area: string, code: string, fields: Record<string, unknown>) {
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v !== 'number') continue;
    checks++;
    if (!Number.isFinite(v)) fail(area, `${code}.${k} = ${v}`);
  }
}

async function main() {
  const [db, fundamentals, ctx] = await Promise.all([
    loadMarketDatabaseFromDisk(DATA_DIR),
    loadFundamentalsFromDisk(DATA_DIR),
    loadChatContextFromDisk(DATA_DIR),
  ]);

  console.log(
    `universe ${db.emiten.length} emiten · ${db.dates.length} sesi · sesi terakhir ${db.meta.latestSession}`
  );
  console.log(
    `feed: fundamentals=${fundamentals.fundamentals ? 'ada' : 'TIDAK ADA'} quotes=${
      fundamentals.quotes ? 'ada' : 'TIDAK ADA'
    } announcements=${ctx.announcements ? 'ada' : 'TIDAK ADA'} ownership=${
      ctx.ownership ? 'ada' : 'TIDAK ADA'
    } macro=${ctx.macro ? 'ada' : 'TIDAK ADA'} worldmap=${ctx.worldmap ? 'ada' : 'TIDAK ADA'}\n`
  );

  // ---- navigation ---------------------------------------------------------
  //
  // A screen that ships and cannot be reached is the same as a screen that did
  // not ship, and it is invisible to every other check here: the engines are
  // fine, the data is fine, and the user simply never finds the thing. These
  // are the registry invariants that keep the launcher and the command line
  // honest — the CN/CNG prefix collision in particular is one keystroke away
  // from sending `CN` to the conglomerate screen forever.
  {
    const seen = new Set<string>();
    for (const fn of TERMINAL_FUNCTIONS) {
      checks++;
      if (seen.has(fn.code)) fail('navigasi', `kode ganda: ${fn.code}`);
      seen.add(fn.code);

      checks++;
      if (findFunction(fn.code)?.code !== fn.code) {
        fail('navigasi', `mengetik ${fn.code} membuka ${findFunction(fn.code)?.code ?? 'tidak ada'}`);
      }

      checks++;
      if (searchFunctions(fn.code)[0]?.code !== fn.code) {
        fail('navigasi', `pencarian ${fn.code} tidak menaruh dirinya di urutan pertama`);
      }

      checks++;
      if ((fn.area === 'market' || fn.area === 'analytics') && !fn.sub) {
        fail('navigasi', `${fn.code} ada di area bertab tapi tidak menyebut sub-tab`);
      }

      checks++;
      if (fn.added !== undefined && Number.isNaN(Date.parse(fn.added))) {
        fail('navigasi', `${fn.code} punya tanggal rilis tidak sah: ${fn.added}`);
      }

      // The NEW flag has to expire on its own; a badge that needs a human to
      // remove it is a badge that is still there next year.
      checks++;
      if (fn.added && isRecentlyAdded(fn, new Date(Date.parse(fn.added) + 400 * 86_400_000))) {
        fail('navigasi', `${fn.code} masih ditandai baru 400 hari setelah rilis`);
      }
    }

    // A capability nobody can search for is a capability nobody has. The RISK
    // screen shipped without the word "risiko" anywhere in its hint, so typing
    // the single most obvious Indonesian word for it returned nothing — and
    // `searchFunctions` matches against `hint`, which is precisely why that
    // field must stay Indonesian. The two new screener setups are the same
    // shape of risk: somebody looking for them will type "diskon" or
    // "tertinggal", not "SCR".
    const MUST_FIND: [string, string][] = [
      ['diskon', 'SCR'],
      ['tertinggal', 'SCR'],
      ['antre beli', 'SCR'],
      ['buyback', 'SCR'],
      ['salah harga', 'SCR'],
      ['momentum', 'SCR'],
      ['konglomerasi', 'CNG'],
      ['winrate', 'JRN'],
      ['jurnal', 'JRN'],
      ['catatan', 'JRN'],
      ['excel', 'JRN'],
    ];
    for (const [word, code] of MUST_FIND) {
      checks++;
      if (!searchFunctions(word).some((f) => f.code === code)) {
        fail('navigasi', `mengetik "${word}" tidak menemukan ${code}`);
      }
    }

    // ---- the front page must cover every screen, and only real ones -------
    //
    // THIS IS THE GUARD THE OLD FRONT PAGE NEEDED AND DID NOT HAVE. It carried a
    // hand-written list of eleven cards that drifted for weeks: it advertised
    // RISK, a screen that had been deleted, while six screens that had actually
    // shipped — JRN, PORT, CN, NEWS, TNKR, AVAL — appeared nowhere. Nothing
    // failed, nothing threw; a card for a dead screen renders exactly as nicely
    // as a card for a live one, and a missing card renders as nothing at all.
    //
    // Read from the SOURCE rather than by importing the component: the landing
    // page pulls in React and lucide-react, and dragging a JSX module into this
    // node bundle to count strings would cost more than it proves. The regex
    // reads the same `code:` literals the component ships with.
    {
      const landing = await readFile(join(process.cwd(), 'src', 'components', 'landing', 'LandingPage.tsx'), 'utf8');
      const shown = [...landing.matchAll(/code:\s*'([A-Z]+)'/g)].map((m) => m[1]);
      const registry = new Set(TERMINAL_FUNCTIONS.map((f) => f.code));

      for (const code of shown) {
        checks++;
        if (!registry.has(code)) {
          fail('halaman depan', `memajang kartu untuk ${code}, yang tidak ada di registri fungsi`);
        }
      }
      for (const fn of TERMINAL_FUNCTIONS) {
        checks++;
        if (!shown.includes(fn.code)) {
          fail('halaman depan', `${fn.code} (${fn.name}) tidak punya kartu — layar tanpa kartu tidak akan ditemukan`);
        }
      }
      checks++;
      // A count typed as a word or a literal goes stale silently. If either
      // appears, somebody has re-hardcoded what the registry already knows.
      if (/Delapan belas layar|value: '18'/.test(landing)) {
        fail('halaman depan', 'jumlah layar ditulis manual — harus dibaca dari TERMINAL_FUNCTIONS.length');
      }
    }

    // A screen that cannot work on the deployed site must SAY so in the
    // launcher. Without this the only warning is an empty panel after the
    // click, which reads as a broken feature rather than a deliberate one —
    // and the two screens carrying this flag are the two most likely to be
    // opened first by somebody visiting the live URL.
    const LOCAL_ONLY = ['JRN'];
    for (const code of LOCAL_ONLY) {
      checks++;
      if (findFunction(code)?.availability !== 'lokal') {
        fail('navigasi', `${code} butuh layanan lokal tapi tidak ditandai availability: 'lokal'`);
      }
    }
  }

  const signatures: string[] = [];

  for (let pass = 1; pass <= PASSES; pass++) {
    const t0 = Date.now();
    const factors = computeAllFactors(db);

    // ---- factors -----------------------------------------------------------
    for (const [code, f] of factors) {
      assertFinite('faktor', code, {
        return1w: f.return1w,
        return1m: f.return1m,
        return3m: f.return3m,
        return12m: f.return12m,
        rsi14: f.rsi14,
        sma50: f.sma50,
        sma200: f.sma200,
        medianValue20IdrBn: f.medianValue20IdrBn,
      });
      checks++;
      if (f.rsi14 < 0 || f.rsi14 > 100) fail('faktor', `${code} RSI di luar 0-100: ${f.rsi14}`);
      checks++;
      if (f.tradedSessions20 < 0 || f.tradedSessions20 > 20) {
        fail('faktor', `${code} tradedSessions20 di luar 0-20: ${f.tradedSessions20}`);
      }
    }

    // ---- screener: do the rules agree with the numbers they read? -----------
    //
    // Every mode is swept, not just momentum. The two newer ones are where a
    // silent inversion is easiest to write and hardest to see: a dip screen
    // that quietly returns the SHALLOWEST names, or a laggard screen whose gap
    // is measured the wrong way round, produces a list that looks entirely
    // plausible and is exactly backwards. So the arithmetic each rule claims to
    // read is recomputed here from the row's own published numbers.
    const screen = runStockScreener(db);
    for (const mode of ['momentum', 'pullback', 'laggard'] as const) {
      const s = runStockScreener(db, { mode });
      const cfg = s.settings;

      checks++;
      if (s.mode !== mode) fail('screener', `mode ${mode} mengembalikan hasil bermode ${s.mode}`);

      // The funnel is a funnel: no stage may hold more than the one before it.
      for (let i = 1; i < s.funnel.length; i++) {
        checks++;
        if (s.funnel[i].remaining > s.funnel[i - 1].remaining) {
          fail(
            'screener',
            `${mode} corong naik di "${s.funnel[i].label}": ${s.funnel[i - 1].remaining} -> ${s.funnel[i].remaining}`
          );
        }
      }

      // Every passing row must appear in `rows`, and nothing else may.
      let passing = 0;
      for (const row of s.all.values()) if (row.passAll) passing++;
      checks++;
      if (passing !== s.rows.length) fail('screener', `${mode} ${passing} baris lolos tetapi rows memuat ${s.rows.length}`);
      checks++;
      if (s.rows.length !== s.funnel[s.funnel.length - 1].remaining) {
        fail('screener', `${mode} corong berakhir di ${s.funnel[s.funnel.length - 1].remaining}, rows ${s.rows.length}`);
      }

      for (const [code, row] of s.all) {
        const f = factors.get(code);

        checks++;
        const conviction = convictionScore(row, f, mode);
        if (!(conviction >= 0 && conviction <= 1)) fail('screener', `${mode} ${code} conviction di luar 0-1: ${conviction}`);

        assertFinite(`screener ${mode}`, code, { close: row.close, volumeShares: row.volumeShares });
        checks++;
        if (row.volumeShares < 0) fail('screener', `${mode} ${code} volume negatif: ${row.volumeShares}`);

        checks++;
        const maShouldPass = row.close > row.maShort && row.close > row.maLong;
        if (Number.isFinite(row.maShort) && Number.isFinite(row.maLong) && row.passMa !== maShouldPass) {
          fail('screener', `${code} passMa=${row.passMa} tetapi close=${row.close} MA=${row.maShort}/${row.maLong}`);
        }

        // -- gerbang runup, aturan momentum yang baru
        //
        // Dijaga di sini karena ia satu-satunya aturan keras di berkas itu yang
        // ambangnya berasal dari pengukuran, dan aturan yang dipasang karena
        // bukti adalah aturan yang paling mahal kalau diam-diam berhenti
        // bekerja: layarnya tetap penuh, emitennya tetap masuk akal, dan tidak
        // ada yang memberi tahu bahwa satu-satunya syarat yang punya sinyal
        // sudah lepas.
        checks++;
        const notFlownShould =
          Number.isFinite(row.runupFromLow) && row.runupFromLow < cfg.maxRunupPercent;
        if (row.passNotFlown !== notFlownShould) {
          fail(
            'screener',
            `${code} passNotFlown=${row.passNotFlown} tetapi runup ${row.runupFromLow} vs ambang ${cfg.maxRunupPercent}`,
          );
        }
        if (mode === 'momentum' && row.passAll) {
          checks++;
          if (!(row.runupFromLow < cfg.maxRunupPercent)) {
            fail(
              'screener',
              `${code} lolos momentum padahal runup ${row.runupFromLow} >= ambang ${cfg.maxRunupPercent}`,
            );
          }
          // Tren panjang, ditambahkan setelah gerbang runup sendirian membuat
          // layar penuh saham yang tiga bulan turun lalu naik tiga hari: 19 dari
          // 22 yang lolos berada DI BAWAH MA200. Momentum tanpa syarat tren
          // panjang cuma memeriksa MA3 dan MA5 — tiga dan lima sesi — dan itu
          // memantulkan apa pun, termasuk yang sedang jatuh.
          checks++;
          if (!row.passTrend) {
            fail('screener', `${code} lolos momentum padahal di bawah MA${cfg.trendMa}`);
          }
        }
        if (mode !== 'momentum' && row.passAll) {
          checks++;
          // Gerbangnya SENGAJA hanya di momentum: diukur, pullback turun dari 18
          // ke 7 emiten per sesi dan laggard sudah meloloskan nol. Kalau suatu
          // saat ia merembes ke mode lain, corongnya akan menyusut tanpa ada
          // baris yang menyebutkannya.
          if (!Number.isFinite(row.runupFromLow)) continue;
        }

        // -- pullback arithmetic
        if (Number.isFinite(row.highInWindow) && Number.isFinite(row.dipFromHigh)) {
          checks++;
          // The dip is a distance BELOW a high, so it can never be positive.
          if (row.dipFromHigh > 1e-9) {
            fail('screener', `${code} dipFromHigh positif: ${row.dipFromHigh} (puncak ${row.highInWindow})`);
          }
          checks++;
          const inBand = row.dipFromHigh <= -cfg.minDipPercent && row.dipFromHigh >= -cfg.maxDipPercent;
          if (row.passDepth !== inBand) {
            fail('screener', `${code} passDepth=${row.passDepth} tetapi diskon ${row.dipFromHigh} di luar/di dalam pita`);
          }
        }
        checks++;
        if (row.passTrend && !(Number.isFinite(row.maTrend) && row.maTrend > 0)) {
          fail('screener', `${code} passTrend tanpa MA${cfg.trendMa} yang terdefinisi`);
        }
        checks++;
        if (row.passDip && row.passTrend && Number.isFinite(row.maDip) && Number.isFinite(row.maTrend)) {
          // Both readings must come from the same close, so a row cannot be
          // simultaneously above and below the SAME average.
          if (cfg.dipMa === cfg.trendMa) fail('screener', `${code} lolos di atas dan di bawah MA yang sama`);
        }

        // -- laggard arithmetic
        if (Number.isFinite(row.indexReturn) && Number.isFinite(row.stockReturn)) {
          checks++;
          const gap = (row.indexReturn - row.stockReturn) * 100;
          if (Math.abs(gap - row.gapToIndexPp) > 1e-6) {
            fail('screener', `${code} gapToIndexPp=${row.gapToIndexPp} tetapi indeks−saham=${gap}`);
          }
          checks++;
          if (row.passIndexUp !== row.indexReturn >= cfg.minIndexGainPercent) {
            fail('screener', `${code} passIndexUp=${row.passIndexUp} tetapi indeks ${row.indexReturn}`);
          }
          checks++;
          if (row.passLag !== row.stockReturn <= cfg.maxStockGainPercent) {
            fail('screener', `${code} passLag=${row.passLag} tetapi return saham ${row.stockReturn}`);
          }
          checks++;
          // A row that passed both halves of the laggard claim MUST show a gap
          // at least as wide as the two thresholds imply. If it does not, the
          // subtraction is the wrong way round.
          if (row.passIndexUp && row.passLag) {
            const minGap = (cfg.minIndexGainPercent - cfg.maxStockGainPercent) * 100;
            if (row.gapToIndexPp < minGap - 1e-9) {
              fail('screener', `${code} lolos indeks+lag tetapi jarak hanya ${row.gapToIndexPp}pp (minimal ${minGap}pp)`);
            }
          }
        }
        checks++;
        if (row.indexCode !== 'COMPOSITE' && !db.indexSeries.has(row.indexCode)) {
          fail('screener', `${code} memakai indeks acuan yang tidak ada: ${row.indexCode}`);
        }

        // -- lateness arithmetic
        //
        // Both readings come from the same 60 closes, so two things must hold:
        // the run-up from that window's LOW is never negative, and it is never
        // below the drop from that window's HIGH, because low <= high makes
        // close/low >= close/high. Swapping the min and the max produces two
        // columns of entirely plausible percentages that say the opposite of
        // the truth, and nothing else here would notice.
        //
        // (The first version of this check asserted runup + dip >= 0, which is
        // not an identity at all — close/low + close/high >= 2 is simply false
        // for a stock sitting between the two. It failed on 489 emiten that
        // were all correct. The invariant was wrong, not the engine.)
        if (Number.isFinite(row.runupFromLow)) {
          checks++;
          if (row.runupFromLow < -1e-9) {
            fail('screener', `${code} runupFromLow negatif: ${row.runupFromLow}`);
          }
          checks++;
          if (Number.isFinite(row.dipFromHigh) && row.runupFromLow < row.dipFromHigh - 1e-9) {
            fail(
              'screener',
              `${code} runup ${row.runupFromLow} di bawah diskon ${row.dipFromHigh} — puncak dan dasar tertukar`
            );
          }
        }
        checks++;
        if (Number.isFinite(row.atr14) && row.atr14 < 0) fail('screener', `${code} ATR14 negatif: ${row.atr14}`);
        checks++;
        if (Number.isFinite(row.extensionAtr) && Number.isFinite(row.maDip) && Number.isFinite(row.atr14) && row.atr14 > 0) {
          // The row must be extended in the same DIRECTION the price sits: above
          // its own MA20 means a positive extension, and vice versa. A sign flip
          // here would invert the whole "sudah terbang" column.
          const above = row.close > row.maDip;
          if (above !== row.extensionAtr > 0 && Math.abs(row.extensionAtr) > 0.01) {
            fail(
              'screener',
              `${code} regangan ${row.extensionAtr} berlawanan arah dengan harga ${row.close} vs MA ${row.maDip}`
            );
          }
        }
      }

      // The mode has to actually change the verdict, or the switch is cosmetic.
      // Not asserted on `rows.length` (a quiet market may legitimately empty a
      // mode) but on the rule flags, which are computed for every emiten.
      checks++;
      const anyModeRule = [...s.all.values()].some((r) => r.passTrend || r.passDip || r.passIndexUp || r.passLag);
      if (!anyModeRule) fail('screener', `${mode} tidak satu pun aturan mode terpenuhi di seluruh semesta`);
    }

    // ---- pick journal: does a recorded pick grade correctly? ---------------
    //
    // The journal is the only engine here whose whole value is that it is
    // honest about the FUTURE, so the checks are about look-ahead and about the
    // grading arithmetic. Synthetic picks are built on a session far enough back
    // that most of them have had time to resolve, plus one on the very last
    // session — which must come back `open`, because nothing after it exists.
    {
      const anchorIdx = Math.max(0, db.dates.length - 200);
      const anchor = db.dates[anchorIdx];
      const last = db.dates[db.dates.length - 1];
      const rr = TARGET_ATR_MULT / STOP_ATR_MULT;

      const synth = (code: string, session: string): Pick | null => {
        const idx = db.dates.indexOf(session);
        const s = db.series.get(code);
        const f = factors.get(code);
        if (!s || !f || idx < 0) return null;

        // HARGA TRADED, bukan harga yang disesuaikan — fixture ini harus meniru
        // pick sungguhan, dan pencatat menulis `db.daily.close`, yaitu harga
        // sebagaimana diperdagangkan hari itu. Memakai s.close di sini membuat
        // fixture hidup di skala yang berbeda dari barang yang diwakilinya, dan
        // pemeriksaan apa pun terhadapnya menguji dunia yang tidak ada.
        //
        // atr14 ikut diskalakan dengan faktor yang sama. Ia dihitung dari deret
        // yang disesuaikan terhadap sesi TERBARU, sedangkan di jalur live ATR
        // selalu satu skala dengan entry: pada sesi terbaru tidak ada faktor
        // sesudahnya, jadi disesuaikan dan traded memang sama. Untuk sesi lama
        // kesamaan itu harus dikembalikan, kalau tidak stop dan target duduk di
        // jarak yang salah dari entry.
        const entry = s.rawClose[idx];
        const k = entry > 0 && s.close[idx] > 0 ? entry / s.close[idx] : NaN;
        if (!Number.isFinite(k)) return null;
        const levels = levelsFor(entry, f.atr14 * k);
        if (!levels) return null;
        return {
          id: `${session}:screener:momentum:${code}`,
          recordedAt: new Date().toISOString(),
          session,
          source: 'screener:momentum',
          code,
          name: code,
          sector: '',
          rank: 1,
          score: 0.5,
          entry,
          stop: levels.stop,
          target: levels.target,
          atr14: f.atr14 * k,
          runupFromLow: NaN,
          extensionAtr: NaN,
          gapToIndexPp: NaN,
          dipFromHigh: NaN,
          entryIsFinalClose: true,
        };
      };

      const codes = db.emiten.slice(0, 400).map((e) => e.code);
      let graded = 0;
      for (const code of codes) {
        const p = synth(code, anchor);
        if (!p) continue;
        const r = evaluatePick(p, db);
        checks++;
        if (!r) {
          fail('jurnal pick', `${code} tidak bisa dinilai pada sesi ${anchor}`);
          continue;
        }
        graded++;

        assertFinite('jurnal pick', code, { rMultiple: r.rMultiple, returnPercent: r.returnPercent });

        checks++;
        // A pick can never be graded against a session at or before its own.
        if (r.exitSession < p.session) fail('jurnal pick', `${code} keluar di ${r.exitSession} sebelum masuk ${p.session}`);
        checks++;
        if (r.sessionsHeld < 0 || r.sessionsHeld > MAX_HOLD_SESSIONS) {
          fail('jurnal pick', `${code} sessionsHeld di luar 0-${MAX_HOLD_SESSIONS}: ${r.sessionsHeld}`);
        }
        checks++;
        if (r.outcome === 'stop' && Math.abs(r.rMultiple + 1) > 1e-9) {
          fail('jurnal pick', `${code} kena stop tapi R = ${r.rMultiple}, seharusnya -1`);
        }
        checks++;
        if (r.outcome === 'target' && Math.abs(r.rMultiple - rr) > 1e-9) {
          fail('jurnal pick', `${code} kena target tapi R = ${r.rMultiple}, seharusnya ${rr}`);
        }
        checks++;
        if (r.outcome === 'expired' && r.sessionsHeld !== MAX_HOLD_SESSIONS) {
          fail('jurnal pick', `${code} kedaluwarsa di sesi ke-${r.sessionsHeld}, bukan ${MAX_HOLD_SESSIONS}`);
        }
        checks++;
        // 200 sessions of runway is more than the 63-session cap, so nothing
        // anchored back there may still be open. An `open` here means the walk
        // forward stopped early — the exact bug that would freeze the win rate.
        if (r.outcome === 'open') fail('jurnal pick', `${code} masih terbuka padahal 200 sesi sudah lewat`);
        checks++;
        if (r.resolved !== (r.outcome !== 'open')) fail('jurnal pick', `${code} flag resolved tidak konsisten`);
      }
      checks++;
      if (graded < 50) fail('jurnal pick', `hanya ${graded} pick sintetis bisa dinilai — terlalu sedikit untuk menjaga apa pun`);

      // ── SATU SKALA HARGA, DAN INI PERNAH SALAH ───────────────────────────
      //
      // entry/stop/target ditulis dalam harga TRADED di sesi masuk, sementara
      // series.close/high/low disesuaikan terhadap sesi TERBARU. Untuk emiten
      // yang kena aksi korporasi sesudah sesi masuk, keduanya berbeda skala.
      // Sebelum diperbaiki: 673 dari 22.770 baris jurnal terkena, dan PACK pada
      // 2025-05-21 tercatat -81,7% padahal pemegangnya untung 142,4% — reverse
      // split terbaca sebagai keruntuhan. Bendera outcome ikut salah, bukan cuma
      // angka return-nya.
      //
      // Identitas yang harus berlaku: return satu bulan sama dengan rasio pada
      // deret yang DISESUAIKAN, karena deret itu satu-satunya yang konsisten
      // melintasi aksi korporasi. Diuji khusus pada emiten yang punya aksi,
      // karena untuk emiten lain identitas ini berlaku bahkan ketika kodenya
      // salah — dan sapuan yang lolos karena mengambil sampel yang aman adalah
      // sapuan yang tidak menjaga apa pun.
      const withActions = db.emiten
        .map((e) => db.series.get(e.code))
        .filter((x): x is NonNullable<typeof x> => !!x && x.adjustments > 0);
      let scaleChecked = 0;
      for (const series of withActions) {
        const i = db.dates.indexOf(anchor);
        if (i < 0) break;
        const j = i + 21;
        if (j >= db.dates.length) break;
        const a = series.close[i];
        const b = series.close[j];
        if (!(a > 0) || !(b > 0) || !(series.rawClose[i] > 0)) continue;
        const p = synth(series.code, anchor);
        if (!p) continue;
        const r = evaluatePick(p, db);
        if (!r || !Number.isFinite(r.return1m)) continue;
        scaleChecked++;
        checks++;
        const expected = b / a - 1;
        if (Math.abs(r.return1m - expected) > 1e-9) {
          fail(
            'jurnal pick',
            `${series.code} return1m ${r.return1m.toFixed(6)} tidak sama dengan rasio deret disesuaikan ${expected.toFixed(6)} — skala harga tercampur`,
          );
        }
      }
      checks++;
      if (scaleChecked < 5) {
        fail('jurnal pick', `hanya ${scaleChecked} emiten beraksi korporasi yang teruji skalanya — terlalu sedikit`);
      }

      // THE LOOK-AHEAD GUARD. A pick made on the newest session has no future
      // to be graded against, so anything other than `open` means the evaluator
      // is reading a bar that does not exist yet.
      for (const code of codes.slice(0, 40)) {
        const p = synth(code, last);
        if (!p) continue;
        const r = evaluatePick(p, db);
        checks++;
        if (r && r.outcome !== 'open') {
          fail('jurnal pick', `${code} dicatat pada sesi terakhir ${last} tapi sudah berstatus ${r.outcome}`);
        }
      }

      // Summaries must never invent a win rate out of nothing, and must never
      // count an open position as resolved.
      const rows = codes
        .map((c) => synth(c, anchor))
        .filter((p): p is Pick => p !== null)
        .map((p) => evaluatePick(p, db))
        .filter((r): r is EvaluatedPick => r !== null);
      const { summaries } = buildPickSummaries(rows);
      for (const s of summaries) {
        checks++;
        if (s.resolved + s.open !== s.picks) fail('jurnal pick', `${s.label}: ${s.resolved}+${s.open} != ${s.picks}`);
        checks++;
        if (s.wins + s.losses !== s.resolved) fail('jurnal pick', `${s.label}: menang+kalah != selesai`);
        checks++;
        if (Number.isFinite(s.winRate) && (s.winRate < 0 || s.winRate > 1)) {
          fail('jurnal pick', `${s.label}: winrate di luar 0-1: ${s.winRate}`);
        }
        checks++;
        if (s.resolved === 0 && Number.isFinite(s.winRate)) {
          fail('jurnal pick', `${s.label}: winrate dicetak padahal nol pick selesai`);
        }
      }
    }

    // ---- watchlist, both horizons -----------------------------------------
    for (const horizon of ['mingguan', 'bulanan'] as const) {
      const wl = buildWatchlist({
        db,
        factors,
        announcements: ctx.announcements ?? null,
        ownership: ctx.ownership ?? null,
        horizon,
        limit: 30,
      });
      checks++;
      if (!wl.candidates) fail('watchlist', `${horizon} tidak menghasilkan kandidat`);
      for (const c of wl.candidates) {
        assertFinite(`watchlist ${horizon}`, c.code, { score: c.score, close: c.close });
        checks++;
        if (c.score < 0 || c.score > 1) fail(`watchlist ${horizon}`, `${c.code} skor di luar 0-1: ${c.score}`);
      }
    }

    // ---- auto valuation ----------------------------------------------------
    const av = runAutoValuation(db, fundamentals, factors);
    for (const r of av.results) {
      assertFinite('valuasi otomatis', r.emiten.code, {
        targetGordon: r.targetGordon,
        targetExitMultiple: r.targetExitMultiple,
        targetBlended: r.targetBlended,
        upside: r.upside,
        wacc: r.wacc,
        beta: r.beta,
      });
      checks++;
      // WACC is floored at the risk-free rate + 1% by design; anything under 1%
      // or over 100% means the floor or the beta gate stopped working.
      if (r.wacc <= 0.01 || r.wacc > 1) fail('valuasi otomatis', `${r.emiten.code} WACC absurd: ${r.wacc}`);
    }

    // ---- index attribution over several windows ----------------------------
    for (const period of ['1d', '1w', '1m', '3m', 'ytd'] as const) {
      const a = computeAttribution(db, period);
      checks++;
      if (!a) continue;
      assertFinite('atribusi', period, {
        indexPoints: a.indexPoints,
        indexPercent: a.indexPercent,
        divisor: a.divisor,
        summedPoints: a.reconciliation.summedPoints,
      });
      const residual = Math.abs(a.reconciliation.residualPoints);
      checks++;
      // A residual is allowed (new listings, delistings) but must be explained.
      if (residual > 0.01 && !a.reconciliation.note) {
        fail('atribusi', `${period} residual ${residual.toFixed(3)} poin tanpa penjelasan`);
      }
      checks++;
      // Sector contributions must add up to the same total as the emiten rows.
      const sectorSum = a.sectors.reduce((n, c) => n + c.points, 0);
      if (Math.abs(sectorSum - a.reconciliation.summedPoints) > 0.01) {
        fail(
          'atribusi',
          `${period} jumlah sektor ${sectorSum.toFixed(3)} != jumlah emiten ${a.reconciliation.summedPoints.toFixed(3)}`
        );
      }
    }

    // ---- conglomerate rotation --------------------------------------------
    const rotations = computeAllGroupRotations(db, factors);
    for (const r of rotations) {
      assertFinite('rotasi', r.group.id, {
        groupReturn1m: r.groupReturn1m,
        groupReturn3m: r.groupReturn3m,
        dispersion3m: r.dispersion3m,
      });
      // Cohesion is deliberately allowed to be NaN: with two members whose
      // return series have no variance in the window there is no correlation to
      // measure, and inventing 0 would read as "moves independently" rather than
      // "cannot be measured". What must hold is that the sentinel is honoured —
      // an unmeasurable group may never be presented as a valid rotation.
      checks++;
      if (Number.isFinite(r.cohesion)) {
        if (r.cohesion < -1.01 || r.cohesion > 1.01) {
          fail('rotasi', `${r.group.id} kohesi di luar -1..1: ${r.cohesion}`);
        }
      } else if (r.verdict.level !== 'tidak-valid') {
        fail('rotasi', `${r.group.id} kohesi NaN tetapi vonisnya "${r.verdict.level}", bukan tidak-valid`);
      }
    }

    // ---- ownership ---------------------------------------------------------
    if (ctx.ownership) {
      let profiled = 0;
      for (const e of db.emiten) {
        const own = computeOwnershipProfile(ctx.ownership, e.code);
        if (!own) continue;
        profiled++;
        assertFinite('kepemilikan', e.code, {
          institusi: own.latest.institusi,
          ritel: own.latest.ritel,
          custodyCoverage: own.custodyCoverage,
        });
        checks++;
        const total = own.latest.institusi + own.latest.ritel + own.latest.strategis;
        if (total > 1.02) fail('kepemilikan', `${e.code} porsi total ${(total * 100).toFixed(1)}% > 100%`);
      }
      checks++;
      if (profiled === 0) fail('kepemilikan', 'tidak satu pun emiten punya profil KSEI');
    }

    // ---- currency: translated, or flagged. never silently stamped ----------
    let usdReporters = 0;
    for (const e of db.emiten) {
      const r = resolveStatements(e.code, fundamentals, db.daily.get(e.code)?.close || 0);
      if (!r) continue;
      const reported = fundamentals.quotes?.quotes[e.code]?.financialCurrency || 'IDR';
      if (reported === 'IDR') continue;
      usdReporters++;
      checks++;
      // The report is stamped 'Rp ' unconditionally, so a foreign reporter must
      // carry either a translation or an explicit untranslated flag.
      if (!r.translatedFrom && !r.untranslated) {
        fail('mata uang', `${e.code} melapor ${reported} tetapi tidak ditandai translated maupun untranslated`);
      }
    }
    checks++;
    if (usdReporters === 0) fail('mata uang', 'tidak ada pelapor non-IDR terdeteksi — quotes.json mencurigakan');

    // ---- macro layer -------------------------------------------------------
    if (ctx.macro) {
      const macro = buildMacroLinkage(ctx.macro, db);
      checks++;
      if (!macro.instruments.length) fail('makro', 'tidak ada instrumen yang terbaca dari macro.json');
      for (const inst of macro.instruments) {
        assertFinite('makro', inst.id, {
          last: inst.last,
          change1d: inst.change1d,
          change1m: inst.change1m,
          change3m: inst.change3m,
          coverage: inst.coverage,
        });
        checks++;
        if (inst.coverage <= 0 || inst.coverage > 1) fail('makro', `${inst.id} cakupan di luar 0-1: ${inst.coverage}`);
        checks++;
        // The whole point of the lag flag is that it is set deliberately; an
        // instrument that lost it would be silently misaligned by one session.
        if (typeof inst.after !== 'boolean') fail('makro', `${inst.id} tidak punya flag after`);
      }
      for (const [target, links] of macro.bySector) {
        for (const l of links) {
          assertFinite(`makro ${target}`, l.instrumentId, {
            correlation: l.correlation,
            beta: l.beta,
            r2: l.r2,
          });
          checks++;
          if (l.correlation < -1.001 || l.correlation > 1.001) {
            fail('makro', `${target} x ${l.instrumentId} korelasi di luar -1..1: ${l.correlation}`);
          }
          checks++;
          // R² is the square of r by construction; a drift between them means
          // the two were computed over different samples.
          if (Math.abs(l.r2 - l.correlation * l.correlation) > 1e-9) {
            fail('makro', `${target} x ${l.instrumentId} R2 tidak sama dengan r kuadrat`);
          }
          checks++;
          if (l.n < MIN_SAMPLE) fail('makro', `${target} x ${l.instrumentId} lolos gerbang dengan n=${l.n}`);
          checks++;
          // NaN is allowed here (too few observations in the recent window) but
          // a number outside the correlation range never is.
          if (Number.isFinite(l.correlationRecent) && (l.correlationRecent < -1.001 || l.correlationRecent > 1.001)) {
            fail('makro', `${target} x ${l.instrumentId} korelasi terakhir di luar -1..1`);
          }
        }
      }
      checks++;
      if (!macro.bySector.has('IHSG')) fail('makro', 'IHSG tidak ada di tabel target');
      // Surprises must be internally consistent with the thresholds they claim.
      for (const sp of findSurprises(macro)) {
        checks++;
        const abs = Math.abs(sp.link.correlation);
        if (sp.kind === 'mati' && !sp.link.expected) fail('makro', `kejutan "mati" pada pasangan yang tidak diharapkan`);
        if (sp.kind === 'hidup' && sp.link.expected) fail('makro', `kejutan "hidup" pada pasangan yang diharapkan`);
        if (sp.kind === 'hidup' && abs < 0.45) fail('makro', `kejutan "hidup" dengan r hanya ${abs.toFixed(2)}`);
      }
      // Per-emiten linkage over a sample, since the dossier calls it per request.
      for (const e of db.emiten.filter((_, i) => i % 37 === 0)) {
        const ls = linkagesForEmiten(macro, db, e.code, 5);
        checks++;
        if (ls.length > 5) fail('makro', `${e.code} mengembalikan ${ls.length} tautan padahal batasnya 5`);
        for (const l of ls) {
          assertFinite(`makro emiten`, `${e.code}.${l.instrumentId}`, { correlation: l.correlation, beta: l.beta });
        }
      }
    }

    // ---- world map / chokepoints -------------------------------------------
    if (ctx.worldmap) {
      const wm = ctx.worldmap;
      checks++;
      if (!wm.chokepoints.length) fail('peta', 'tidak ada chokepoint di worldmap.json');
      checks++;
      const idn = wm.chokepoints.filter((c) => c.indonesian);
      // Five Indonesian straits is a geographic fact, not a preference. Losing
      // one means the upstream name changed and the IDX linkage silently shrank
      // — the dossier would keep printing, just with a strait missing.
      if (idn.length !== 5) fail('peta', `selat Indonesia terbaca ${idn.length}, seharusnya 5`);
      for (const c of wm.chokepoints) {
        assertFinite('peta', c.name, { tankers7d: c.tankers7d, tankersPrior30d: c.tankersPrior30d });
        checks++;
        if (c.tankers7d < 0) fail('peta', `${c.name} tanker negatif: ${c.tankers7d}`);
        checks++;
        if (c.tankerTrend !== null && !Number.isFinite(c.tankerTrend)) {
          fail('peta', `${c.name} tren bukan angka dan bukan null`);
        }
      }
      for (const e of wm.events) {
        checks++;
        if (e.affectedPorts < 0) fail('peta', `${e.name} pelabuhan terdampak negatif`);
        checks++;
        if (!['RED', 'ORANGE', 'GREEN'].includes(e.alert)) fail('peta', `${e.name} level alert tak dikenal: ${e.alert}`);
      }
      // The dossier gates this section on sector; a bank must never receive it.
      const bank = db.emiten.find((e) => e.sector === 'Financials');
      if (bank) {
        checks++;
        if (buildDossier(bank.code, db, factors, fundamentals, ctx).includes('JALUR LAUT')) {
          fail('peta', `${bank.code} (Financials) dapat bagian jalur laut`);
        }
      }
      const miner = db.emiten.find((e) => e.sector === 'Energy');
      if (miner) {
        checks++;
        if (!buildDossier(miner.code, db, factors, fundamentals, ctx).includes('JALUR LAUT')) {
          fail('peta', `${miner.code} (Energy) tidak dapat bagian jalur laut`);
        }
      }
    }

    // ---- the dossier, over a wide sample ----------------------------------
    const sample = db.emiten.filter((_, i) => i % 7 === 0);
    for (const e of sample) {
      checks++;
      let text = '';
      try {
        text = buildDossier(e.code, db, factors, fundamentals, ctx);
      } catch (err) {
        fail('dossier', `${e.code} melempar: ${(err as Error).message}`);
        continue;
      }
      if (/\bNaN\b/.test(text)) fail('dossier', `${e.code} memuat NaN`);
      if (/\bInfinity\b/.test(text)) fail('dossier', `${e.code} memuat Infinity`);
      if (/\bundefined\b/.test(text)) fail('dossier', `${e.code} memuat undefined`);
      if (text.length < 400) fail('dossier', `${e.code} terlalu pendek (${text.length} karakter)`);
    }

    // ---- the DCF bridge, over a wide sample --------------------------------
    for (const e of sample) {
      checks++;
      let bundle;
      try {
        bundle = buildEmitenModel(e, db, fundamentals);
      } catch (err) {
        fail('bridge DCF', `${e.code} melempar: ${(err as Error).message}`);
        continue;
      }
      if (!bundle) continue;
      assertFinite('bridge DCF', e.code, {
        sharesOutstanding: bundle.dcf.sharesOutstanding,
        currentSharePrice: bundle.dcf.currentSharePrice,
      });
      checks++;
      // Statements are IDR billions, so the share count must be in billions too.
      // A raw share count here is the 1000x target-price bug.
      if (bundle.dcf.sharesOutstanding > 10_000) {
        fail('bridge DCF', `${e.code} sharesOutstanding=${bundle.dcf.sharesOutstanding} — skalanya bukan miliar`);
      }
    }

    // A signature of the pass, to catch run-to-run drift on identical input.
    signatures.push(
      [
        screen.rows.length,
        screen.rows.slice(0, 20).map((r) => r.code).join(','),
        av.results.length,
        av.results.slice(0, 10).map((r) => r.targetBlended.toFixed(4)).join(','),
        rotations.length,
        rotations.map((r) => r.cohesion.toFixed(6)).join(','),
      ].join('|')
    );

    console.log(`pass ${pass}/${PASSES} — ${checks} pemeriksaan, ${findings.length} temuan, ${Date.now() - t0} ms`);
  }

  // ---- calendar integrity --------------------------------------------------
  //
  // The failure mode nothing else here can see. A trading session dropped out
  // of the calendar — cached empty before IDX had published it — so IDX's
  // `Previous` on the following session quoted a close that was never stored,
  // and the ingest read that gap as a corporate action for 701 of 962 emiten,
  // back-adjusting 283 sessions of history by an event that never happened.
  // Nothing threw, no field went NaN, every price still looked like a price;
  // what moved was index attribution, 95 points out on every window longer than
  // a day. Real corporate actions arrive one emiten at a time, so a date
  // carrying factors across a large share of the market is a hole in the
  // calendar, not a wave of splits.
  {
    const history = JSON.parse(await readFile(join(DATA_DIR, 'history.json'), 'utf8')) as {
      dates: string[];
      series: Record<string, { c?: string; adj?: string }>;
    };
    const n = history.dates.length;
    const factorsOn = new Array<number>(n).fill(0);
    const pricedOn = new Array<number>(n).fill(0);
    for (const raw of Object.values(history.series)) {
      const closes = (raw.c || '').split(',');
      const adj = (raw.adj || '').split(',');
      for (let i = 0; i < n; i++) {
        if (closes[i]) pricedOn[i]++;
        if (adj[i]) factorsOn[i]++;
      }
    }
    for (let i = 0; i < n; i++) {
      checks++;
      if (pricedOn[i] >= 100 && factorsOn[i] / pricedOn[i] > 0.05) {
        fail(
          'kalender',
          `${history.dates[i]}: faktor aksi korporasi pada ${factorsOn[i]} dari ${pricedOn[i]} emiten — tanda sesi bursa hilang, bukan split serentak`
        );
      }
    }
  }

  // ---- GDELT + risk: the two feeds added without a screen to look at ------
  //
  // Both are built from raw public files with no UI in front of them yet, which
  // is exactly the condition under which a feed rots unnoticed. The invariants
  // here are the ones that would have caught every silent failure this repo has
  // already produced: a rollup that stops matching its own rows, a column filter
  // that drifts onto the wrong field, and a composite that keeps publishing a
  // number after its inputs went away.
  {
    const gdelt = await readFile(join(DATA_DIR, 'gdelt.json'), 'utf8')
      .then((t) => JSON.parse(t) as {
        filter?: string;
        eventCount?: number;
        days?: { date: string; events: number; conflict: number; cooperation: number }[];
        events?: { id: string; date: string; quad: number | null; tone: number | null; goldstein: number | null; url: string }[];
      })
      .catch(() => null);

    checks++;
    if (!gdelt) {
      fail('gdelt', 'gdelt.json tidak ada atau tidak terbaca');
    } else {
      const events = gdelt.events ?? [];
      const days = gdelt.days ?? [];

      checks++;
      if (events.length !== gdelt.eventCount) {
        fail('gdelt', `eventCount ${gdelt.eventCount} != jumlah baris ${events.length}`);
      }

      // The filter is the whole feed. If it stops being recorded, nobody can
      // tell later which country the rows are actually about.
      checks++;
      if (!gdelt.filter || !gdelt.filter.includes('IDN')) {
        fail('gdelt', `filter negara tidak tercatat di berkas: ${gdelt.filter ?? 'tidak ada'}`);
      }

      // Ids are GDELT's own global event ids and are what the merge dedupes on.
      checks++;
      if (new Set(events.map((e) => e.id)).size !== events.length) {
        fail('gdelt', 'ada id event ganda — merge berhenti mendeduplikasi');
      }

      const today = new Date().toISOString().slice(0, 10);
      let future = 0;
      let noUrl = 0;
      let badQuad = 0;
      for (const e of events) {
        if (e.date > today) future++;
        if (!e.url) noUrl++;
        if (e.quad !== null && ![1, 2, 3, 4].includes(e.quad)) badQuad++;
        assertFinite('gdelt', e.id, {
          ...(e.tone !== null ? { tone: e.tone } : {}),
          ...(e.goldstein !== null ? { goldstein: e.goldstein } : {}),
        });
      }
      checks += 3;
      if (future) fail('gdelt', `${future} event bertanggal di masa depan`);
      // Every row must keep the article it came from, or the claim it supports
      // stops being citable — which is the only reason this feed exists.
      if (noUrl) fail('gdelt', `${noUrl} event tanpa URL sumber`);
      if (badQuad) fail('gdelt', `${badQuad} event dengan quad class di luar 1-4`);

      // The slice walk must add up. `slicesMissing: 0` next to `slicesRead: 0` once
      // read exactly like a healthy run — it meant "none missing out of the none
      // we asked for" after a mistyped flag made the window NaN.
      const g2 = gdelt as unknown as {
        slicesAttempted?: number;
        slicesRead?: number;
        slicesMissing?: number;
        windowHours?: number;
        coveredDates?: string[];
        timezone?: string;
      };
      checks += 4;
      if ((g2.slicesRead ?? 0) + (g2.slicesMissing ?? 0) !== (g2.slicesAttempted ?? -1)) {
        fail('gdelt', `slicesRead+slicesMissing != slicesAttempted (${g2.slicesRead}+${g2.slicesMissing} vs ${g2.slicesAttempted})`);
      }
      if (!(g2.slicesRead ?? 0)) fail('gdelt', 'nol slice terbaca tapi berkasnya tetap ditulis');
      // A window named N must hold N. GDELT publishes four slices an hour, so the
      // attempted count is the one field that proves the fencepost is right.
      if ((g2.slicesAttempted ?? 0) !== Math.round((g2.windowHours ?? 0) * 4)) {
        fail('gdelt', `windowHours ${g2.windowHours} seharusnya ${Math.round((g2.windowHours ?? 0) * 4)} slice, tapi mencoba ${g2.slicesAttempted}`);
      }
      // Dates here are UTC while IDX sessions are WIB, and a Jakarta day spans two
      // UTC dates. The file has to say so or a future join gets it silently wrong.
      if (!g2.timezone) fail('gdelt', 'gdelt.json tidak menyatakan zona waktu tanggalnya');

      // A day marked covered must be one we actually pulled slices for. Without
      // this, the backfill tail — days holding a fraction of a percent of their
      // real events — passes as coverage and draws a cliff at the window edge.
      const covered = new Set(g2.coveredDates ?? []);
      checks++;
      if (!covered.size) fail('gdelt', 'tidak ada coveredDates — mustahil membedakan hari terliput dari ekor backfill');
      for (const d of days as unknown as { date: string; covered?: boolean }[]) {
        checks++;
        if (d.covered && !covered.has(d.date)) {
          fail('gdelt', `${d.date} ditandai terliput tapi tidak ada di coveredDates`);
        }
      }

      // The rollup must still describe the rows it was built from.
      const counted = new Map<string, number>();
      for (const e of events) counted.set(e.date, (counted.get(e.date) ?? 0) + 1);
      for (const d of days) {
        checks += 2;
        if (counted.get(d.date) !== d.events) {
          fail('gdelt', `${d.date}: rollup ${d.events} != baris sebenarnya ${counted.get(d.date) ?? 0}`);
        }
        if (d.conflict + d.cooperation > d.events) {
          fail('gdelt', `${d.date}: konflik+kerjasama ${d.conflict + d.cooperation} > total ${d.events}`);
        }
      }
    }

    const risk = await readFile(join(DATA_DIR, 'risk.json'), 'utf8')
      .then((t) => JSON.parse(t) as {
        composite: number | null;
        componentsUsed: number;
        componentsTotal: number;
        method?: string;
        components?: { id: string; z: number | null }[];
        unavailable?: { id: string; reason?: string }[];
      })
      .catch(() => null);

    checks++;
    if (!risk) {
      fail('risk', 'risk.json tidak ada atau tidak terbaca');
    } else {
      const comps = risk.components ?? [];
      const scored = comps.filter((c) => c.z !== null);

      checks += 3;
      if (risk.composite !== null && !Number.isFinite(risk.composite)) {
        fail('risk', `komposit bukan angka berhingga: ${risk.composite}`);
      }
      // A composite with nothing under it is the exact failure this file was
      // written to avoid: a score that keeps printing after its inputs vanish.
      if (risk.composite !== null && scored.length === 0) {
        fail('risk', 'komposit diterbitkan padahal nol komponen punya z-score');
      }
      if (risk.componentsUsed !== scored.length) {
        fail('risk', `componentsUsed ${risk.componentsUsed} != komponen ber-z ${scored.length}`);
      }

      checks += 2;
      if (comps.length !== risk.componentsTotal) {
        fail('risk', `componentsTotal ${risk.componentsTotal} != ${comps.length} komponen`);
      }
      // The method has to travel with the number, or the score becomes exactly
      // the unexplained black box this project refuses to ship.
      if (!risk.method) fail('risk', 'risk.json tidak memuat penjelasan metodenya');

      const r2 = risk as unknown as {
        dominantSourceShare?: number | null;
        sourceConcentration?: Record<string, number>;
      };
      const scored2 = scored as unknown as {
        id: string;
        z: number | null;
        n?: number;
        latestDate?: string;
        baselineMean?: number | null;
      }[];
      for (const c of scored2) {
        checks += 3;
        if (!Number.isFinite(c.z as number)) fail('risk', `${c.id}: z bukan angka berhingga`);
        // A reading with no date drifts with the hour the job runs: the same field
        // means "a complete yesterday" at 02:00 UTC and "half of today" at noon.
        if (!c.latestDate) fail('risk', `${c.id}: nilai terakhir tanpa tanggal`);
        // zLatest needs eight points. A component that slipped below it should have
        // gone to `unavailable`, not shipped a z computed from too little.
        if ((c.n ?? 0) < 8) fail('risk', `${c.id}: z diterbitkan dari n=${c.n}, di bawah minimum 8`);
      }
      // The published baseline must be the mean the z was divided against — the
      // history EXCLUDING the latest point. Shipping the all-inclusive mean means
      // anyone recomputing (latest - mean)/sd gets a different number than the one
      // on screen, which is the quietest way to be wrong.
      for (const c of scored2) {
        checks++;
        if (c.baselineMean === undefined) fail('risk', `${c.id}: tidak menerbitkan baselineMean yang dipakai z-nya`);
      }
      checks += 2;
      // If one upstream supplies the whole score, the composite changes meaning the
      // day that upstream dies — and the zero-components guard never fires, because
      // the survivors keep their z.
      if (typeof r2.dominantSourceShare !== 'number' || r2.dominantSourceShare > 1) {
        fail('risk', `dominantSourceShare tidak masuk akal: ${r2.dominantSourceShare}`);
      }
      const concSum = Object.values(r2.sourceConcentration ?? {}).reduce((a, b) => a + b, 0);
      if (concSum !== scored.length) {
        fail('risk', `sourceConcentration menjumlah ${concSum}, komponen ber-z ${scored.length}`);
      }
      // An input that could not be fetched must say why. "Missing" with no
      // reason is indistinguishable from "we forgot".
      for (const u of risk.unavailable ?? []) {
        checks++;
        if (!u.reason) fail('risk', `${u.id}: masuk daftar tidak tersedia tanpa alasan`);
      }
    }
  }

  // ---- determinism ---------------------------------------------------------
  for (let i = 1; i < signatures.length; i++) {
    checks++;
    if (signatures[i] !== signatures[0]) {
      fail('determinisme', `pass ${i + 1} berbeda dari pass 1 atas data yang sama`);
    }
  }

  console.log('');
  if (!findings.length) {
    console.log(`LULUS — ${checks} pemeriksaan, ${PASSES} pass, nol temuan.`);
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
    if (list.length > 8) console.log(`     … +${list.length - 8} lagi`);
  }
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
