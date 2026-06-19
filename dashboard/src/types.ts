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
  categorized?: number
  autoApproved?: number
}

export interface CategorizeResponse {
  ok: true
  rules: number
  ai: number
  total: number
  autoApproved?: number
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
  auto_approved?: number
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

// ── Capture (receipt/bill → QuickBooks) ───────────────────────────────────────

export interface CaptureLine {
  description: string
  amount: number
  accountId: string | null
}

export interface CaptureDraft {
  suggestedDocType: 'bill' | 'purchase'
  vendorName: string | null
  txnDate: string | null
  total: number | null
  currency: string | null
  lines: CaptureLine[]
}

export interface CaptureExtractResponse {
  draft: CaptureDraft
}

export interface CapturePostPayload {
  docType: 'bill' | 'purchase'
  vendorName: string
  txnDate: string
  lines: Array<{ description: string; amount: number; accountId: string }>
  paymentType?: 'Cash' | 'Check' | 'CreditCard'
  paymentAccountId?: string
}

export interface CapturePostResult {
  ok: true
  entityType: 'Bill' | 'Purchase'
  entityId: string
  vendor: string
  attached: boolean
}

// ── Companies (multi-company switcher) ────────────────────────────────────────

export interface Company {
  realmId: string
  companyName: string | null
  status: string
}

export interface CompaniesResponse {
  companies: Company[]
}

export interface SeedResponse {
  ok: true
  created: number
  duplicates: number
  bankCsv: string
  period: { from: string; to: string }
}

// ── Autopilot ─────────────────────────────────────────────────────────────────

export interface AutonomyConfig {
  enabled: boolean
  minConfidence: number
  maxAmount: number
  requireKnownVendor: boolean
}

export interface AutoApproveResult {
  ok?: true
  approved: number
  skipped: number
  reasons: Record<string, number>
}
