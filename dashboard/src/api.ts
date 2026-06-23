// Same-origin by default: the dashboard calls its own Pages BFF (functions/),
// which Cloudflare Access gates and which proxies to the Worker with the shared
// secret — the browser never talks to the Worker directly. Override only for
// local dev (see .env.example).
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''

export { API_BASE }

// The company switcher sets this; every request carries it as X-Company-Id so the
// Worker targets the right connected company.
let currentCompany: string | null = null

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (currentCompany) headers['X-Company-Id'] = currentCompany
  const res = await fetch(url, { ...options, headers })
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`
    try {
      const body = (await res.json()) as { error?: string; message?: string }
      message = body.error ?? body.message ?? message
    } catch {
      // ignore
    }
    throw new Error(message)
  }
  return res.json() as Promise<T>
}

// Multipart upload (file + optional JSON payload). Must NOT set Content-Type —
// the browser sets multipart/form-data with the boundary.
async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  const headers: Record<string, string> = {}
  if (currentCompany) headers['X-Company-Id'] = currentCompany
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', body: form, headers })
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`
    try {
      const body = (await res.json()) as { error?: string; detail?: string }
      message = body.detail ?? body.error ?? message
    } catch {
      // ignore
    }
    throw new Error(message)
  }
  return res.json() as Promise<T>
}

// ── Endpoints ────────────────────────────────────────────────────────────────

import type {
  StatusResponse,
  CompanyResponse,
  AccountsResponse,
  SyncResponse,
  CategorizeResponse,
  TransactionsResponse,
  ApproveResponse,
  AdjustResponse,
  ReconcileResponse,
  QBOReport,
  CaptureExtractResponse,
  CapturePostPayload,
  CapturePostResult,
  CompaniesResponse,
  SeedResponse,
  AutonomyConfig,
  AutoApproveResult,
  GuidanceResponse,
  GuidanceInput,
  ImportStatementResult,
} from './types'

export const api = {
  status: () => apiFetch<StatusResponse>('/api/status'),
  company: () => apiFetch<CompanyResponse>('/api/company'),
  accounts: () => apiFetch<AccountsResponse>('/api/accounts'),
  sync: () => apiFetch<SyncResponse>('/api/sync', { method: 'POST' }),
  categorize: () => apiFetch<CategorizeResponse>('/api/categorize', { method: 'POST' }),

  transactions: (status?: 'pending') =>
    apiFetch<TransactionsResponse>(
      status ? `/api/transactions?status=${status}` : '/api/transactions',
    ),

  approve: (id: number) =>
    apiFetch<ApproveResponse>(`/api/transactions/${id}/approve`, { method: 'POST' }),

  adjust: (id: number, account_qbo_id: string) =>
    apiFetch<AdjustResponse>(`/api/transactions/${id}/adjust`, {
      method: 'POST',
      body: JSON.stringify({ account_qbo_id }),
    }),

  reconcile: (payload: { from: string; to: string; csv: string }) =>
    apiFetch<ReconcileResponse>('/api/reconcile', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  pnl: (from: string, to: string) =>
    apiFetch<QBOReport>(`/api/reports/pnl?from=${from}&to=${to}`),

  balanceSheet: (to: string) =>
    apiFetch<QBOReport>(`/api/reports/balance-sheet?to=${to}`),

  captureExtract: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return apiUpload<CaptureExtractResponse>('/api/capture/extract', form)
  },

  capturePost: (payload: CapturePostPayload, file: File | null) => {
    const form = new FormData()
    form.append('payload', JSON.stringify(payload))
    if (file) form.append('file', file)
    return apiUpload<CapturePostResult>('/api/capture/post', form)
  },

  setCompany: (realmId: string | null) => {
    currentCompany = realmId
  },
  getCompany: () => currentCompany,
  companies: () => apiFetch<CompaniesResponse>('/api/companies'),
  seed: () => apiFetch<SeedResponse>('/api/dev/seed', { method: 'POST' }),

  autonomy: () => apiFetch<AutonomyConfig>('/api/autonomy'),
  saveAutonomy: (cfg: AutonomyConfig) =>
    apiFetch<AutonomyConfig>('/api/autonomy', { method: 'PUT', body: JSON.stringify(cfg) }),
  autoApprove: () => apiFetch<AutoApproveResult>('/api/auto-approve', { method: 'POST' }),
  autoApproved: () => apiFetch<TransactionsResponse>('/api/auto-approved'),
  reopen: (id: number) => apiFetch<{ ok: true }>(`/api/transactions/${id}/reopen`, { method: 'POST' }),

  guidance: () => apiFetch<GuidanceResponse>('/api/guidance'),
  addGuidance: (g: GuidanceInput) =>
    apiFetch<{ ok: true }>('/api/guidance', { method: 'POST', body: JSON.stringify(g) }),
  deleteGuidance: (id: number) => apiFetch<{ ok: true }>(`/api/guidance/${id}`, { method: 'DELETE' }),

  importStatement: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return apiUpload<ImportStatementResult>('/api/import-statement', form)
  },
}
