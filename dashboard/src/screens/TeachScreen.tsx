import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Account, Guidance } from '../types'
import { Spinner } from '../components/Spinner'
import type { ToastKind } from '../components/Toast'

interface Props {
  pushToast: (kind: ToastKind, text: string) => void
}

const inputClass =
  'mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-600'

export function TeachScreen({ pushToast }: Props) {
  const [items, setItems] = useState<Guidance[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState('')
  const [vendor, setVendor] = useState('')
  const [accountId, setAccountId] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const [g, acc] = await Promise.all([
        api.guidance(),
        api.accounts().catch(() => ({ accounts: [] as Account[] })),
      ])
      setItems(g.guidance)
      setAccounts(acc.accounts)
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : 'Could not load what you taught it.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const expenseAccounts = accounts.filter((a) => a.classification === 'Expense')
  const acctName = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? null

  const add = async () => {
    if (!note.trim()) return
    setSaving(true)
    try {
      await api.addGuidance({
        note: note.trim(),
        vendor: vendor.trim() || undefined,
        accountQboId: accountId || undefined,
      })
      setNote('')
      setVendor('')
      setAccountId('')
      pushToast('success', 'Got it — the AI will use that next time it categorizes.')
      await load()
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : 'Could not save that.')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: number) => {
    try {
      await api.deleteGuidance(id)
      setItems((prev) => prev.filter((i) => i.id !== id))
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : 'Could not remove that.')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size="lg" label="Loading…" />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-10 space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">Teach</p>
        <h1 className="text-2xl font-semibold text-slate-800">Teach Robo PB&J your preferences</h1>
        <p className="mt-1 text-sm text-slate-500 max-w-xl">
          Tell it how you want things categorized, in plain English — optionally for a specific vendor and category. It
          reads these notes every time it categorizes, so it gets your books right going forward.
        </p>
      </div>

      {/* Add */}
      <div className="card p-6 space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">
            What should it know? <span className="text-rose-500">*</span>
          </span>
          <textarea
            className={`${inputClass} block w-full`}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. We're a landscaping company, so fuel is a job cost, not Automobile."
          />
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">
              For a specific vendor? <span className="text-slate-400">(optional)</span>
            </span>
            <input
              className={`${inputClass} block w-full`}
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              placeholder="e.g. Amazon Web Services"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">
              Preferred category? <span className="text-slate-400">(optional)</span>
            </span>
            <select className={`${inputClass} block w-full`} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">No preference</option>
              {expenseAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button className="btn-primary" onClick={add} disabled={!note.trim() || saving} aria-busy={saving}>
          {saving ? <Spinner size="sm" /> : null}
          {saving ? 'Saving…' : 'Teach it'}
        </button>
      </div>

      {/* List */}
      <div className="card p-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-4">
          What you've taught it ({items.length})
        </p>
        {items.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing yet. Add a note above and the AI will start using it.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {items.map((g) => (
              <div key={g.id} className="flex items-start justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm text-slate-800">{g.note}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {g.vendor ? `Vendor: ${g.vendor}` : 'All vendors'}
                    {g.account_qbo_id ? ` · ${acctName(g.account_qbo_id) ?? 'category'}` : ''}
                  </p>
                </div>
                <button className="btn-ghost text-sm shrink-0" onClick={() => remove(g.id)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-slate-400">
        Tip: after adding guidance, re-run categorization (Home → Sync now, or Run categorization) to apply it to
        transactions waiting for review.
      </p>
    </div>
  )
}
