/* ════ Hub4Fix Core Types ════ */

/** Mindmap generic node — used by printer selector, filament selector, account sidebar, nav dropdown */
export interface MindmapNode {
  id: string
  label: string
  icon?: string
  color?: string
  children?: MindmapNode[]
  locked?: boolean
  badge?: string
  href?: string
  /** If true, this node opens a sub-branch instead of navigating */
  branch?: boolean
  branchColor?: string
  /** Role required to access (client/printer/modelisateur) */
  role?: string
}

export interface MindmapProps {
  tree: MindmapNode[]
  /** ltr = left-to-right (default), rtl = right-to-left (nav dropdown) */
  direction?: 'ltr' | 'rtl'
  /** hover = expand on hover with debounce (product selectors), click = expand on click (account sidebar) */
  interaction?: 'hover' | 'click'
  /** Debounce delay in ms (default: 200) */
  debounceMs?: number
  /** Align child column to active parent vertically */
  alignToParent?: boolean
  /** Organic SVG wire animation */
  organic?: boolean
  /** Callback when a leaf node is selected */
  onSelect?: (node: MindmapNode, path: MindmapNode[]) => void
  className?: string
}

/** Piece status in the catalog */
export type PieceStatus = 'identifiee' | 'en_cours' | 'disponible'

/** Printability assessment */
export type Imprimabilite = 'ok' | 'limite' | 'non'

/** Piece — core entity */
export interface Piece {
  id: string
  nom: string
  marque: string
  groupe: string
  machines: string[]
  typeAppareil: string
  modeCasse: string
  refConstructeur: string | null
  imprimabilite: Imprimabilite
  statut: PieceStatus
  scoreVeille: number
  occurrences: number
  sources: PieceSource[]
  vueEclateeUrl: string | null
  imageUrl: string | null
  nbVotes: number
  nbAlertes: number
  dateDetection: string
  dateDisponible: string | null
  modelisateur: Modelisateur | null
  materiau: string | null
  tempsImpression: string | null
  prixLicence: number    // EUR — one-shot (royalties + frais H4F)
  prixToken: number      // tokens per slicing
  prixImpression: number // EUR — physical print + delivery
}

export interface PieceSource {
  url: string
  label: string
  date: string
}

export interface Modelisateur {
  id: string
  nom: string
  note: number
  hotListSemaines: number
}

/** User roles */
export type UserRole = 'client' | 'printer' | 'modelisateur'

export interface User {
  id: string
  nom: string
  email: string
  tokens: number
  roles: UserRole[]
  avatar: string | null
}

/** Token transaction */
export interface TokenTransaction {
  id: string
  label: string
  date: string
  amount: number // positive = credit, negative = debit
}

/** Printer mission */
export interface Mission {
  id: string
  ref: string
  piece: string
  clientVille: string
  distance: string
  statut: 'en_attente' | 'en_impression' | 'livree'
  gain: number
}
