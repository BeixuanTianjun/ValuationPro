/**
 * preview-dossier.ts — print exactly what the chatbot hands Claude.
 *
 *   npm run chat:dossier -- BBRI
 *
 * WHY THIS EXISTS. The dossier is the whole answer quality of `kupas_emiten`:
 * the model cannot connect dots that are not in it, and cannot be stopped from
 * inventing dots that are missing. When an answer is wrong the first question is
 * always "what did it actually see", and guessing at that from the reply is how
 * you end up tuning the prompt to fix a data problem. This prints the input.
 *
 * No API key needed and nothing is sent anywhere — it builds the same text the
 * tool would return and writes it to stdout.
 */
import { join } from 'node:path';
import { buildDossier } from '../src/server/chatApi';
import { computeAllFactors } from '../src/models/factorEngine';
import {
  loadChatContextFromDisk,
  loadFundamentalsFromDisk,
  loadMarketDatabaseFromDisk,
} from '../src/server/marketFromDisk';

const DATA = join(process.cwd(), 'public', 'data', 'idx');
const code = process.argv[2] || 'PACK';

(async () => {
  const [db, fundamentals, ctx] = await Promise.all([
    loadMarketDatabaseFromDisk(DATA),
    loadFundamentalsFromDisk(DATA),
    loadChatContextFromDisk(DATA),
  ]);
  const factors = computeAllFactors(db);
  console.log(buildDossier(code, db, factors, fundamentals, ctx));
})();
