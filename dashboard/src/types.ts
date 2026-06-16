// ── API Response Types ──────────────────────────────────────────────────────

export interface StatusResponse {
  service: string
  status: string
  environment: string
  connectedCompanies: number
}

export interface CompanyResponse {
  QueryResponse: {
    CompanyInfo: Array<{
      CompanyName: string
      [key: string]: unknown
    }>
  }
}

export interface Account {
  id: string
  name: string
  type: string
  subtype: string
  classification: string
}

export interface AccountsResponse {
  accounts: Account[]
}

export interface SyncResponse {
  ok: true
  accounts: number
  transactions: number
}

export interface CategorizeResponse {
  ok: true
  rules: number
  ai: number
  total: number
}

export type ReviewStatus = 'pending' | 'approved' | 'adjusted'

export interface Transaction {
  id: number
  qbo_id: string
  txn_type: string
  txn_date: string
  description: string | null
  payee: string | null
  amount: number
  account_qbo_id: string | null
  suggested_account: string | null
  confidence: number | null
  review_status: ReviewStatus
}

export interface TransactionsResponse {
  transactions: Transaction[]
}

export interface ApproveResponse {
  ok: true
}

export interface AdjustResponse {
  ok: true
  ruleWritten: boolean
}

// ── Reconciliation ───────────────────────────────────────────────────────────

export interface BookEntry {
  id: number
  qbo_id: string
  date: string
  payee: string | null
  description: string | null
  amount: number
}

export interface StatementEntry {
  date: string
  description: string
  amount: number
  raw: string
}

export interface MatchedEntry {
  book: BookEntry
  statement: StatementEntry
}

export interface DuplicateEntry {
  amount: number
  date: string
  payee: string | null
  count: number
  ids: number[]
}

export interface ReconcileResponse {
  period: { from: string; to: string }
  counts: {
    matched: number
    bookOnly: number
    statementOnly: number
    duplicates: number
    stale: number
  }
  matched: MatchedEntry[]
  bookOnly: BookEntry[]
  statementOnly: StatementEntry[]
  duplicates: DuplicateEntry[]
  stale: BookEntry[]
}

// ── Reports ─────────────────────────────────────────────────────────────────

export interface ColData {
  value: string
  id?: string
}

export interface ReportRow {
  ColData?: ColData[]
  Header?: { ColData: ColData[] }
  Summary?: { ColData: ColData[] }
  Rows?: { Row: ReportRow[] }
  type?: string
  group?: string
}

export interface QBOReport {
  Header: {
    ReportName: string
    DateMacro?: string
    StartPeriod?: string
    EndPeriod?: string
    Currency?: string
  }
  Columns: {
    Column: Array<{ ColTitle: string; ColType: string }>
  }
  Rows: {
    Row: ReportRow[]
  }
}

// ── Confidence Bands ─────────────────────────────────────────────────────────

export type ConfidenceBand = 'Sure' | 'Likely' | 'Take a look'

export function confidenceBand(c: number | null): ConfidenceBand {
  if (c === null || c === undefined) return 'Take a look'
  if (c >= 0.85) return 'Sure'
  if (c >= 0.6) return 'Likely'
  return 'Take a look'
}
