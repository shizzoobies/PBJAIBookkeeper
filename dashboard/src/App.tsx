import React from 'react'
import { HomeScreen } from './screens/HomeScreen'
import { ReviewScreen } from './screens/ReviewScreen'
import { ReconcileScreen } from './screens/ReconcileScreen'
import { ReportsScreen } from './screens/ReportsScreen'
import { CaptureScreen } from './screens/CaptureScreen'
import { AutopilotScreen } from './screens/AutopilotScreen'
import { ToastRegion, useToasts } from './components/Toast'
import { api } from './api'
import type { Company } from './types'

type Screen = 'home' | 'review' | 'capture' | 'autopilot' | 'reconcile' | 'reports'

interface NavItem {
  id: Screen
  label: string
}

const NAV: NavItem[] = [
  { id: 'home',      label: 'Home' },
  { id: 'review',    label: 'Review' },
  { id: 'capture',   label: 'Capture' },
  { id: 'autopilot', label: 'Autopilot' },
  { id: 'reconcile', label: 'Reconcile' },
  { id: 'reports',   label: 'Reports' },
]

export default function App() {
  const [screen, setScreen] = React.useState<Screen>('home')
  const { toasts, push, dismiss } = useToasts()
  const [companies, setCompanies] = React.useState<Company[]>([])
  const [company, setCompanyState] = React.useState<string | null>(() => {
    const saved = localStorage.getItem('company')
    if (saved) api.setCompany(saved)
    return saved
  })

  // Load the connected companies for the switcher; keep the saved one if still valid.
  React.useEffect(() => {
    api
      .companies()
      .then((r) => {
        setCompanies(r.companies)
        setCompanyState((prev) => {
          const valid = prev && r.companies.some((co) => co.realmId === prev) ? prev : r.companies[0]?.realmId ?? null
          api.setCompany(valid)
          return valid
        })
      })
      .catch(() => {})
  }, [])

  const switchCompany = (realmId: string) => {
    api.setCompany(realmId)
    localStorage.setItem('company', realmId)
    setCompanyState(realmId)
  }

  // Surface the OAuth round-trip result (the Worker redirects back here with
  // ?connected=1 or ?error=…), then clean the query string from the URL.
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('connected') === '1') {
      push('success', 'QuickBooks connected. You’re all set.')
    }
    const err = params.get('error')
    if (err) {
      push(
        'error',
        err === 'connect_expired'
          ? 'That connection link expired. Please click Connect again.'
          : 'We couldn’t finish connecting QuickBooks. Please try again.',
      )
    }
    if (params.has('connected') || params.has('error')) {
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [push])

  return (
    <div className="min-h-dvh flex flex-col">
      {/* Top navigation */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 flex items-center h-14 gap-1">
          {/* Brand */}
          <div className="flex items-center gap-2 mr-6 shrink-0">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-800 text-base select-none"
              aria-hidden="true"
            >
              🥪
            </span>
            <span className="text-sm font-semibold text-slate-700 hidden sm:block">
              Robo PB&J
            </span>
          </div>

          {/* Nav tabs */}
          <nav aria-label="Main navigation" className="flex items-center gap-0.5">
            {NAV.map(item => (
              <button
                key={item.id}
                role="tab"
                aria-selected={screen === item.id}
                onClick={() => setScreen(item.id)}
                className={[
                  'relative px-4 py-1.5 text-sm rounded-md font-medium transition-colors duration-100',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-600',
                  screen === item.id
                    ? 'text-slate-900 bg-slate-100'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50',
                ].join(' ')}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {companies.length > 0 && (
            <label className="ml-auto flex items-center gap-2 text-sm">
              <span className="sr-only">Active company</span>
              <select
                value={company ?? ''}
                onChange={(e) => switchCompany(e.target.value)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700 max-w-[12rem] truncate"
              >
                {companies.map((co) => (
                  <option key={co.realmId} value={co.realmId}>
                    {co.companyName ?? co.realmId}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1" id="main-content">
        {screen === 'home' && (
          <HomeScreen
            key={company ?? 'none'}
            onNavigate={s => setScreen(s)}
            pushToast={push}
          />
        )}
        {screen === 'review' && (
          <ReviewScreen key={company ?? 'none'} pushToast={push} />
        )}
        {screen === 'capture' && (
          <CaptureScreen key={company ?? 'none'} pushToast={push} />
        )}
        {screen === 'autopilot' && (
          <AutopilotScreen key={company ?? 'none'} pushToast={push} />
        )}
        {screen === 'reconcile' && (
          <ReconcileScreen key={company ?? 'none'} pushToast={push} />
        )}
        {screen === 'reports' && (
          <ReportsScreen key={company ?? 'none'} pushToast={push} />
        )}
      </main>

      {/* Toast region */}
      <ToastRegion toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}
