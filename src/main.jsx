
import React, { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import './style.css'
const App = lazy(() => import('./App.jsx'))
const PublicRegistration = lazy(() => import('./features/registration/PublicRegistration.jsx'))
import AppErrorBoundary from './components/AppErrorBoundary.jsx'
import { installPushNavigation } from './infrastructure/browser/push-navigation.mjs'
import { installRequiredFeedback } from './presentation/components/forms/required-feedback.mjs'
import './presentation/components/forms/required-feedback.css'
import './components/ui/modal-chrome.css'
import './mobile-layout.css'
import './presentation/components/forms/select-containment.css'

const disposeRequiredFeedback = window.location.pathname === '/alta' ? () => {} : installRequiredFeedback()
if(window.location.pathname !== '/alta')installPushNavigation()
if (import.meta.hot) import.meta.hot.dispose(disposeRequiredFeedback)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <Suspense fallback={<p role="status">Cargando…</p>}>
        {window.location.pathname === '/alta' ? <PublicRegistration /> : <App />}
      </Suspense>
    </AppErrorBoundary>
  </React.StrictMode>
)

import './components/settings-layout.css'

import './components/vehicle-history.css'

import './components/weekly-toolbar.css'

import './dark-neutral.css'

import './dark-neutral-legacy.css'

// Shared admin theme comes last so legacy modules use the same visual system.
import './presentation/theme/tokens.css'
import './presentation/theme/shell.css'
import './presentation/theme/modules.css'
import './presentation/theme/forms.css'
