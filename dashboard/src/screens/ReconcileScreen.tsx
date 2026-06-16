import React, { useState, useRef, useCallback } from 'react'
import { api } from '../api'
import type { ReconcileResponse, BookEntry, StatementEntry, MatchedEntry, DuplicateEntry } from '../types'
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
  if (!d) return '—'
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function SummaryCard({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`card p-5 text-center ${highlight && value > 0 ? 'border-rose-200 bg-rose-50' : ''}`}>
      <p className={`text-3xl font-bold ${highlight && value > 0 ? 'text-rose-600' : 'text-slate-800'}`}>
        {value}
      </p>
      <p className="mt-1 text-sm text-slate-500">{label}</p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`section-${title.replace(/\s+/g, '-').toLowerCase()}`}>
      <h2
        id={`section-${title.replace(/\s+/g, '-').toLowerCase()}`}
        className="text-base font-semibold text-slate-700 mb-3 mt-8"
      >
        {title}
      </h2>
      {children}
    </section>
  )
}

function BookTable({ rows }: { rows: BookEntry[] }) {
  if (rows.length === 0) return <EmptyState icon="✓" title="None" />
  return (
    <div className="card overflow-x-auto">
      <table className="min-w-full" aria-label="Book entries">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="table-th">Date</th>
            <th className="table-th">Payee</th>
            <th className="table-th">Description</th>
            <th className="table-th">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100 hover:bg-slate-50/60">
              <td className="table-td text-xs text-slate-500 whitespace-nowrap">{fmtDate(r.date)}</td>
              <td className="table-td">{r.payee ?? '—'}</td>
              <td className="table-td text-slate-500">{r.description ?? '—'}</td>
              <td className={`table-td font-mono text-sm font-medium whitespace-nowrap ${r.amount < 0 ? 'text-rose-600' : 'text-slate-800'}`}>
                {fmt(r.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StatementTable({ rows }: { rows: StatementEntry[] }) {
  if (rows.length === 0) return <EmptyState icon="✓" title="None" />
  return (
    <div className="card overflow-x-auto">
      <table className="min-w-full" aria-label="Statement entries">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="table-th">Date</th>
            <th className="table-th">Description</th>
            <th className="table-th">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100 hover:bg-slate-50/60">
              <td className="table-td text-xs text-slate-500 whitespace-nowrap">{fmtDate(r.date)}</td>
              <td className="table-td">{r.description}</td>
              <td className={`table-td font-mono text-sm font-medium whitespace-nowrap ${r.amount < 0 ? 'text-rose-600' : 'text-slate-800'}`}>
                {fmt(r.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function MatchedTable({ rows }: { rows: MatchedEntry[] }) {
  if (rows.length === 0) return <EmptyState icon="✓" title="No matches found" />
  return (
    <div className="card overflow-x-auto">
      <table className="min-w-full" aria-label="Matched transactions">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="table-th">Book date</th>
            <th className="table-th">Payee</th>
            <th className="table-th">Book amount</th>
            <th className="table-th">Statement date</th>
            <th className="table-th">Statement description</th>
            <th className="table-th">Statement amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100 hover:bg-slate-50/60">
              <td className="table-td text-xs text-slate-500 whitespace-nowrap">{fmtDate(r.book.date)}</td>
              <td className="table-td">{r.book.payee ?? r.book.description ?? '—'}</td>
              <td className={`table-td font-mono text-sm font-medium whitespace-nowrap ${r.book.amount < 0 ? 'text-rose-600' : 'text-slate-800'}`}>
                {fmt(r.book.amount)}
              </td>
              <td className="table-td text-xs text-slate-500 whitespace-nowrap">{fmtDate(r.statement.date)}</td>
              <td className="table-td text-slate-500">{r.statement.description}</td>
              <td className={`table-td font-mono text-sm font-medium whitespace-nowrap ${r.statement.amount < 0 ? 'text-rose-600' : 'text-slate-800'}`}>
                {fmt(r.statement.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DuplicatesTable({ rows }: { rows: DuplicateEntry[] }) {
  if (rows.length === 0) return <EmptyState icon="✓" title="No duplicates found" />
  return (
    <div className="card overflow-x-auto">
      <table className="min-w-full" aria-label="Possible duplicates">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="table-th">Date</th>
            <th className="table-th">Payee</th>
            <th className="table-th">Amount</th>
            <th className="table-th">Times seen</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100 hover:bg-slate-50/60">
              <td className="table-td text-xs text-slate-500 whitespace-nowrap">{fmtDate(r.date)}</td>
              <td className="table-td">{r.payee ?? '—'}</td>
              <td className={`table-td font-mono text-sm font-medium whitespace-nowrap ${r.amount < 0 ? 'text-rose-600' : 'text-slate-800'}`}>
                {fmt(r.amount)}
              </td>
              <td className="table-td">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 border border-amber-200">
                  {r.count}×
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function exportWorksheet(result: ReconcileResponse) {
  const rows: string[][] = []
  rows.push(['Section', 'Date', 'Payee / Description', 'Book Amount', 'Statement Amount'])

  result.matched.forEach(m => {
    rows.push(['Matched', m.book.date, m.book.payee ?? m.book.description ?? '', String(m.book.amount), String(m.statement.amount)])
  })
  result.bookOnly.forEach(b => {
    rows.push(['On your books only', b.date, b.payee ?? b.description ?? '', String(b.amount), ''])
  })
  result.statementOnly.forEach(s => {
    rows.push(['On statement only', s.date, s.description, '', String(s.amount)])
  })
  result.duplicates.forEach(d => {
    rows.push(['Possible duplicate', d.date, d.payee ?? '', String(d.amount), `${d.count}x`])
  })
  result.stale.forEach(s => {
    rows.push(['Old uncleared item', s.date, s.payee ?? s.description ?? '', String(s.amount), ''])
  })

  const csv = rows.map(r => r.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `reconciliation-${result.period.from}-to-${result.period.to}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export function ReconcileScreen({ pushToast }: Props) {
  const today = new Date().toISOString().slice(0, 10)
  const firstOfMonth = today.slice(0, 8) + '01'

  const [from, setFrom] = useState(firstOfMonth)
  const [to, setTo] = useState(today)
  const [csvText, setCsvText] = useState('')
  const [fileName, setFileName] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ReconcileResponse | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = ev => {
      setCsvText((ev.target?.result as string) ?? '')
    }
    reader.readAsText(file)
  }, [])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!csvText) {
      pushToast('error', 'Please upload a bank statement CSV first.')
      return
    }
    if (!from || !to) {
      pushToast('error', 'Please select a date range.')
      return
    }
    setLoading(true)
    setResult(null)
    try {
      const r = await api.reconcile({ from, to, csv: csvText })
      setResult(r)
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : 'Reconciliation failed.')
    } finally {
      setLoading(false)
    }
  }, [csvText, from, to, pushToast])

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-semibold text-slate-800 mb-6">Reconciliation</h1>

      {/* Form */}
      <form onSubmit={handleSubmit} className="card p-6 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="from-date" className="block text-sm font-medium text-slate-700 mb-1.5">
              From
            </label>
            <input
              id="from-date"
              type="date"
              className="input-field"
              value={from}
              onChange={e => setFrom(e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="to-date" className="block text-sm font-medium text-slate-700 mb-1.5">
              To
            </label>
            <input
              id="to-date"
              type="date"
              className="input-field"
              value={to}
              onChange={e => setTo(e.target.value)}
              required
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Bank statement (CSV)
          </label>
          <div
            className="flex items-center gap-3 p-4 rounded-lg border-2 border-dashed border-slate-200 hover:border-slate-300 transition-colors cursor-pointer bg-white"
            onClick={() => fileRef.current?.click()}
            onKeyDown={e => e.key === 'Enter' && fileRef.current?.click()}
            tabIndex={0}
            role="button"
            aria-label="Upload CSV file"
          >
            <span className="text-xl" aria-hidden="true">📂</span>
            <div>
              <p className="text-sm font-medium text-slate-700">
                {fileName || 'Click to upload a CSV file'}
              </p>
              {!fileName && (
                <p className="text-xs text-slate-500 mt-0.5">Your bank statement, exported as CSV</p>
              )}
            </div>
            {fileName && (
              <span className="ml-auto text-xs text-emerald-600 font-medium">✓ Ready</span>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={handleFileChange}
            aria-label="CSV file upload"
          />
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button type="submit" className="btn-primary" disabled={loading} aria-busy={loading}>
            {loading ? <Spinner size="sm" /> : null}
            {loading ? 'Checking…' : 'Check reconciliation'}
          </button>
          {result && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => exportWorksheet(result)}
            >
              Export worksheet
            </button>
          )}
        </div>
      </form>

      {/* Results */}
      {result && (
        <div className="mt-8 space-y-2">
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-2">
            <SummaryCard label="Matched" value={result.counts.matched} />
            <SummaryCard label="On your books only" value={result.counts.bookOnly} highlight />
            <SummaryCard label="On statement only" value={result.counts.statementOnly} highlight />
            <SummaryCard label="Possible duplicates" value={result.counts.duplicates} highlight />
            <SummaryCard label="Old uncleared items" value={result.counts.stale} highlight />
          </div>

          <Section title="Matched">
            <p className="text-sm text-slate-500 mb-3">
              These transactions appear in both your books and the bank statement.
            </p>
            <MatchedTable rows={result.matched} />
          </Section>

          <Section title="On your books but not on the statement">
            <p className="text-sm text-slate-500 mb-3">
              These are recorded in QuickBooks but the bank didn't list them. They may be outstanding or entered incorrectly.
            </p>
            <BookTable rows={result.bookOnly} />
          </Section>

          <Section title="On the statement but not on your books">
            <p className="text-sm text-slate-500 mb-3">
              The bank shows these, but they're not in QuickBooks yet. You may need to record them.
            </p>
            <StatementTable rows={result.statementOnly} />
          </Section>

          <Section title="Possible duplicates">
            <p className="text-sm text-slate-500 mb-3">
              The same amount appears more than once around the same date. Worth double-checking.
            </p>
            <DuplicatesTable rows={result.duplicates} />
          </Section>

          <Section title="Old uncleared items">
            <p className="text-sm text-slate-500 mb-3">
              These have been sitting uncleared for a while. You may want to follow up or void them.
            </p>
            <BookTable rows={result.stale} />
          </Section>
        </div>
      )}
    </div>
  )
}
