import { confidenceBand, type ConfidenceBand } from '../types'

interface Props {
  confidence: number | null
}

const styles: Record<ConfidenceBand, string> = {
  'Sure':       'bg-emerald-100 text-emerald-700 border-emerald-200',
  'Likely':     'bg-amber-100 text-amber-700 border-amber-200',
  'Take a look': 'bg-rose-100 text-rose-600 border-rose-200',
}

export function ConfidencePill({ confidence }: Props) {
  const band = confidenceBand(confidence)
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${styles[band]}`}
      title={confidence !== null ? `${Math.round(confidence * 100)}% confidence` : 'No confidence score'}
    >
      {band}
    </span>
  )
}
