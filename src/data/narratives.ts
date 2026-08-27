// Thematic narratives — the policy and project stories the market trades on.
//
// WHY THIS FILE EXISTS. The watchlist starts from narrative, and half of an
// Indonesian narrative never reaches IDX. A company files with the exchange
// when IT does something; it does not file when the government announces a
// 100 GW solar programme, a biodiesel mandate, or three million houses a year.
// Those are the stories that move whole baskets, and there is no public
// machine-readable feed for them anywhere.
//
// SO THIS TABLE IS CURATED, exactly like src/data/conglomerates.ts, and carries
// the same discipline:
//
//   · `source` is where the curator read it. An EMPTY source is shown in the UI
//     as "sumber belum diisi" and the theme's contribution is halved — an
//     unsourced theme is a hunch, and the app says so rather than laundering it
//     into a score.
//   · `checkedOn` is when a human last confirmed the theme is still live. A
//     theme decays automatically after 90 days, because policy narratives go
//     stale faster than anything else in this app and a forgotten row would
//     otherwise keep voting forever.
//   · `exposure` separates a company that sells into the programme from one
//     that merely sits in an adjacent sector. Mapping "cement" to "houses" is
//     fair; calling it direct exposure is not.
//
// Editing a row here is a one-line change that flows straight into the weekly
// and monthly watchlists. Adding your own theme is the intended use.

export type ThemeConfidence = 'high' | 'medium';
export type ThemeExposure = 'langsung' | 'tidak-langsung';

export interface ThemeMember {
  code: string;
  /** Why this emiten is exposed. Shown verbatim in the UI — write it for a reader. */
  why: string;
  exposure: ThemeExposure;
}

export interface NarrativeTheme {
  id: string;
  name: string;
  /** The policy or project driving it, in one line. */
  driver: string;
  /** URL the curator read it in. Empty is allowed and is shown as unsourced. */
  source: string;
  /** YYYY-MM-DD a human last confirmed this theme is still live. */
  checkedOn: string;
  confidence: ThemeConfidence;
  members: ThemeMember[];
  note?: string;
}

export const NARRATIVE_THEMES: NarrativeTheme[] = [
  {
    id: 'plts-energi-terbarukan',
    name: 'PLTS & transisi energi',
    driver:
      'Program pembangkit listrik tenaga surya skala besar dan target bauran energi terbarukan dalam RUPTL PLN.',
    source: '',
    checkedOn: '2026-08-27',
    confidence: 'medium',
    members: [
      { code: 'JSKY', why: 'Produsen modul surya — satu-satunya pabrikan panel yang tercatat di IDX.', exposure: 'langsung' },
      { code: 'KBLI', why: 'Kabel listrik; setiap tambahan kapasitas pembangkit menuntut jaringan.', exposure: 'tidak-langsung' },
      { code: 'SCCO', why: 'Kabel dan konduktor transmisi.', exposure: 'tidak-langsung' },
      { code: 'KEEN', why: 'Pembangkit listrik tenaga air — energi terbarukan non-surya di keranjang yang sama.', exposure: 'tidak-langsung' },
      { code: 'ARKO', why: 'Pembangkit listrik tenaga minihidro.', exposure: 'tidak-langsung' },
      { code: 'PGEO', why: 'Panas bumi; bagian dari target bauran EBT yang sama.', exposure: 'tidak-langsung' },
      { code: 'TOBA', why: 'Portofolio bergeser dari batu bara ke energi terbarukan dan kendaraan listrik.', exposure: 'tidak-langsung' },
      { code: 'POWR', why: 'Pembangkit dan distribusi listrik kawasan industri.', exposure: 'tidak-langsung' },
    ],
    note:
      'Hanya JSKY yang eksposurnya benar-benar langsung ke panel surya; sisanya adalah rantai pasok listrik yang ikut terangkat bila belanja pembangkit naik. Isi `source` dengan tautan berita atau dokumen RUPTL sebelum memakai tema ini sebagai dasar keputusan.',
  },
  {
    id: 'hilirisasi-nikel',
    name: 'Hilirisasi nikel & baterai',
    driver: 'Larangan ekspor bijih mentah dan dorongan rantai nilai baterai kendaraan listrik di dalam negeri.',
    source: '',
    checkedOn: '2026-08-27',
    confidence: 'high',
    members: [
      { code: 'NCKL', why: 'Smelter HPAL dan RKEF terintegrasi.', exposure: 'langsung' },
      { code: 'MBMA', why: 'Smelter nikel dan proyek HPAL di Morowali.', exposure: 'langsung' },
      { code: 'INCO', why: 'Tambang dan pengolahan nikel matte terbesar.', exposure: 'langsung' },
      { code: 'ANTM', why: 'Bijih nikel dan feronikel; juga kendaraan negara di rantai baterai.', exposure: 'langsung' },
      { code: 'IFSH', why: 'Tambang bijih nikel skala kecil.', exposure: 'langsung' },
      { code: 'MDKA', why: 'Induk MBMA, dengan tembaga dan emas sebagai penyeimbang.', exposure: 'tidak-langsung' },
      { code: 'HRUM', why: 'Batu bara yang mendiversifikasi ke nikel.', exposure: 'tidak-langsung' },
    ],
  },
  {
    id: 'biodiesel-b40',
    name: 'Mandatori biodiesel B40/B50',
    driver: 'Kenaikan kandungan wajib bahan bakar nabati yang menyerap CPO ke pasar domestik.',
    source: '',
    checkedOn: '2026-08-27',
    confidence: 'high',
    members: [
      { code: 'TBLA', why: 'Produsen biodiesel terintegrasi dengan perkebunan sendiri.', exposure: 'langsung' },
      { code: 'JARR', why: 'Pabrik biodiesel Jhonlin di Kalimantan Selatan.', exposure: 'langsung' },
      { code: 'DSNG', why: 'CPO terintegrasi dengan lini bioenergi.', exposure: 'langsung' },
      { code: 'SGRO', why: 'Perkebunan dan pengolahan CPO.', exposure: 'tidak-langsung' },
      { code: 'AALI', why: 'Perkebunan CPO skala besar; penyerapan domestik menopang harga.', exposure: 'tidak-langsung' },
      { code: 'LSIP', why: 'Perkebunan CPO.', exposure: 'tidak-langsung' },
      { code: 'SIMP', why: 'CPO terintegrasi Salim.', exposure: 'tidak-langsung' },
      { code: 'TAPG', why: 'Perkebunan CPO Triputra.', exposure: 'tidak-langsung' },
    ],
  },
  {
    id: 'makan-bergizi-gratis',
    name: 'Makan Bergizi Gratis',
    driver: 'Program makan bergizi nasional yang menaikkan permintaan protein, susu, dan beras terstruktur.',
    source: '',
    checkedOn: '2026-08-27',
    confidence: 'medium',
    members: [
      { code: 'CPIN', why: 'Pakan dan ayam broiler — protein terbesar dalam menu program.', exposure: 'langsung' },
      { code: 'JPFA', why: 'Pakan, ayam, dan pengolahan protein.', exposure: 'langsung' },
      { code: 'MAIN', why: 'Pakan dan unggas terintegrasi.', exposure: 'langsung' },
      { code: 'CMRY', why: 'Susu dan produk protein konsumen.', exposure: 'langsung' },
      { code: 'ULTJ', why: 'Susu cair — kategori yang secara eksplisit disebut dalam program.', exposure: 'langsung' },
      { code: 'ICBP', why: 'Makanan olahan bervolume besar.', exposure: 'tidak-langsung' },
      { code: 'AMRT', why: 'Distribusi dan logistik ritel yang bisa menjadi kanal penyaluran.', exposure: 'tidak-langsung' },
    ],
    note:
      'Skala anggaran dan mekanisme pengadaan program ini berubah beberapa kali. Perlakukan sebagai tema arah, bukan sebagai kontrak yang sudah pasti masuk ke satu emiten.',
  },
  {
    id: 'tiga-juta-rumah',
    name: 'Program tiga juta rumah',
    driver: 'Target pembangunan perumahan rakyat tahunan yang menyerap semen, keramik, dan jasa konstruksi.',
    source: '',
    checkedOn: '2026-08-27',
    confidence: 'medium',
    members: [
      { code: 'SMGR', why: 'Semen dengan pangsa terbesar dan utilisasi pabrik yang masih longgar.', exposure: 'langsung' },
      { code: 'INTP', why: 'Semen; permintaan perumahan adalah segmen ritelnya.', exposure: 'langsung' },
      { code: 'SMBR', why: 'Semen regional Sumatera.', exposure: 'langsung' },
      { code: 'ARNA', why: 'Keramik lantai dan dinding untuk segmen menengah bawah.', exposure: 'langsung' },
      { code: 'ADHI', why: 'Kontraktor negara yang mengerjakan perumahan dan infrastruktur pendukung.', exposure: 'tidak-langsung' },
      { code: 'CTRA', why: 'Pengembang dengan porsi rumah tapak menengah yang besar.', exposure: 'tidak-langsung' },
      { code: 'BSDE', why: 'Pengembang skala kota mandiri.', exposure: 'tidak-langsung' },
      { code: 'BBTN', why: 'Bank penyalur KPR subsidi utama.', exposure: 'langsung' },
    ],
  },
  {
    id: 'pusat-data-ai',
    name: 'Pusat data & konektivitas AI',
    driver: 'Belanja pusat data dan kapasitas komputasi yang menaikkan permintaan kolokasi, menara, dan serat optik.',
    source: '',
    checkedOn: '2026-08-27',
    confidence: 'medium',
    members: [
      { code: 'DCII', why: 'Operator pusat data murni.', exposure: 'langsung' },
      { code: 'EDGE', why: 'Pusat data dan infrastruktur digital.', exposure: 'langsung' },
      { code: 'WIFI', why: 'Jaringan serat dan konektivitas ritel.', exposure: 'tidak-langsung' },
      { code: 'MTEL', why: 'Menara dan serat optik milik negara.', exposure: 'tidak-langsung' },
      { code: 'TOWR', why: 'Menara dan serat optik.', exposure: 'tidak-langsung' },
      { code: 'TBIG', why: 'Menara telekomunikasi.', exposure: 'tidak-langsung' },
    ],
  },
];

/** Emiten code -> the themes it appears in. An emiten may belong to several. */
export const THEMES_BY_CODE: Map<string, { theme: NarrativeTheme; member: ThemeMember }[]> = (() => {
  const map = new Map<string, { theme: NarrativeTheme; member: ThemeMember }[]>();
  for (const theme of NARRATIVE_THEMES) {
    for (const member of theme.members) {
      const list = map.get(member.code) ?? [];
      list.push({ theme, member });
      map.set(member.code, list);
    }
  }
  return map;
})();

const EXPOSURE_WEIGHT: Record<ThemeExposure, number> = {
  langsung: 1,
  'tidak-langsung': 0.5,
};

const CONFIDENCE_WEIGHT: Record<ThemeConfidence, number> = {
  high: 1,
  medium: 0.75,
};

/**
 * How much a curated theme is allowed to contribute today, 0-1.
 *
 * Three discounts compound, and each corresponds to a real reason to trust the
 * row less: indirect exposure, a curator who was not certain, and a row nobody
 * has re-checked. Staleness decays linearly to zero over 90 days past the
 * check date — a policy narrative that nobody has confirmed in three months is
 * not evidence, and leaving it at full strength is how a watchlist quietly
 * starts trading last quarter's story.
 */
export function themeWeight(theme: NarrativeTheme, member: ThemeMember, asOf: string): number {
  const checked = Date.parse(theme.checkedOn);
  const now = Date.parse(asOf);
  const ageDays = Number.isFinite(checked) && Number.isFinite(now) ? Math.max(0, (now - checked) / 86400000) : 0;
  const freshness = Math.max(0, 1 - ageDays / 90);
  // An unsourced theme is a hunch until somebody writes down where it came from.
  const sourced = theme.source.trim() ? 1 : 0.5;
  return EXPOSURE_WEIGHT[member.exposure] * CONFIDENCE_WEIGHT[theme.confidence] * freshness * sourced;
}
