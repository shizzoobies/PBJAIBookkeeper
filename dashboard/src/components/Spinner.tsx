interface Props {
  size?: 'sm' | 'md' | 'lg'
  label?: string
}

export function Spinner({ size = 'md', label = 'Loading…' }: Props) {
  const s = { sm: 'h-4 w-4 border-2', md: 'h-6 w-6 border-2', lg: 'h-8 w-8 border-2' }[size]
  return (
    <span role="status" aria-label={label} className="inline-flex items-center justify-center">
      <span
        className={`${s} rounded-full border-slate-300 border-t-slate-700 animate-spin`}
        aria-hidden="true"
      />
      <span className="sr-only">{label}</span>
    </span>
  )
}
