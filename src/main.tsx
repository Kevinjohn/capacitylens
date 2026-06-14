import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import './index.css'
import { router } from './router'
import { AuthProvider } from './auth/AuthProvider'
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
}).catch((e) => {
  // Hydration itself failed — still let the app render (with the banner) rather
  // than dying on an unhandled rejection. The banner tells the user "changes aren't saving",
  // but log the real cause too so a contributor isn't left guessing what broke at boot.
  console.error('bootstrap: hydration failed; rendering with the persist-error banner', e)
  useStore.getState().setHydrated(true)
  useStore.getState().setPersistError(true)
})

// Fail loud and LEGIBLE if the mount node is missing (e.g. a fork that renamed/removed it in
// index.html): a fatal, unrecoverable boot precondition deserves a clear message, not the cryptic
// "Cannot read properties of null" that `getElementById('root')!` would throw on a blank screen.
const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Floaty mount node #root not found in index.html')

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      {/* Auth boundary (P3.3): local mode and auth-off deploys pass straight through;
          only an auth-enabled server (FLOATY_AUTH=password|sso) can swap in the login
          screen. Wraps the router so a 401 walls off the whole app, picker included. */}
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
)
