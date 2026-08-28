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
 *   - the screener's three rules agree with the raw numbers they claim to read
 *   - a foreign-currency reporter is either translated or flagged, never both
 *     silent and stamped in rupiah
 *
 * WHY IT RUNS SEVERAL PASSES. Factor computation caches, Maps iterate in
 * insertion order, and the screener sorts on values that tie. A result that
 * changes between two passes over identical data is a bug even when both
 * answers look reasonable, so pass N is compared against pass 1.
 */
import { join } from 'node:path';
import { computeAllFactors } from '../src/models/factorEngine';
import { runStockScreener } from '../src/models/stockScreener';
import { buildWatchlist } from '../src/models/watchlist';
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

    // ---- screener: do the three rules agree with the numbers they read? -----
    const screen = runStockScreener(db);
    for (const [code, row] of screen.all) {
      checks++;
      const maShouldPass = row.close > row.maShort && row.close > row.maLong;
      if (Number.isFinite(row.maShort) && Number.isFinite(row.maLong) && row.passMa !== maShouldPass) {
        fail('screener', `${code} passMa=${row.passMa} tetapi close=${row.close} MA=${row.maShort}/${row.maLong}`);
      }
      assertFinite('screener', code, { close: row.close, volumeShares: row.volumeShares });
      checks++;
      if (row.volumeShares < 0) fail('screener', `${code} volume negatif: ${row.volumeShares}`);
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
