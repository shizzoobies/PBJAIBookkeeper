import React, { useState, useCallback } from 'react'
import { api } from '../api'
import type { QBOReport, ReportRow } from '../types'
import { Spinner } from '../components/Spinner'
import { EmptyState } from '../components/EmptyState'
import type { ToastKind } from '../components/Toast'

interface Props {
  pushToast: (kind: ToastKind, text: string) => void
}

// ── Recursive row renderer ───────────────────────────────────────────────────

function renderRows(rows: ReportRow[], depth = 0): React.ReactNode {
  return rows.map((row, i) => {
    const indent = depth * 20

    // Section header row
    if (row.Header && row.Rows) {
      const headerLabel = row.Header.ColData?.[0]?.value ?? ''
      const headerAmount = row.Header.ColData?.[1]?.value ?? ''
      return (
        <React.Fragment key={i}>
          {/* Header label */}
          <tr className="border-t border-slate-200 bg-slate-50/70">
            <td
              className="py-2.5 pr-4 text-sm font-semibold text-slate-700"
              style={{ paddingLeft: `${16 + indent}px` }}
            >
              {headerLabel}
            </td>
            <td className="py-2.5 px-4 text-right text-sm font-semibold text-slate-700 whitespace-nowrap">
              {headerAmount}
            </td>
          </tr>
          {/* Nested rows */}
          {row.Rows?.Row && renderRows(row.Rows.Row, depth + 1)}
          {/* Summary row */}
          {row.Summary && (
            <tr className="border-t border-slate-200 bg-slate-50">
              <td
                className="py-2.5 pr-4 text-sm font-semibold text-slate-600 italic"
                style={{ paddingLeft: `${16 + indent}px` }}
              >
                {row.Summary.ColData?.[0]?.value}
              </td>
              <td className="py-2.5 px-4 text-right text-sm font-semibold text-slate-700 whitespace-nowrap">
                {row.Summary.ColData?.[1]?.value}
              </td>
            </tr>
          )}
        </React.Fragment>
      )
    }

    // Leaf data row
    if (row.ColData) {
      const label = row.ColData[0]?.value ?? ''
      const amount = row.ColData[1]?.value ?? ''
      if (!label && !amount) return null

      const isTotal = row.type === 'Total' || row.group === 'NetIncome'
      const textCls = isTotal
        ? 'font-semibold text-slate-800'
        : 'text-slate-600'

      return (
        <tr key={i} className={`border-t border-slate-100 hover:bg-slate-50/40 ${isTotal ? 'bg-slate-50' : ''}`}>
          <td
            className={`py-2 pr-4 text-sm ${textCls}`}
            style={{ paddingLeft: `${16 + indent}px` }}
          >
            {label}
          </td>
          <td className={`py-2 px-4 text-right text-sm font-mono ${textCls} whitespace-nowrap`}>
            {amount}
          </td>
        </tr>
      )
    }

    // Summary-only row
    if (row.Summary) {
      return (
        <tr key={i} className="border-t-2 border-slate-300 bg-slate-50">
          <td
            className="py-3 pr-4 text-sm font-bold text-slate-800"
            style={{ paddingLeft: `${16 + indent}px` }}
          >
            {row.Summary.ColData?.[0]?.value}
          </td>
          <td className="py-3 px-4 text-right text-sm font-bold font-mono text-slate-800 whitespace-nowrap">
            {row.Summary.ColData?.[1]?.value}
          </td>
        </tr>
      )
    }

    return null
  })
}

function downloadReport(report: QBOReport, name: string) {
  // Flatten to CSV
  const rows: string[][] = [['Label', 'Amount']]

  function walk(rowList: ReportRow[], depth = 0) {
    for (const row of rowList) {
      const prefix = '  '.repeat(depth)
      if (row.Header && row.Rows) {
        const label = row.Header.ColData?.[0]?.value ?? ''
        const amount = row.Header.ColData?.[1]?.value ?? ''
        rows.push([`${prefix}${label}`, amount])
        walk(row.Rows.Row ?? [], depth + 1)
        if (row.Summary) {
          rows.push([`${prefix}Total: ${row.Summary.ColData?.[0]?.value ?? ''}`, row.Summary.ColData?.[1]?.value ?? ''])
        }
      } else if (row.ColData) {
        rows.push([`${prefix}${row.ColData[0]?.value ?? ''}`, row.ColData[1]?.value ?? ''])
      } else if (row.Summary) {
        rows.push([`${prefix}${row.Summary.ColData?.[0]?.value ?? ''}`, row.Summary.ColData?.[1]?.value ?? ''])
      }
    }
  }

  walk(report.Rows?.Row ?? [])

  const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export function ReportsScreen({ pushToast }: Props) {
  const today = new Date().toISOString().slice(0, 10)
  const firstOfYear = `${new Date().getFullYear()}-01-01`

  const [from, setFrom] = useState(firstOfYear)
  const [to, setTo] = useState(today)
  const [report, setReport] = useState<QBOReport | null>(null)
  const [reportType, setReportType] = useState<'pnl' | 'balance-sheet' | null>(null)
  const [loading, setLoading] = useState(false)

  const loadReport = useCallback(async (type: 'pnl' | 'balance-sheet') => {
    setLoading(true)
    setReport(null)
    setReportType(type)
    try {
      const r = type === 'pnl'
        ? await api.pnl(from, to)
        : await api.balanceSheet(to)
      setReport(r)
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : 'Could not load report.')
      setReportType(null)
    } finally {
      setLoading(false)
    }
  }, [from, to, pushToast])

  const reportName = report
    ? `${report.Header.ReportName ?? reportType}-${to}`
    : ''

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-semibold text-slate-800 mb-6">Reports</h1>

      {/* Controls */}
      <div className="card p-5 mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="rpt-from" className="block text-sm font-medium text-slate-700 mb-1.5">From</label>
            <input
              id="rpt-from"
              type="date"
              className="input-field w-40"
              value={from}
              onChange={e => setFrom(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="rpt-to" className="block text-sm font-medium text-slate-700 mb-1.5">To</label>
            <input
              id="rpt-to"
              type="date"
              className="input-field w-40"
              value={to}
              onChange={e => setTo(e.target.value)}
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              className={`btn-secondary ${reportType === 'pnl' && report ? 'border-slate-400 bg-slate-100' : ''}`}
              onClick={() => void loadReport('pnl')}
              disabled={loading}
              aria-pressed={reportType === 'pnl' && !!report}
            >
              {loading && reportType === 'pnl' ? <Spinner size="sm" /> : null}
              Profit &amp; Loss
            </button>
            <button
              className={`btn-secondary ${reportType === 'balance-sheet' && report ? 'border-slate-400 bg-slate-100' : ''}`}
              onClick={() => void loadReport('balance-sheet')}
              disabled={loading}
              aria-pressed={reportType === 'balance-sheet' && !!report}
            >
              {loading && reportType === 'balance-sheet' ? <Spinner size="sm" /> : null}
              Balance Sheet
            </button>
          </div>
          {report && (
            <button
              className="btn-ghost ml-auto"
              onClick={() => downloadReport(report, reportName)}
            >
              Download CSV
            </button>
          )}
        </div>
      </div>

      {/* Report output */}
      {loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : !report ? (
        <EmptyState
          icon="📊"
          title="Choose a report above"
          body="Select a date range, then load Profit & Loss or Balance Sheet."
        />
      ) : (
        <div className="card overflow-hidden">
          {/* Report header */}
          <div className="px-5 py-4 border-b border-slate-200 bg-slate-50/80">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-0.5">
              {report.Header.DateMacro ?? `${report.Header.StartPeriod ?? from} — ${report.Header.EndPeriod ?? to}`}
            </p>
            <h2 className="text-lg font-semibold text-slate-800">
              {report.Header.ReportName}
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full" aria-label={report.Header.ReportName}>
              <thead className="sr-only">
                <tr>
                  <th>Label</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {renderRows(report.Rows?.Row ?? [])}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
