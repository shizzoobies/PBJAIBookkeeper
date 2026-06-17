import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Account, CaptureDraft, CapturePostPayload, CapturePostResult } from '../types'
import { Spinner } from '../components/Spinner'
import type { ToastKind } from '../components/Toast'

interface Props {
  pushToast: (kind: ToastKind, text: string) => void
}

interface EditableLine {
  description: string
  amount: string
  accountId: string
}

const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-600'

export function CaptureScreen({ pushToast }: Props) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [posting, setPosting] = useState(false)
  const [result, setResult] = useState<CapturePostResult | null>(null)
  const [hasDraft, setHasDraft] = useState(false)

  // Editable draft fields
  const [docType, setDocType] = useState<'bill' | 'purchase'>('purchase')
  const [vendorName, setVendorName] = useState('')
  const [txnDate, setTxnDate] = useState('')
  const [lines, setLines] = useState<EditableLine[]>([])
  const [paymentType, setPaymentType] = useState<'Cash' | 'Check' | 'CreditCard'>('CreditCard')
  const [paymentAccountId, setPaymentAccountId] = useState('')

  useEffect(() => {
    api.accounts().then((r) => setAccounts(r.accounts)).catch(() => {})
  }, [])

  const expenseAccounts = accounts.filter((a) => a.classification === 'Expense')
  const payAccounts = accounts.filter((a) => a.type === 'Bank' || a.type === 'Credit Card')

  const applyDraft = (d: CaptureDraft) => {
    setDocType(d.suggestedDocType)
    setVendorName(d.vendorName ?? '')
    setTxnDate(d.txnDate ?? '')
    setLines(
      (d.lines.length ? d.lines : [{ description: '', amount: 0, accountId: null }]).map((l) => ({
        description: l.description,
        amount: l.amount ? String(l.amount) : '',
        accountId: l.accountId ?? '',
      })),
    )
  }

  const handleFile = async (f: File) => {
    setFile(f)
    setResult(null)
    setHasDraft(false)
    setExtracting(true)
    try {
      const { draft } = await api.captureExtract(f)
      applyDraft(draft)
      setHasDraft(true)
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : 'Could not read that file.')
    } finally {
      setExtracting(false)
    }
  }

  const updateLine = (i: number, patch: Partial<EditableLine>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))

  const addLine = () => setLines((ls) => [...ls, { description: '', amount: '', accountId: '' }])
  const removeLine = (i: number) => setLines((ls) => ls.filter((_, idx) => idx !== i))

  const valid =
    hasDraft &&
    vendorName.trim() !== '' &&
    /^\d{4}-\d{2}-\d{2}$/.test(txnDate) &&
    lines.length > 0 &&
    lines.every((l) => Number(l.amount) > 0 && l.accountId !== '') &&
    (docType !== 'purchase' || paymentAccountId !== '')

  const handleApprove = async () => {
    if (!valid) return
    setPosting(true)
    try {
      const payload: CapturePostPayload = {
        docType,
        vendorName: vendorName.trim(),
        txnDate,
        lines: lines.map((l) => ({
          description: l.description.trim(),
          amount: Number(l.amount),
          accountId: l.accountId,
        })),
        ...(docType === 'purchase' ? { paymentType, paymentAccountId } : {}),
      }
      const r = await api.capturePost(payload, file)
      setResult(r)
      pushToast('success', `Saved to QuickBooks${r.attached ? ' with the document attached' : ''}.`)
      setHasDraft(false)
      setFile(null)
      setLines([])
      setVendorName('')
      setTxnDate('')
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : 'Could not save to QuickBooks.')
    } finally {
      setPosting(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-10 space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">Capture</p>
        <h1 className="text-2xl font-semibold text-slate-800">Add a receipt or bill</h1>
        <p className="mt-1 text-sm text-slate-500">
          Upload a photo or PDF. The AI fills in the details — you check them, then save it to QuickBooks.
        </p>
      </div>

      {/* Upload */}
      <div className="card p-6">
        <label className="btn-primary inline-flex cursor-pointer">
          {extracting ? <Spinner size="sm" /> : null}
          {extracting ? 'Reading…' : file ? 'Choose a different file' : 'Choose a file'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="sr-only"
            disabled={extracting}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handleFile(f)
              e.target.value = ''
            }}
          />
        </label>
        {file && !extracting && <p className="mt-3 text-sm text-slate-500">Selected: {file.name}</p>}
      </div>

      {/* Result */}
      {result && (
        <div className="card p-5 border-emerald-200 bg-emerald-50">
          <p className="font-semibold text-emerald-800">
            {result.entityType === 'Bill' ? 'Bill' : 'Expense'} saved to QuickBooks ✓
          </p>
          <p className="mt-1 text-sm text-emerald-700">
            {result.vendor} · QuickBooks ID {result.entityId}
            {result.attached ? ' · document attached' : ' · (document not attached)'}
          </p>
        </div>
      )}

      {/* Review */}
      {hasDraft && (
        <div className="card p-6 space-y-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Check the details</p>

          {/* Doc type */}
          <div className="flex gap-2">
            {(['purchase', 'bill'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setDocType(t)}
                aria-pressed={docType === t}
                className={[
                  'px-4 py-2 rounded-lg text-sm font-medium border',
                  docType === t ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300',
                ].join(' ')}
              >
                {t === 'purchase' ? 'Already paid (receipt)' : 'Bill to pay later'}
              </button>
            ))}
          </div>

          {/* Vendor + date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-sm font-medium text-slate-600">Who it's from</span>
              <input className={`mt-1 ${inputClass}`} value={vendorName} onChange={(e) => setVendorName(e.target.value)} placeholder="Vendor name" />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-600">Date</span>
              <input type="date" className={`mt-1 ${inputClass}`} value={txnDate} onChange={(e) => setTxnDate(e.target.value)} />
            </label>
          </div>

          {/* Payment (purchase only) */}
          {docType === 'purchase' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block">
                <span className="text-sm font-medium text-slate-600">Paid from</span>
                <select className={`mt-1 ${inputClass}`} value={paymentAccountId} onChange={(e) => setPaymentAccountId(e.target.value)}>
                  <option value="">Choose an account…</option>
                  {payAccounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-600">How</span>
                <select className={`mt-1 ${inputClass}`} value={paymentType} onChange={(e) => setPaymentType(e.target.value as 'Cash' | 'Check' | 'CreditCard')}>
                  <option value="CreditCard">Credit card</option>
                  <option value="Check">Check</option>
                  <option value="Cash">Cash</option>
                </select>
              </label>
            </div>
          )}

          {/* Lines */}
          <div className="space-y-3">
            <span className="text-sm font-medium text-slate-600">What it was for</span>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-start">
                <input
                  className={`col-span-5 ${inputClass}`}
                  value={l.description}
                  onChange={(e) => updateLine(i, { description: e.target.value })}
                  placeholder="Description"
                />
                <input
                  className={`col-span-2 ${inputClass}`}
                  value={l.amount}
                  onChange={(e) => updateLine(i, { amount: e.target.value })}
                  inputMode="decimal"
                  placeholder="0.00"
                  aria-label="Amount"
                />
                <select
                  className={`col-span-4 ${inputClass}`}
                  value={l.accountId}
                  onChange={(e) => updateLine(i, { accountId: e.target.value })}
                  aria-label="Category"
                >
                  <option value="">Choose a category…</option>
                  {expenseAccounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => removeLine(i)}
                  disabled={lines.length === 1}
                  className="col-span-1 text-slate-400 hover:text-rose-600 disabled:opacity-30 text-sm py-2"
                  aria-label="Remove line"
                >
                  ✕
                </button>
              </div>
            ))}
            <button type="button" onClick={addLine} className="btn-ghost text-sm">
              + Add a line
            </button>
          </div>

          <div className="flex items-center gap-3 pt-2 border-t border-slate-100">
            <button className="btn-primary" onClick={handleApprove} disabled={!valid || posting} aria-busy={posting}>
              {posting ? <Spinner size="sm" /> : null}
              {posting ? 'Saving…' : 'Save to QuickBooks'}
            </button>
            {!valid && <span className="text-xs text-slate-400">Fill in the vendor, date, amounts and categories to save.</span>}
          </div>
        </div>
      )}
    </div>
  )
}
