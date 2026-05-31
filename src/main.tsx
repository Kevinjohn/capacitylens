import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import './index.css'
import { router } from './router'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import { useStore } from './store/useStore'
import { persistenceAdapter } from './data/storageAdapter'
import { bootstrap } from './data/persist'
import { seed } from '@floaty/shared/data/seed'
import { applyThemeToDom, watchSystemTheme } from './lib/theme'

// Paint the saved colour scheme (the inline <head> script already did this to beat
// the first paint; this re-affirms it from the store) and keep "system" mode live
// by repainting whenever the OS scheme flips.
applyThemeToDom(useStore.getState().theme)
watchSystemTheme(() => useStore.getState().theme)

// Load (and seed on first run) before/while the app renders. The AppShell gates
// content on `hydrated`, so there's no flash of empty data.
void bootstrap(useStore, persistenceAdapter, {
  seedIfEmpty: seed(),
  onError: () => useStore.getState().setPersistError(true),
  // Recovery: once a write lands again (e.g. the server comes back), take the
  // "changes aren't saving" banner back down. Guarded so a normal save doesn't
  // churn the store on every keystroke.
  onSuccess: () => {
    if (useStore.getState().persistError) useStore.getState().setPersistError(false)
  },
}).catch(() => {
  // Hydration itself failed — still let the app render (with the banner) rather
  // than dying on an unhandled rejection.
  useStore.getState().setHydrated(true)
  useStore.getState().setPersistError(true)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <RouterProvider router={router} />
    </ErrorBoundary>
  </StrictMode>,
)
