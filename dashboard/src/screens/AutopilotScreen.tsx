import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Account, AutonomyConfig, Transaction } from '../types'
import { Spinner } from '../components/Spinner'
import type { ToastKind } from '../components/Toast'

interface Props {
  pushToast: (kind: ToastKind, text: string) => void
}

const inputClass =
  'mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-600'

const checkboxClass = 'h-5 w-5 rounded border-slate-300 text-slate-800 focus-visible:outline focus-visible:outline-2'

export function AutopilotScreen({ pushToast }: Props) {
  const [cfg, setCfg] = useState<AutonomyConfig | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [autoApproved, setAutoApproved] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [c, acc, aa] = await Promise.all([
        api.autonomy(),
        api.accounts().catch(() => ({ accounts: [] as Account[] })),
        api.autoApproved().catch(() => ({ transactions: [] as Transaction[] })),
      ])
      setCfg(c)
      setAccounts(acc.accounts)
      setAutoApproved(aa.transactions)
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : 'Could not load Autopilot.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const acctName = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? '—'

  const save = async (next: AutonomyConfig) => {
    setCfg(next) // optimistic
    try {
      const saved = await api.saveAutonomy(next)
      setCfg(saved)
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : 'Could not save settings.')
    }
  }

  const runNow = async () => {
    setRunning(true)
    try {
      const r = await api.autoApprove()
      pushToast(
        'success',
        r.approved > 0
          ? `Autopilot approved ${r.approved} and left ${r.skipped} for you.`
          : `Nothing safe to approve right now — ${r.skipped} need a look.`,
      )
      await load()
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : 'Autopilot run failed.')
    } finally {
      setRunning(false)
    }
  }

  const undo = async (id: number) => {
    try {
      await api.reopen(id)
      setAutoApproved((prev) => prev.filter((t) => t.id !== id))
      pushToast('success', 'Sent back to your review queue.')
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : 'Could not undo.')
    }
  }

  if (loading || !cfg) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size="lg" label="Loading…" />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-10 space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">Autopilot</p>
        <h1 className="text-2xl font-semibold text-slate-800">Let Robo PB&J handle the easy ones</h1>
        <p className="mt-1 text-sm text-slate-500 max-w-xl">
          When this is on, the routine transactions it's sure about get approved for you, so you only review the ones
          that need a human. It only accepts the AI's suggested category, never changes QuickBooks, and you can undo
          anything below. It gets better as you correct it — the more it learns, the more it can safely handle.
        </p>
      </div>

      {/* Settings */}
      <div className="card p-6 space-y-5">
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="font-semibold text-slate-800">Auto-approve the safe ones</span>
            <span className="block text-sm text-slate-500">Off by default. Turn it on when you're comfortable.</span>
          </span>
          <input
            type="checkbox"
            className={checkboxClass}
            checked={cfg.enabled}
            onChange={(e) => save({ ...cfg, enabled: e.target.checked })}
          />
        </label>

        <label className="block">
          <span className="font-medium text-slate-700">Only when it's…</span>
          <select
            className={`${inputClass} block w-full`}
            value={cfg.minConfidence >= 0.85 ? 'sure' : 'likely'}
            onChange={(e) => save({ ...cfg, minConfidence: e.target.value === 'sure' ? 0.85 : 0.6 })}
          >
            <option value="sure">Sure (recommended)</option>
            <option value="likely">Sure or Likely</option>
          </select>
        </label>

        <label className="block">
          <span className="font-medium text-slate-700">Skip anything over</span>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-slate-500">$</span>
            <input
              className={`${inputClass} w-32`}
              inputMode="decimal"
              value={String(cfg.maxAmount)}
              onChange={(e) => setCfg({ ...cfg, maxAmount: Number(e.target.value) || 0 })}
              onBlur={() => save(cfg)}
              aria-label="Maximum amount to auto-approve"
            />
          </div>
        </label>

        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="font-medium text-slate-700">Always review a new vendor</span>
            <span className="block text-sm text-slate-500">
              Hold the first transaction from a vendor you haven't reviewed before.
            </span>
          </span>
          <input
            type="checkbox"
            className={checkboxClass}
            checked={cfg.requireKnownVendor}
            onChange={(e) => save({ ...cfg, requireKnownVendor: e.target.checked })}
          />
        </label>

        <p className="text-xs text-slate-400 border-t border-slate-100 pt-3">
          Taxes, owner's draw, equity, transfers, loans and payroll are always sent to you — whatever these settings say.
        </p>
      </div>

      {/* Run */}
      <div className="card p-5 flex flex-wrap items-center gap-3">
        <button className="btn-primary" onClick={runNow} disabled={running || !cfg.enabled} aria-busy={running}>
          {running ? <Spinner size="sm" /> : null}
          {running ? 'Running…' : 'Run autopilot now'}
        </button>
        <span className="text-sm text-slate-500">
          {cfg.enabled
            ? 'Reviews your current queue and approves the ones that pass your guardrails.'
            : 'Turn autopilot on above to run it.'}
        </span>
      </div>

      {/* What it approved */}
      <div className="card p-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-4">
          Autopilot approved ({autoApproved.length})
        </p>
        {autoApproved.length === 0 ? (
          <p className="text-sm text-slate-500">
            Nothing yet. When autopilot approves transactions, they'll appear here so you can undo any of them.
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {autoApproved.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">
                    {t.payee ?? t.description ?? 'Transaction'}
                  </p>
                  <p className="text-xs text-slate-500">
                    {t.txn_date} · {acctName(t.suggested_account)} · ${Math.abs(t.amount).toFixed(2)}
                  </p>
                </div>
                <button className="btn-ghost text-sm shrink-0" onClick={() => undo(t.id)}>
                  Undo
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
