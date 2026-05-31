import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import './index.css'
import { router } from './router'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import { useStore } from './store/useStore'
import { LocalStorageAdapter } from './data/LocalStorageAdapter'
import { bootstrap } from './data/persist'
import { seed } from './data/seed'
import { applyThemeToDom, watchSystemTheme } from './lib/theme'

// Paint the saved colour scheme (the inline <head> script already did this to beat
// the first paint; this re-affirms it from the store) and keep "system" mode live
// by repainting whenever the OS scheme flips.
applyThemeToDom(useStore.getState().theme)
watchSystemTheme(() => useStore.getState().theme)

// Load (and seed on first run) before/while the app renders. The AppShell gates
// content on `hydrated`, so there's no flash of empty data.
void bootstrap(useStore, new LocalStorageAdapter('floaty/v3'), {
  seedIfEmpty: seed(),
  onError: () => useStore.getState().setPersistError(true),
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
