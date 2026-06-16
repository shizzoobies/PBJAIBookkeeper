import React from 'react'

interface Props {
  icon?: string
  title: string
  body?: string
  action?: React.ReactNode
}

export function EmptyState({ icon = '✓', title, body, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-2xl" aria-hidden="true">
        {icon}
      </div>
      <p className="text-base font-semibold text-slate-700">{title}</p>
      {body && <p className="mt-1 text-sm text-slate-500 max-w-xs">{body}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}
