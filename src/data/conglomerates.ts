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

export type GroupConfidence = 'high' | 'medium';

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
  members: string[];
  note?: string;
}

export const CONGLOMERATE_GROUPS: ConglomerateGroup[] = [
  {
    id: 'barito',
    name: 'Barito Pacific',
    principal: 'Prajogo Pangestu',
    confidence: 'high',
    members: ['BRPT', 'TPIA', 'BREN', 'CUAN', 'PTRO', 'CDIA', 'STAR'],
    note: 'Kelompok paling aktif dirotasi di IHSG beberapa tahun terakhir; beberapa anggota baru tercatat.',
  },
  {
    id: 'astra',
    name: 'Astra Group',
    principal: 'Jardine Matheson',
    confidence: 'high',
    members: ['ASII', 'UNTR', 'AALI', 'AUTO', 'ACST'],
  },
  {
    id: 'salim',
    name: 'Salim Group',
    principal: 'Keluarga Salim',
    confidence: 'high',
    members: ['INDF', 'ICBP', 'DNET', 'META', 'IPCC'],
  },
  {
    id: 'sinarmas',
    name: 'Sinar Mas',
    principal: 'Keluarga Widjaja',
    confidence: 'high',
    members: ['INKP', 'TKIM', 'SMAR', 'DSSA', 'BSDE', 'DUTI', 'SMMA', 'BSIM'],
  },
  {
    id: 'bakrie',
    name: 'Bakrie Group',
    principal: 'Keluarga Bakrie',
    confidence: 'high',
    members: ['BUMI', 'BRMS', 'ENRG', 'BNBR', 'ELTY', 'DEWA', 'VKTR'],
  },
  {
    id: 'djarum',
    name: 'Djarum / Hartono',
    principal: 'Keluarga Hartono',
    confidence: 'high',
    members: ['BBCA', 'TOWR', 'SUPR'],
  },
  {
    id: 'adaro',
    name: 'Adaro / Alamtri',
    principal: 'Garibaldi Thohir & mitra',
    confidence: 'high',
    members: ['ADRO', 'AADI', 'ADMR'],
  },
  {
    id: 'saratoga',
    name: 'Saratoga / Merdeka',
    principal: 'Edwin Soeryadjaya & Sandiaga Uno',
    confidence: 'high',
    members: ['SRTG', 'MDKA', 'MBMA', 'TBIG'],
  },
  {
    id: 'lippo',
    name: 'Lippo Group',
    principal: 'Keluarga Riady',
    confidence: 'high',
    members: ['LPKR', 'LPCK', 'SILO', 'MPPA', 'MLPL', 'MLPT'],
  },
  {
    id: 'emtek',
    name: 'Emtek Group',
    principal: 'Keluarga Sariaatmadja',
    confidence: 'high',
    members: ['EMTK', 'SCMA', 'BUKA'],
  },
  {
    id: 'panin',
    name: 'Panin Group',
    principal: 'Keluarga Gunawan',
    confidence: 'high',
    members: ['PNBN', 'PNLF', 'PNIN'],
  },
  {
    id: 'alfamart',
    name: 'Sumber Alfaria',
    principal: 'Djoko Susanto',
    confidence: 'high',
    members: ['AMRT', 'MIDI'],
  },
  {
    id: 'sungai-budi',
    name: 'Sungai Budi',
    principal: 'Keluarga Widarto & Santoso',
    confidence: 'medium',
    members: ['TBLA', 'BUDI'],
  },
  {
    id: 'triputra',
    name: 'Triputra / TP Rachmat',
    principal: 'Theodore Permadi Rachmat',
    confidence: 'medium',
    members: ['TAPG', 'DRMA'],
  },
  {
    id: 'mnc',
    name: 'MNC Group',
    principal: 'Hary Tanoesoedibjo',
    confidence: 'high',
    members: ['BHIT', 'MNCN', 'BMTR', 'IPTV', 'MSIN', 'BABP'],
  },
  {
    id: 'sinarmas-agri',
    name: 'Wilmar / Martua Sitorus',
    principal: 'Martua Sitorus',
    confidence: 'medium',
    members: ['GZCO', 'DSNG'],
    note: 'Batas grup lebih longgar — verifikasi sebelum dipakai.',
  },
  {
    id: 'harum',
    name: 'Harum Energy / Kiki Barki',
    principal: 'Keluarga Barki',
    confidence: 'medium',
    members: ['HRUM', 'TOBA'],
    note: 'Afiliasi kepemilikan berbeda; dikelompokkan karena eksposur tema yang mirip.',
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
