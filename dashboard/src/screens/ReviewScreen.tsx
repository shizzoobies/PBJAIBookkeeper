import { useEffect, useState, useCallback, useRef } from 'react'
import { api } from '../api'
import type { Transaction, Account } from '../types'
import { confidenceBand } from '../types'
import { ConfidencePill } from '../components/ConfidencePill'
import { Spinner } from '../components/Spinner'
import { EmptyState } from '../components/EmptyState'
import type { ToastKind } from '../components/Toast'

interface Props {
  pushToast: (kind: ToastKind, text: string) => void
}

function fmt(amount: number) {
  const abs = Math.abs(amount).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  })
  return amount < 0 ? `(${abs})` : abs
}

function fmtDate(d: string) {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

interface RowProps {
  txn: Transaction
  accountMap: Map<string, string>
  accounts: Account[]
  onApprove: (id: number) => Promise<void>
  onAdjust: (id: number, accountId: string) => Promise<void>
  approving: boolean
  adjusting: boolean
}

function TransactionRow({
  txn,
  accountMap,
  accounts,
  onApprove,
  onAdjust,
  approving,
  adjusting,
}: RowProps) {
  const categoryName = txn.suggested_account
    ? accountMap.get(txn.suggested_account) ?? txn.suggested_account
    : '—'

  const isNegative = txn.amount < 0

  return (
    <tr className="border-t border-slate-100 hover:bg-slate-50/60 transition-colors">
      <td className="table-td whitespace-nowrap text-slate-500 text-xs">
        {fmtDate(txn.txn_date)}
      </td>
      <td className="table-td max-w-[220px]">
        <p className="font-medium text-slate-800 truncate">{txn.payee ?? '—'}</p>
        {txn.description && txn.description !== txn.payee && (
          <p className="text-xs text-slate-500 truncate">{txn.description}</p>
        )}
      </td>
      <td className={`table-td whitespace-nowrap font-mono text-sm font-medium ${isNegative ? 'text-rose-600' : 'text-slate-800'}`}>
        {fmt(txn.amount)}
      </td>
      <td className="table-td min-w-[180px]">
        <select
          className="input-field py-1.5 text-sm"
          value={txn.suggested_account ?? ''}
          onChange={e => void onAdjust(txn.id, e.target.value)}
          disabled={adjusting}
          aria-label={`Category for ${txn.payee ?? 'transaction'}`}
        >
          {!txn.suggested_account && (
            <option value="">— Select category —</option>
          )}
          {accounts.map(a => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {txn.suggested_account && (
          <p className="mt-0.5 text-xs text-slate-400 truncate">{categoryName}</p>
        )}
      </td>
      <td className="table-td">
        <ConfidencePill confidence={txn.confidence} />
      </td>
      <td className="table-td">
        <button
          className="btn-primary py-1.5 px-3 text-xs"
          onClick={() => void onApprove(txn.id)}
          disabled={approving}
          aria-label={`Approve ${txn.payee ?? 'transaction'}`}
        >
          {approving ? <Spinner size="sm" /> : 'Approve'}
        </button>
      </td>
    </tr>
  )
}

export function ReviewScreen({ pushToast }: Props) {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [accountMap, setAccountMap] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [approvingIds, setApprovingIds] = useState<Set<number>>(new Set())
  const [adjustingIds, setAdjustingIds] = useState<Set<number>>(new Set())
  const [bulkApproving, setBulkApproving] = useState(false)
  const announcerRef = useRef<HTMLParagraphElement>(null)

  const announce = (msg: string) => {
    if (announcerRef.current) announcerRef.current.textContent = msg
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [txnRes, accRes] = await Promise.all([
        api.transactions('pending'),
        api.accounts(),
      ])
      setTransactions(txnRes.transactions)
      setAccounts(accRes.accounts)
      const m = new Map(accRes.accounts.map(a => [a.id, a.name]))
      setAccountMap(m)
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : 'Could not load transactions.')
    } finally {
      setLoading(false)
    }
  }, [pushToast])

  useEffect(() => { void load() }, [load])

  const handleApprove = useCallback(async (id: number) => {
    setApprovingIds(p => new Set(p).add(id))
    try {
      await api.approve(id)
      setTransactions(prev => prev.filter(t => t.id !== id))
      announce('Transaction approved.')
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : 'Could not approve transaction.')
    } finally {
      setApprovingIds(p => { const n = new Set(p); n.delete(id); return n })
    }
  }, [pushToast])

  const handleAdjust = useCallback(async (id: number, accountId: string) => {
    setAdjustingIds(p => new Set(p).add(id))
    try {
      await api.adjust(id, accountId)
      setTransactions(prev =>
        prev.map(t => t.id === id ? { ...t, suggested_account: accountId } : t),
      )
      announce('Category updated.')
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : 'Could not update category.')
    } finally {
      setAdjustingIds(p => { const n = new Set(p); n.delete(id); return n })
    }
  }, [pushToast])

  const handleBulkApprove = useCallback(async () => {
    const sureIds = transactions
      .filter(t => confidenceBand(t.confidence) === 'Sure')
      .map(t => t.id)

    if (sureIds.length === 0) {
      pushToast('info', 'No high-confidence transactions to approve.')
      return
    }

    setBulkApproving(true)
    try {
      await Promise.all(sureIds.map(id => api.approve(id)))
      setTransactions(prev => prev.filter(t => !sureIds.includes(t.id)))
      pushToast('success', `Approved ${sureIds.length} high-confidence transaction${sureIds.length === 1 ? '' : 's'}.`)
      announce(`Approved ${sureIds.length} transactions.`)
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : 'Bulk approve failed.')
    } finally {
      setBulkApproving(false)
    }
  }, [transactions, pushToast])

  const sureCount = transactions.filter(t => confidenceBand(t.confidence) === 'Sure').length

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      {/* Accessible live region */}
      <p ref={announcerRef} className="sr-only" aria-live="assertive" aria-atomic="true" />

      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Review</h1>
          {!loading && transactions.length > 0 && (
            <p className="mt-0.5 text-sm text-slate-500">
              {transactions.length} transaction{transactions.length === 1 ? '' : 's'} need your attention
            </p>
          )}
        </div>
        {transactions.length > 0 && (
          <button
            className="btn-primary"
            onClick={handleBulkApprove}
            disabled={bulkApproving || sureCount === 0}
            aria-busy={bulkApproving}
          >
            {bulkApproving ? <Spinner size="sm" /> : null}
            {bulkApproving
              ? 'Approving…'
              : sureCount > 0
              ? `Approve all high-confidence (${sureCount})`
              : 'Approve all high-confidence'}
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : transactions.length === 0 ? (
        <EmptyState
          icon="✓"
          title="All caught up — nothing needs review right now."
          body="When the AI flags new transactions, they'll appear here for you to check."
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-full" aria-label="Transactions needing review">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="table-th">Date</th>
                <th className="table-th">Payee / Description</th>
                <th className="table-th">Amount</th>
                <th className="table-th">Category</th>
                <th className="table-th">Confidence</th>
                <th className="table-th"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {transactions.map(txn => (
                <TransactionRow
                  key={txn.id}
                  txn={txn}
                  accountMap={accountMap}
                  accounts={accounts}
                  onApprove={handleApprove}
                  onAdjust={handleAdjust}
                  approving={approvingIds.has(txn.id)}
                  adjusting={adjustingIds.has(txn.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
