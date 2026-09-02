// AI summary of one IDX disclosure, read from the actual PDF.
//
// ── WHY IT READS THE DOCUMENT AND NOT THE TITLE ───────────────────────────
//
// Everything else in this app that touches announcements works from the TITLE:
// the taxonomy, the narrative score, the category chips. The feed says so on
// screen — "kategori dan bobot dihitung dari judul, bukan dari isi dokumen" —
// and that is an honest limit for a classifier.
//
// It would not be honest for something labelled a summary. A model handed only
// "Laporan Keterbukaan Informasi: Penambahan Modal Tanpa HMETD" can produce a
// fluent paragraph about what such a filing usually contains, and every
// sentence of it would be invention dressed as reading. The whole value of this
// dataset is that the primary source is a document a human can open, so the
// summary opens it too.
//
// ── HOW THE PDF IS FETCHED ────────────────────────────────────────────────
//
// Through curl, like every other IDX request in this repo: Node's built-in
// fetch is refused by IDX on TLS fingerprint alone (see scripts/idx-lib.mjs).
// The bytes then go to Claude as a document block rather than through a text
// extractor, which keeps a PDF-parsing dependency out of the tree entirely and
// handles the scanned filings that carry no text layer at all.
//
// ── WHY EVERY SUMMARY IS CACHED FOREVER ───────────────────────────────────
//
// A filing is immutable once published: the same URL is the same bytes next
// year. Re-summarising it would spend money and time to produce a slightly
// differently-worded version of a paragraph nobody asked to have rewritten, and
// two people reading the same filing would see different summaries. Cached by
// the PDF path, which is what actually identifies the document.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import Anthropic from '@anthropic-ai/sdk';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/**
 * Haiku, not Sonnet. This is extraction from a document that is usually two
 * pages long, the answer is graded by whether it matches the PDF sitting one
 * click away, and the screen invites re-reading rather than trust. Paying
 * Sonnet rates per filing for that would be a bad trade — and the model is a
 * one-line change if the summaries ever disappoint.
 */
const MODEL = 'claude-haiku-4-5-20251001';

/** Bigger than this and it is an annual report, not a disclosure. */
const MAX_PDF_BYTES = 8 * 1024 * 1024;

export interface DisclosureSummary {
  /** The PDF path, which is what identifies the document. */
  key: string;
  code: string;
  date: string;
  title: string;
  summary: string;
  /** What the model could NOT find in the document, in its own words. */
  model: string;
  generatedAt: string;
  pdfBytes: number;
}

type Cache = Record<string, DisclosureSummary>;

function curlBuffer(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      'curl',
      ['-s', '-L', '-m', '45', '-A', UA, '--max-filesize', String(MAX_PDF_BYTES), url],
      { encoding: 'buffer', maxBuffer: MAX_PDF_BYTES + 1024 },
      (err, stdout) => (err ? reject(err) : resolve(stdout as unknown as Buffer))
    );
  });
}

async function readCache(path: string): Promise<Cache> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Cache;
  } catch {
    // A missing or unreadable cache costs one re-summary, never a wrong answer,
    // so unlike the pick journal this one may safely fall back to empty.
    return {};
  }
}

/**
 * The instruction, and why each line of it is there.
 *
 * The failure mode for this feature is not a crash, it is a confident summary
 * of a document the model only half read — a number transcribed without its
 * unit, a plan described as a completed transaction, a "material impact"
 * asserted because filings usually claim one. Each rule below closes one of
 * those, and the last one keeps the app's standing promise: this is a research
 * tool, and it does not tell anybody what to buy.
 */
const SYSTEM = [
  'Anda meringkas dokumen keterbukaan informasi resmi Bursa Efek Indonesia untuk seorang analis.',
  '',
  'ATURAN:',
  '1. Ringkas HANYA apa yang tertulis di dokumen. Kalau dokumen tidak menyebut sesuatu, katakan tidak disebut — jangan mengisi dari pengetahuan umum tentang jenis pengajuan ini.',
  '2. Angka wajib dibawa lengkap dengan satuan dan mata uangnya persis seperti tertulis (miliar/juta, Rp/USD, lembar/lot). Jangan mengonversi.',
  '2b. Kalau sebuah angka punya ekor desimal yang jelas artefak komputasi (misalnya 5,789999961853027), tulis bentuk wajarnya (5,79). Ini SATU-SATUNYA perubahan angka yang diizinkan; nilainya tidak boleh bergeser.',
  '3. Bedakan RENCANA dari yang SUDAH TERJADI. "Akan", "berencana", "sedang dalam proses" tidak boleh ditulis seolah sudah selesai.',
  '4. Sebutkan tanggal efektif, pihak yang terlibat, dan nilai transaksi kalau ada. Kalau tidak ada, sebutkan tidak ada.',
  '5. Jangan menilai dampaknya ke harga saham. Jangan memberi rekomendasi beli, jual, atau tahan.',
  '6. Kalau dokumen tidak terbaca (hasil pindaian buram, halaman kosong), katakan itu dan berhenti.',
  '',
  'FORMAT: bahasa Indonesia, maksimal 5 kalimat, satu paragraf. Kalimat pertama menjawab "apa yang sebenarnya diumumkan".',
  'DILARANG: judul, heading markdown, daftar berpoin, teks tebal. Mulai langsung dari kalimat pertama — nama emiten sudah tercetak di layar tepat di atas ringkasan ini.',
].join('\n');

/**
 * Strip the formatting the prompt already asked it not to produce.
 *
 * The instruction is not enough on its own — measured on the first live
 * filing, the model opened with a markdown H1 under a prompt that said no
 * headings. The UI renders this as PLAIN TEXT, so a stray hash or a pair of
 * asterisks shows up literally on screen. Belt and braces: keep asking, and
 * clean up whatever still arrives.
 */
function tidy(text: string): string {
  const NL = String.fromCharCode(10);
  return text
    .split(NL)
    // Drop heading lines outright; keep everything else, minus its bullet
    // marker and its bold markers.
    .filter((line) => !/^\s{0,3}#{1,6}\s/.test(line))
    .map((line) => line.replace(/^\s{0,3}[-*+]\s+/, '').replace(/\*\*([^*]+)\*\*/g, '$1'))
    .join(NL)
    .replace(new RegExp(NL + '{3,}', 'g'), NL + NL)
    .trim();
}

export async function summariseDisclosure(
  input: { code: string; date: string; title: string; pdfUrl: string; key: string },
  cachePath: string,
  apiKey: string
): Promise<DisclosureSummary> {
  const cache = await readCache(cachePath);
  const hit = cache[input.key];
  if (hit) return hit;

  if (!apiKey) throw new Error('ANTHROPIC_API_KEY belum diset di .env — ringkasan AI tidak bisa dibuat');
  if (!input.pdfUrl) throw new Error('Pengajuan ini tidak punya lampiran PDF untuk dibaca');

  const pdf = await curlBuffer(input.pdfUrl).catch((err) => {
    throw new Error(`PDF tidak bisa diambil dari IDX (${(err as Error).message.slice(0, 80)})`);
  });
  if (!pdf.length) throw new Error('IDX mengembalikan berkas kosong');
  // A rejected request comes back as an HTML error page with a 200, which would
  // otherwise be sent to the model as if it were the filing.
  if (pdf.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error('IDX tidak mengembalikan PDF (kemungkinan tautannya sudah dipindah atau dihapus)');
  }
  if (pdf.length > MAX_PDF_BYTES) throw new Error(`PDF terlalu besar (${(pdf.length / 1e6).toFixed(1)} MB)`);

  const client = new Anthropic({ apiKey });
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 700,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64') },
          },
          {
            type: 'text',
            text: `Emiten ${input.code}, diajukan ${input.date}. Judul menurut IDX: "${input.title}". Ringkas dokumen terlampir.`,
          },
        ],
      },
    ],
  });

  const summary = res.content
    .filter((c): c is Anthropic.TextBlock => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .trim();
  const cleaned = tidy(summary);
  if (!cleaned) throw new Error('Model tidak mengembalikan teks apa pun');

  const entry: DisclosureSummary = {
    key: input.key,
    code: input.code,
    date: input.date,
    title: input.title,
    summary: cleaned,
    model: MODEL,
    generatedAt: new Date().toISOString(),
    pdfBytes: pdf.length,
  };

  cache[input.key] = entry;
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(cache, null, 2));
  return entry;
}

export const summaryCachePathFor = (root: string) => join(root, '.data', 'disclosure-summaries.json');
