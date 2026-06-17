import React from 'react'
import { HomeScreen } from './screens/HomeScreen'
import { ReviewScreen } from './screens/ReviewScreen'
import { ReconcileScreen } from './screens/ReconcileScreen'
import { ReportsScreen } from './screens/ReportsScreen'
import { CaptureScreen } from './screens/CaptureScreen'
import { ToastRegion, useToasts } from './components/Toast'

type Screen = 'home' | 'review' | 'capture' | 'reconcile' | 'reports'

interface NavItem {
  id: Screen
  label: string
}

const NAV: NavItem[] = [
  { id: 'home',      label: 'Home' },
  { id: 'review',    label: 'Review' },
  { id: 'capture',   label: 'Capture' },
  { id: 'reconcile', label: 'Reconcile' },
  { id: 'reports',   label: 'Reports' },
]

export default function App() {
  const [screen, setScreen] = React.useState<Screen>('home')
  const { toasts, push, dismiss } = useToasts()

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
              className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-800 text-white text-xs font-bold select-none"
              aria-hidden="true"
            >
              AI
            </span>
            <span className="text-sm font-semibold text-slate-700 hidden sm:block">
              AI Bookkeeper
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
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1" id="main-content">
        {screen === 'home' && (
          <HomeScreen
            onNavigate={s => setScreen(s)}
            pushToast={push}
          />
        )}
        {screen === 'review' && (
          <ReviewScreen pushToast={push} />
        )}
        {screen === 'capture' && (
          <CaptureScreen pushToast={push} />
        )}
        {screen === 'reconcile' && (
          <ReconcileScreen pushToast={push} />
        )}
        {screen === 'reports' && (
          <ReportsScreen pushToast={push} />
        )}
      </main>

      {/* Toast region */}
      <ToastRegion toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}
