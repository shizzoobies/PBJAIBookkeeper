import { useEffect, useState, useCallback } from 'react'
import { api, API_BASE } from '../api'
import type { StatusResponse, SyncResponse, CategorizeResponse } from '../types'
import { Spinner } from '../components/Spinner'
import type { ToastKind } from '../components/Toast'

interface Props {
  onNavigate: (screen: 'review' | 'reconcile' | 'reports') => void
  pushToast: (kind: ToastKind, text: string) => void
}

export function HomeScreen({ onNavigate, pushToast }: Props) {
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [companyName, setCompanyName] = useState<string | null>(null)
  const [pendingCount, setPendingCount] = useState<number | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [categorizing, setCategorizing] = useState(false)
  const [seeding, setSeeding] = useState(false)

  const loadData = useCallback(async () => {
    setLoadingStatus(true)
    try {
      const s = await api.status()
      setStatus(s)
      if (s.connectedCompanies > 0) {
        const [co, txns] = await Promise.all([
          api.company().catch(() => null),
          api.transactions('pending').catch(() => null),
        ])
        if (co?.QueryResponse?.CompanyInfo?.[0]?.CompanyName) {
          setCompanyName(co.QueryResponse.CompanyInfo[0].CompanyName)
        }
        if (txns) {
          setPendingCount(txns.transactions.length)
        }
      }
    } catch {
      pushToast('error', 'Could not reach the server. Please try again.')
    } finally {
      setLoadingStatus(false)
    }
  }, [pushToast])

  useEffect(() => { void loadData() }, [loadData])

  const handleSync = async () => {
    setSyncing(true)
    try {
      const r: SyncResponse = await api.sync()
      pushToast('success', `Synced ${r.accounts} accounts and ${r.transactions} transactions.`)
      void loadData()
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : 'Sync failed.')
    } finally {
      setSyncing(false)
    }
  }

  const handleCategorize = async () => {
    setCategorizing(true)
    try {
      const r: CategorizeResponse = await api.categorize()
      pushToast(
        'success',
        `Categorized ${r.total} transactions — ${r.rules} by rule, ${r.ai} by AI.`,
      )
      void loadData()
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : 'Categorization failed.')
    } finally {
      setCategorizing(false)
    }
  }

  const handleSeed = async () => {
    setSeeding(true)
    try {
      const r = await api.seed()
      // Download the matching bank statement for the reconciliation demo.
      const blob = new Blob([r.bankCsv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'demo-bank-statement.csv'
      a.click()
      URL.revokeObjectURL(url)
      pushToast(
        'success',
        `Added ${r.created} demo transactions and saved demo-bank-statement.csv. Next: Sync, then Run categorization. Reconcile period ${r.period.from} → ${r.period.to}.`,
      )
      void loadData()
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : 'Could not seed demo data.')
    } finally {
      setSeeding(false)
    }
  }

  if (loadingStatus) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size="lg" label="Loading…" />
      </div>
    )
  }

  // ── Not connected ────────────────────────────────────────────────────────
  if (status && status.connectedCompanies === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
        <div className="mb-3 h-14 w-14 rounded-2xl bg-slate-100 flex items-center justify-center text-3xl" aria-hidden="true">
          🔗
        </div>
        <h1 className="text-2xl font-semibold text-slate-800 mb-2">Connect your QuickBooks</h1>
        <p className="text-slate-500 text-sm max-w-sm mb-8">
          Link your QuickBooks Online account so the AI can read your transactions and keep your books tidy.
        </p>
        <button
          className="btn-primary text-base px-8 py-3"
          onClick={() => { window.location.href = `${API_BASE}/oauth/connect` }}
        >
          Connect QuickBooks
        </button>
      </div>
    )
  }

  // ── Connected ────────────────────────────────────────────────────────────
  return (
    <div className="max-w-3xl mx-auto px-4 py-10 space-y-8">
      {/* Header */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">Connected</p>
        <h1 className="text-2xl font-semibold text-slate-800">
          {companyName ?? 'Your company'}
        </h1>
      </div>

      {/* Task tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Review tile */}
        <button
          onClick={() => onNavigate('review')}
          className="card text-left p-6 hover:shadow-md transition-shadow duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-600 group"
        >
          <div className="flex items-start justify-between mb-4">
            <span className="text-2xl" aria-hidden="true">📋</span>
            {pendingCount !== null && pendingCount > 0 && (
              <span className="inline-flex items-center justify-center h-6 min-w-6 px-1.5 rounded-full bg-rose-100 text-rose-700 text-xs font-bold">
                {pendingCount}
              </span>
            )}
          </div>
          <p className="font-semibold text-slate-800 group-hover:text-slate-900">
            {pendingCount !== null && pendingCount > 0
              ? `${pendingCount} transaction${pendingCount === 1 ? '' : 's'} need your review`
              : 'Review queue'}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {pendingCount === 0
              ? 'All caught up — nothing needs review right now.'
              : 'Check what the AI categorized and approve or adjust.'}
          </p>
          <p className="mt-4 text-sm font-medium text-slate-600 group-hover:text-slate-800 transition-colors">
            Review →
          </p>
        </button>

        {/* Reconciliation tile */}
        <button
          onClick={() => onNavigate('reconcile')}
          className="card text-left p-6 hover:shadow-md transition-shadow duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-600 group"
        >
          <div className="mb-4">
            <span className="text-2xl" aria-hidden="true">🏦</span>
          </div>
          <p className="font-semibold text-slate-800 group-hover:text-slate-900">Reconciliation</p>
          <p className="mt-1 text-sm text-slate-500">
            Upload a bank statement and check what matches your books.
          </p>
          <p className="mt-4 text-sm font-medium text-slate-600 group-hover:text-slate-800 transition-colors">
            Reconcile →
          </p>
        </button>
      </div>

      {/* Utility actions */}
      <div className="card p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-4">Tools</p>
        <div className="flex flex-wrap gap-3">
          <button
            className="btn-secondary"
            onClick={handleSync}
            disabled={syncing}
            aria-busy={syncing}
          >
            {syncing ? <Spinner size="sm" /> : null}
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
          <button
            className="btn-secondary"
            onClick={handleCategorize}
            disabled={categorizing}
            aria-busy={categorizing}
          >
            {categorizing ? <Spinner size="sm" /> : null}
            {categorizing ? 'Running…' : 'Run categorization'}
          </button>
          <button
            className="btn-secondary"
            onClick={handleSeed}
            disabled={seeding}
            aria-busy={seeding}
          >
            {seeding ? <Spinner size="sm" /> : null}
            {seeding ? 'Seeding…' : 'Seed demo data'}
          </button>
          <button
            className="btn-ghost"
            onClick={() => { window.location.href = `${API_BASE}/oauth/connect` }}
          >
            + Connect another company
          </button>
          <button
            className="btn-ghost"
            onClick={() => onNavigate('reports')}
          >
            View reports →
          </button>
        </div>
      </div>
    </div>
  )
}
