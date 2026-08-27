// IDX keterbukaan informasi — classification and narrative scoring.
//
// WHY A TAXONOMY AT ALL. In a 45-day window IDX receives ~3,200 filings from
// ~925 emiten, and roughly two thirds of them are calendar hygiene: monthly
// shareholder registers, interim financials, changes of corporate secretary.
// Feeding that raw into a watchlist would rank the market by how diligently its
// compliance departments file paperwork. What matters is the small minority
// that changes what a company is worth — a contract won, a stake bought, a
// rights issue priced.
//
// HOW IT CLASSIFIES. Ordered regex rules over the filing title, first match
// wins. Order is load-bearing and not alphabetical: "Penyampaian Bukti Iklan
// Transaksi Material" must land on the material transaction, not on the
// routine "bukti iklan" it is wrapped in, so specific material patterns are
// tested before generic routine ones. `classifyAnnouncement` is pure and
// testable; the ingest script stores filings verbatim precisely so that
// retuning this file never requires re-crawling IDX.
//
// WHAT THE MATERIALITY WEIGHT IS NOT. It is not a direction. "Perolehan atau
// kehilangan kontrak penting" is IDX's own title and covers a contract WON and
// a contract LOST with the same words; a legal proceeding is material and bad.
// The weight says "this filing is worth reading", never "this is bullish". The
// UI labels the category and links the PDF so the reader decides.

export interface RawAnnouncement {
  code: string;
  date: string;
  title: string;
  subject?: string;
  /** PDF path relative to the file's `pdfBase`. */
  url?: string;
}

export interface AnnouncementsFile {
  generatedAt: string;
  from: string;
  to: string;
  count: number;
  emitenCount: number;
  source: string;
  pdfBase: string;
  scope: string;
  announcements: RawAnnouncement[];
}

export type AnnouncementCategory =
  | 'ekspansi'
  | 'struktur-modal'
  | 'dividen'
  | 'perhatian-bursa'
  | 'hukum'
  | 'rups'
  | 'utang'
  | 'keuangan'
  | 'rutin';

export interface CategoryMeta {
  label: string;
  /** How much a filing of this kind is worth reading, 0-1. Never a direction. */
  materiality: number;
  tone: 'peluang' | 'netral' | 'risiko';
  hint: string;
}

export const CATEGORY_META: Record<AnnouncementCategory, CategoryMeta> = {
  ekspansi: {
    label: 'Ekspansi & transaksi',
    materiality: 1,
    tone: 'peluang',
    hint: 'Kontrak, akuisisi, perjanjian, proyek, atau transaksi material — hal yang benar-benar mengubah isi perusahaan.',
  },
  'struktur-modal': {
    label: 'Struktur modal',
    materiality: 0.85,
    tone: 'netral',
    hint: 'Rights issue, private placement, buyback, stock split, atau perubahan pemegang saham pengendali.',
  },
  dividen: {
    label: 'Dividen',
    materiality: 0.7,
    tone: 'peluang',
    hint: 'Pengumuman dan jadwal pembagian dividen.',
  },
  'perhatian-bursa': {
    label: 'Perhatian bursa',
    materiality: 0.6,
    tone: 'risiko',
    hint: 'UMA, permintaan penjelasan bursa, atau tanggapan atas pemberitaan media. Artinya harga sudah bergerak dan bursa bertanya kenapa — sinyal sekaligus peringatan.',
  },
  hukum: {
    label: 'Perkara hukum',
    materiality: 0.55,
    tone: 'risiko',
    hint: 'Gugatan, PKPU, atau kepailitan yang menyangkut emiten atau pengurusnya.',
  },
  rups: {
    label: 'RUPS',
    materiality: 0.35,
    tone: 'netral',
    hint: 'Pemberitahuan, pemanggilan, dan hasil rapat pemegang saham. Sering menjadi wadah aksi korporasi, tetapi judulnya sendiri belum memberi tahu apa isinya.',
  },
  utang: {
    label: 'Obligasi & pinjaman',
    materiality: 0.3,
    tone: 'netral',
    hint: 'Penerbitan, pelunasan, pemeringkatan, RUPO, dan fasilitas kredit.',
  },
  keuangan: {
    label: 'Laporan keuangan',
    materiality: 0.15,
    tone: 'netral',
    hint: 'Penyampaian laporan keuangan, laporan tahunan, dan public expose — terjadwal, jarang mengejutkan.',
  },
  rutin: {
    label: 'Administratif',
    materiality: 0,
    tone: 'netral',
    hint: 'Registrasi pemegang efek bulanan, perubahan komite atau alamat, bukti iklan. Tidak pernah menggerakkan harga.',
  },
};

interface Rule {
  category: AnnouncementCategory;
  test: RegExp;
}

/**
 * ORDER IS THE ALGORITHM. Read top to bottom; the first hit wins.
 *
 * The three groups at the top exist to defuse specific collisions:
 *   · "Laporan Penggunaan Dana Hasil Penawaran Umum" contains "penawaran umum"
 *     but is a quarterly compliance report, not a capital raise.
 *   · "Laporan Pengalihan Kembali Saham Hasil Buy Back" contains "buy back"
 *     but is the routine reporting of treasury disposals, not a new programme.
 *   · "Rencana Penyampaian Laporan Keuangan ..." is a scheduling notice about
 *     a report that does not exist yet.
 * Each would otherwise be promoted into a material category by a later rule,
 * and each is among the most numerous filings in the feed.
 */
const RULES: Rule[] = [
  // --- defused collisions, highest priority
  { category: 'rutin', test: /penggunaan dana hasil penawaran umum/i },
  { category: 'rutin', test: /pengalihan kembali saham hasil buy ?back/i },
  { category: 'rutin', test: /rencana penyampaian laporan keuangan/i },
  { category: 'rutin', test: /laporan bulanan registrasi/i },
  // A credit-rating report carries the words "fakta material" in its own IDX
  // title; it is still a rating report, so it is settled before the material
  // patterns get a look.
  { category: 'utang', test: /pemeringkatan/i },

  // --- the filings that change what a company is
  {
    category: 'ekspansi',
    test: /kontrak|pengambilalihan|akuisisi|divestasi|penggabungan usaha|peleburan usaha|pemisahan usaha|usaha patungan|joint venture|transaksi material|transaksi afiliasi|perjanjian kerja ?sama|penandatanganan perjanjian|penandatanganan akta|pendirian (anak )?perusahaan|penyertaan (modal|saham)|perubahan kegiatan usaha|pembelian atau penjualan saham perusahaan yang nilainya material/i,
  },
  {
    category: 'struktur-modal',
    test: /penambahan modal|hmetd|pmthmetd|rights? issue|buy ?back|pembelian kembali saham|stock split|pemecahan saham|saham bonus|perubahan struktur pemegang saham|pemegang saham pengendali|penggabungan nilai nominal|reverse stock/i,
  },
  { category: 'dividen', test: /dividen/i },

  // --- the exchange is asking, or a court is
  { category: 'perhatian-bursa', test: /volatilitas transaksi|permintaan penjelasan bursa|pemberitaan media massa|suspensi|penghentian sementara perdagangan|unusual market activity/i },
  { category: 'hukum', test: /perkara hukum|penundaan kewajiban pembayaran utang|pkpu|kepailitan|pailit|gugatan/i },

  // --- calendar and plumbing
  { category: 'rups', test: /rapat umum pemegang saham|rups|risalah rapat umum/i },
  { category: 'utang', test: /obligasi|sukuk|rupo|pelunasan|perjanjian kredit|fasilitas pinjaman|fasilitas kredit|pemeringkatan|efek bersifat utang/i },
  { category: 'keuangan', test: /laporan keuangan|laporan tahunan|public expose|prospektus|kinerja (semester|kuartal)/i },

  // Last resort. "Fakta material", "siaran pers" and "keterbukaan informasi"
  // are wrappers, not subjects — a press release about a buyback is a buyback
  // filing and a press release about half-year results is an earnings filing.
  // Sitting at the bottom, this rule only catches the ones nothing more
  // specific claimed, which are genuinely material and simply unlabelled.
  { category: 'ekspansi', test: /fakta material|siaran pers|press release|keterbukaan informasi material|informasi penting/i },
];

export function classifyAnnouncement(title: string): AnnouncementCategory {
  for (const rule of RULES) if (rule.test.test(title)) return rule.category;
  return 'rutin';
}

export interface ClassifiedAnnouncement extends RawAnnouncement {
  category: AnnouncementCategory;
  meta: CategoryMeta;
  /** Days between the filing and the file's `to` date. */
  ageDays: number;
  /** materiality x recency. What the emiten's narrative score is summed from. */
  weight: number;
  /** Absolute PDF link, or '' when IDX filed no attachment. */
  pdfUrl: string;
}

export interface NarrativeSignal {
  code: string;
  /** 0-1. Saturating, so ten routine filings never outrank one acquisition. */
  score: number;
  filings: ClassifiedAnnouncement[];
  /** Only the ones that actually earned score, newest first. */
  material: ClassifiedAnnouncement[];
  /**
   * The single filing carrying the most weight — materiality x recency.
   *
   * NOT the same as `material[0]`, which is merely the newest. A bond-holder
   * meeting notice filed yesterday is newer than an acquisition filed three
   * weeks ago and is not the story.
   */
  top: ClassifiedAnnouncement | null;
  topCategory: AnnouncementCategory | null;
  /** True when the exchange has asked this emiten to explain itself. */
  underExchangeAttention: boolean;
  headline: string;
}

const dayDiff = (a: string, b: string) => {
  const t1 = Date.parse(a);
  const t2 = Date.parse(b);
  return Number.isFinite(t1) && Number.isFinite(t2) ? Math.max(0, Math.round((t2 - t1) / 86400000)) : 0;
};

/**
 * Build a per-emiten narrative signal.
 *
 * `halfLifeDays` is what makes the weekly and monthly watchlists differ at this
 * stage: on a one-week horizon a filing from three weeks ago is old news, on a
 * one-month horizon it is still the reason the stock is moving.
 */
export function buildNarrativeSignals(
  file: AnnouncementsFile,
  halfLifeDays: number
): Map<string, NarrativeSignal> {
  const asOf = file.to;
  const byCode = new Map<string, ClassifiedAnnouncement[]>();

  for (const raw of file.announcements) {
    const category = classifyAnnouncement(raw.title);
    const meta = CATEGORY_META[category];
    const ageDays = dayDiff(raw.date, asOf);
    // Exponential decay on the given half-life: a filing exactly one half-life
    // old counts half as much as one filed today.
    const recency = Math.pow(0.5, ageDays / Math.max(1, halfLifeDays));
    const list = byCode.get(raw.code) ?? [];
    list.push({
      ...raw,
      category,
      meta,
      ageDays,
      weight: meta.materiality * recency,
      pdfUrl: raw.url ? file.pdfBase + raw.url : '',
    });
    byCode.set(raw.code, list);
  }

  const out = new Map<string, NarrativeSignal>();

  for (const [code, filings] of byCode) {
    filings.sort((a, b) => b.date.localeCompare(a.date));
    const material = filings.filter((f) => f.weight > 0.05);
    const raw = material.reduce((s, f) => s + f.weight, 0);

    // Saturating rather than linear: the difference between one acquisition and
    // none is the whole signal, while the difference between six routine
    // filings and seven is nothing at all.
    const score = 1 - Math.exp(-raw / 1.2);

    const top = material.reduce<ClassifiedAnnouncement | null>(
      (best, f) => (!best || f.weight > best.weight ? f : best),
      null
    );

    const underExchangeAttention = filings.some(
      (f) => f.category === 'perhatian-bursa' && f.ageDays <= Math.max(14, halfLifeDays)
    );

    out.set(code, {
      code,
      score,
      filings,
      material,
      top,
      topCategory: top ? top.category : null,
      underExchangeAttention,
      headline: top ? top.title : 'Tidak ada pengajuan material dalam jendela ini.',
    });
  }

  return out;
}

/** Distribution of categories across the whole file — used by the UI header. */
export function summariseAnnouncements(file: AnnouncementsFile): {
  total: number;
  byCategory: { category: AnnouncementCategory; label: string; count: number }[];
} {
  const counts = new Map<AnnouncementCategory, number>();
  for (const a of file.announcements) {
    const c = classifyAnnouncement(a.title);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const byCategory = [...counts.entries()]
    .map(([category, count]) => ({ category, label: CATEGORY_META[category].label, count }))
    .sort((a, b) => b.count - a.count);
  return { total: file.announcements.length, byCategory };
}
