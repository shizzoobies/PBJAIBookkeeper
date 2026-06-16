import { useEffect } from 'react'

export type ToastKind = 'success' | 'error' | 'info'

export interface ToastMessage {
  id: number
  kind: ToastKind
  text: string
}

interface ToastItemProps {
  toast: ToastMessage
  onDismiss: (id: number) => void
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  useEffect(() => {
    const t = setTimeout(() => onDismiss(toast.id), 4500)
    return () => clearTimeout(t)
  }, [toast.id, onDismiss])

  const colors: Record<ToastKind, string> = {
    success: 'bg-emerald-700 text-white',
    error:   'bg-rose-700 text-white',
    info:    'bg-slate-700 text-white',
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg text-sm font-medium
                  motion-safe:animate-[slideUp_0.2s_ease-out] ${colors[toast.kind]}`}
    >
      <span className="flex-1">{toast.text}</span>
      <button
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
        className="opacity-70 hover:opacity-100 transition-opacity text-lg leading-none"
      >
        ×
      </button>
    </div>
  )
}

interface ToastRegionProps {
  toasts: ToastMessage[]
  onDismiss: (id: number) => void
}

export function ToastRegion({ toasts, onDismiss }: ToastRegionProps) {
  if (toasts.length === 0) return null
  return (
    <div
      aria-label="Notifications"
      className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 w-80 max-w-[calc(100vw-3rem)]"
    >
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

// ── Hook ────────────────────────────────────────────────────────────────────

import { useState, useCallback } from 'react'

let _nextId = 1

export function useToasts() {
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  const push = useCallback((kind: ToastKind, text: string) => {
    const id = _nextId++
    setToasts(prev => [...prev, { id, kind, text }])
  }, [])

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return { toasts, push, dismiss }
}
