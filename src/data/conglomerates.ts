// Indonesian conglomerate groups.
//
// IMPORTANT — WHERE THIS COMES FROM: IDX publishes no machine-readable
// controlling-shareholder graph, so this table is CURATED, not derived. It
// lists affiliations that are publicly and widely reported, but ownership
// changes, stakes get sold, and new vehicles list. Every group therefore
// carries a `confidence` flag, and the UI shows the measured co-movement of
// each group alongside it — so you can see whether the members actually trade
// together before acting on a "rotation" between them.
//
// Treat this as an editable starting point. Correcting a member here is a
// one-line change and immediately flows through the rotation model.
//
// TWO KINDS OF GROUP live in this table, and the difference matters:
//
//   `keluarga`  — a common controlling shareholder. Capital genuinely moves
//                 between these vehicles, which is what makes rotation a real
//                 pattern rather than a sector story.
//   `negara`    — state (MIND ID / Danantara) clusters. Not a family, but they
//                 share one owner, one policy channel and one flow of
//                 state-mandate money, and on IDX they rotate as hard as any
//                 private group. Labelled distinctly so nobody reads them as a
//                 conglomerate.
//
// An emiten belongs to at most one group. Where a name is genuinely jointly
// controlled — AMMN sits under Medco, Salim and others — it is filed under the
// operator the market prices it against, and the note says so.

export type GroupConfidence = 'high' | 'medium';
export type GroupKind = 'keluarga' | 'negara';

export interface ConglomerateGroup {
  id: string;
  name: string;
  /** The controlling family, holding company or principal, as publicly reported. */
  principal: string;
  /**
   * high   — long-established, widely reported affiliations
   * medium — affiliation reported but the group boundary is looser or newer
   */
  confidence: GroupConfidence;
  kind: GroupKind;
  members: string[];
  note?: string;
}

export const CONGLOMERATE_GROUPS: ConglomerateGroup[] = [
  // -------------------------------------------------------------------------
  // The groups that actually move the index
  // -------------------------------------------------------------------------
  {
    id: 'barito',
    name: 'Barito Pacific',
    principal: 'Prajogo Pangestu',
    confidence: 'high',
    kind: 'keluarga',
    members: ['BRPT', 'TPIA', 'BREN', 'CUAN', 'PTRO', 'CDIA', 'STAR'],
    note: 'Kelompok paling aktif dirotasi di IHSG beberapa tahun terakhir; beberapa anggota baru tercatat.',
  },
  {
    id: 'astra',
    name: 'Astra Group',
    principal: 'Jardine Matheson',
    confidence: 'high',
    kind: 'keluarga',
    members: ['ASII', 'UNTR', 'AALI', 'AUTO', 'ACST', 'ASGR'],
  },
  {
    id: 'salim',
    name: 'Salim Group',
    principal: 'Keluarga Salim (Anthoni Salim)',
    confidence: 'high',
    kind: 'keluarga',
    members: ['INDF', 'ICBP', 'SIMP', 'LSIP', 'DNET', 'META', 'FILM'],
    note: 'SIMP dan LSIP adalah lengan perkebunan; DNET dan FILM lewat Indoritel. AMMN ditempatkan di grup Medco meski Salim ikut mengendalikan.',
  },
  {
    id: 'sinarmas',
    name: 'Sinar Mas',
    principal: 'Keluarga Widjaja',
    confidence: 'high',
    kind: 'keluarga',
    members: ['INKP', 'TKIM', 'SMAR', 'DSSA', 'GEMS', 'BSDE', 'DUTI', 'SMMA', 'BSIM'],
    note: 'GEMS berada di bawah DSSA — energi, kertas, properti dan keuangan dalam satu grup.',
  },
  {
    id: 'bakrie',
    name: 'Bakrie Group',
    principal: 'Keluarga Bakrie',
    confidence: 'high',
    kind: 'keluarga',
    members: ['BUMI', 'BRMS', 'ENRG', 'BNBR', 'ELTY', 'DEWA', 'VKTR'],
  },
  {
    id: 'djarum',
    name: 'Djarum / Hartono',
    principal: 'Keluarga Hartono',
    confidence: 'high',
    kind: 'keluarga',
    members: ['BBCA', 'TOWR', 'SUPR', 'BELI'],
    note: 'BELI (Blibli) lewat Global Digital Niaga.',
  },
  {
    id: 'adaro',
    name: 'Adaro / Alamtri',
    principal: 'Garibaldi Thohir & mitra',
    confidence: 'high',
    kind: 'keluarga',
    members: ['ADRO', 'AADI', 'ADMR'],
  },
  {
    id: 'saratoga',
    name: 'Saratoga / Merdeka',
    principal: 'Edwin Soeryadjaya & Sandiaga Uno',
    confidence: 'high',
    kind: 'keluarga',
    members: ['SRTG', 'MDKA', 'MBMA', 'TBIG'],
  },
  {
    id: 'lippo',
    name: 'Lippo Group',
    principal: 'Keluarga Riady',
    confidence: 'high',
    kind: 'keluarga',
    members: ['LPKR', 'LPCK', 'SILO', 'MPPA', 'MLPL', 'MLPT'],
  },
  {
    id: 'emtek',
    name: 'Emtek Group',
    principal: 'Keluarga Sariaatmadja',
    confidence: 'high',
    kind: 'keluarga',
    members: ['EMTK', 'SCMA', 'BUKA'],
  },
  {
    id: 'mnc',
    name: 'MNC Group',
    principal: 'Hary Tanoesoedibjo',
    confidence: 'high',
    kind: 'keluarga',
    members: ['BHIT', 'MNCN', 'BMTR', 'IPTV', 'MSIN', 'BABP'],
  },
  {
    id: 'panin',
    name: 'Panin Group',
    principal: 'Keluarga Gunawan',
    confidence: 'high',
    kind: 'keluarga',
    members: ['PNBN', 'PNLF', 'PNIN'],
  },

  // -------------------------------------------------------------------------
  // Newer and mid-cap groups
  // -------------------------------------------------------------------------
  {
    id: 'jhonlin',
    name: 'Jhonlin Group',
    principal: 'Andi Syamsuddin Arsyad (Haji Isam)',
    confidence: 'high',
    kind: 'keluarga',
    members: ['JARR', 'BESS'],
    note: 'Basis Batulicin, Kalimantan Selatan. JARR di sawit dan biodiesel, BESS di pelayaran batu bara — keduanya sangat sensitif terhadap kebijakan mandatori biodiesel. Grup kecil: periksa kohesi sebelum menganggapnya satu rotasi.',
  },
  {
    id: 'agung-sedayu',
    name: 'Agung Sedayu / PIK',
    principal: 'Sugianto Kusuma (Aguan) & Keluarga Salim',
    confidence: 'high',
    kind: 'keluarga',
    members: ['PANI', 'CBDK'],
    note: 'Dua kendaraan pengembangan PIK 2. Sebagian besar sahamnya berada di luar kustodian KSEI, jadi persentase kepemilikan institusi di sini dihitung dari basis yang kecil.',
  },
  {
    id: 'harita',
    name: 'Harita Group',
    principal: 'Keluarga Lim',
    confidence: 'high',
    kind: 'keluarga',
    members: ['NCKL', 'CITA'],
    note: 'Nikel (NCKL) dan bauksit (CITA) — satu pemilik, dua komoditas yang tidak selalu bergerak searah.',
  },
  {
    id: 'medco',
    name: 'Medco / Amman',
    principal: 'Keluarga Panigoro & mitra',
    confidence: 'medium',
    kind: 'keluarga',
    members: ['MEDC', 'AMMN'],
    note: 'AMMN dikendalikan bersama oleh Medco, Salim dan pemegang saham lain. Dikelompokkan di sini karena pasar memberi harga keduanya terhadap operator yang sama.',
  },
  {
    id: 'ct-corp',
    name: 'CT Corp',
    principal: 'Chairul Tanjung',
    confidence: 'high',
    kind: 'keluarga',
    members: ['MEGA', 'BBHI'],
  },
  {
    id: 'mayapada',
    name: 'Mayapada Group',
    principal: 'Dato Sri Tahir',
    confidence: 'high',
    kind: 'keluarga',
    members: ['MAYA', 'SRAJ'],
  },
  {
    id: 'kalbe',
    name: 'Kalbe / Enseval',
    principal: 'Keluarga pendiri Kalbe Farma',
    confidence: 'high',
    kind: 'keluarga',
    members: ['KLBF', 'EPMT'],
    note: 'EPMT adalah lengan distribusi KLBF — kohesinya tinggi tapi sebarannya jarang melebar.',
  },
  {
    id: 'erajaya',
    name: 'Erajaya Group',
    principal: 'Ardy Hady Wijaya & mitra',
    confidence: 'high',
    kind: 'keluarga',
    members: ['ERAA', 'ERAL'],
  },
  {
    id: 'tancorp',
    name: 'Tancorp',
    principal: 'Hermanto Tanoko',
    confidence: 'medium',
    kind: 'keluarga',
    members: ['AVIA', 'CLEO', 'DEPO', 'IFSH'],
    note: 'Empat bisnis yang sangat berbeda — cat, air minum, ritel bahan bangunan, nikel. Kohesi terukurnya biasanya rendah; jangan diperlakukan sebagai satu tema.',
  },
  {
    id: 'indika',
    name: 'Indika Energy',
    principal: 'Agus Lasmono & Keluarga Basuki',
    confidence: 'medium',
    kind: 'keluarga',
    members: ['INDY', 'MBSS'],
  },
  {
    id: 'alfamart',
    name: 'Sumber Alfaria',
    principal: 'Djoko Susanto',
    confidence: 'high',
    kind: 'keluarga',
    members: ['AMRT', 'MIDI'],
  },
  {
    id: 'triputra',
    name: 'Triputra / TP Rachmat',
    principal: 'Theodore Permadi Rachmat',
    confidence: 'high',
    kind: 'keluarga',
    members: ['TAPG', 'DRMA', 'DSNG'],
    note: 'DSNG (Dharma Satya Nusantara) sebelumnya salah dikelompokkan ke Wilmar; kendalinya ada di lingkaran TP Rachmat.',
  },
  {
    id: 'sungai-budi',
    name: 'Sungai Budi',
    principal: 'Keluarga Widarto & Santoso',
    confidence: 'medium',
    kind: 'keluarga',
    members: ['TBLA', 'BUDI'],
  },
  {
    id: 'jago',
    name: 'Bank Jago / GoTo',
    principal: 'Jerry Ng, Patrick Walujo & Northstar',
    confidence: 'medium',
    kind: 'keluarga',
    members: ['ARTO', 'GOTO'],
    note: 'Bukan satu pengendali: GOTO memegang saham ARTO dan lingkaran pemegang sahamnya beririsan. Dikelompokkan karena aliran dananya beririsan, bukan karena satu keluarga.',
  },

  // -------------------------------------------------------------------------
  // State clusters — one owner, one policy channel
  // -------------------------------------------------------------------------
  {
    id: 'bumn-bank',
    name: 'Bank BUMN',
    principal: 'Danantara / Kementerian BUMN',
    confidence: 'high',
    kind: 'negara',
    members: ['BBRI', 'BMRI', 'BBNI', 'BBTN'],
    note: 'Biasanya kohesi tertinggi di seluruh tabel ini: keempatnya bereaksi pada suku bunga dan arus asing yang sama.',
  },
  {
    id: 'bumn-tambang',
    name: 'MIND ID (tambang negara)',
    principal: 'MIND ID / Danantara',
    confidence: 'high',
    kind: 'negara',
    members: ['ANTM', 'PTBA', 'TINS', 'INCO'],
    note: 'Satu induk, empat komoditas berbeda. Sebaran lebar di grup ini sering soal harga komoditas, bukan rotasi antar anggota.',
  },
  {
    id: 'bumn-karya',
    name: 'BUMN Karya',
    principal: 'Kementerian BUMN',
    confidence: 'high',
    kind: 'negara',
    members: ['WIKA', 'PTPP', 'ADHI', 'WSKT'],
    note: 'Bergerak pada berita restrukturisasi dan anggaran, bukan pada laba. Perlakukan sebagai kelompok peristiwa.',
  },
  {
    id: 'bumn-infra',
    name: 'Infrastruktur & telko negara',
    principal: 'Danantara / Kementerian BUMN',
    confidence: 'high',
    kind: 'negara',
    members: ['TLKM', 'MTEL', 'JSMR', 'SMGR', 'PGAS', 'ELSA', 'IPCC'],
    note: 'IPCC adalah anak usaha Pelindo — sebelumnya keliru masuk grup Salim.',
  },
  {
    id: 'bumn-farmasi',
    name: 'Farmasi negara',
    principal: 'Bio Farma / Kementerian BUMN',
    confidence: 'high',
    kind: 'negara',
    members: ['KAEF', 'INAF'],
  },
];

/** Emiten code -> group id. An emiten belongs to at most one group. */
export const GROUP_BY_CODE: Record<string, string> = CONGLOMERATE_GROUPS.reduce(
  (acc, g) => {
    for (const code of g.members) acc[code] = g.id;
    return acc;
  },
  {} as Record<string, string>
);

export function groupOf(code: string): ConglomerateGroup | null {
  const id = GROUP_BY_CODE[code];
  return id ? CONGLOMERATE_GROUPS.find((g) => g.id === id) || null : null;
}

/**
 * Guard against the one editing mistake that silently corrupts the rotation
 * model: the same code listed in two groups, which makes GROUP_BY_CODE resolve
 * to whichever came last and quietly drops the member from the other group.
 */
export function findDuplicateMembers(): { code: string; groups: string[] }[] {
  const seen = new Map<string, string[]>();
  for (const g of CONGLOMERATE_GROUPS) {
    for (const code of g.members) {
      const list = seen.get(code) ?? [];
      list.push(g.id);
      seen.set(code, list);
    }
  }
  return [...seen.entries()].filter(([, groups]) => groups.length > 1).map(([code, groups]) => ({ code, groups }));
}
