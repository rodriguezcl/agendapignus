
import React from 'react'
import ReactDOM from 'react-dom/client'
import './style.css'
import App from './App.jsx'
import AppErrorBoundary from './components/AppErrorBoundary.jsx'
import { installRequiredFeedback } from './presentation/components/forms/required-feedback.mjs'
import './presentation/components/forms/required-feedback.css'
import './components/ui/modal-chrome.css'

const disposeRequiredFeedback = installRequiredFeedback()
if (import.meta.hot) import.meta.hot.dispose(disposeRequiredFeedback)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
)
