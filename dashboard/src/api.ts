const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ||
  'https://ai-bookkeeper.tgqhg6kf4g.workers.dev'

export { API_BASE }

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
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
} from './types'

export const api = {
  status: () => apiFetch<StatusResponse>('/'),
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
}
