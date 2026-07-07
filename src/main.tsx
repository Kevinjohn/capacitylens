// MUST be first: runs the storage-key rebrand migration (floaty/ → capacitylens/) as a module
// side-effect, before any other import reads storage (the Zustand store reads device prefs eagerly
// on import). Removable a release after the rebrand. See src/data/runStorageMigration.ts.
import './data/runStorageMigration'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
// driver.css BEFORE index.css: index.css re-skins the tour popover (.driver-popover block) onto
// the app tokens with equal-specificity rules, so the vendor sheet must come first in the
// cascade. Importing it from lib/tour.ts instead put it AFTER index.css in the bundle and its
// hard-coded white background won in dark mode.
import 'driver.js/dist/driver.css'
import './index.css'
import { router } from './router'
import { AuthProvider } from './auth/AuthProvider'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import { useStore } from './store/useStore'
import { persistenceAdapter } from './data/storageAdapter'
import { isDemoMode, isServerConfigured } from './data/apiConfig'
import { bootstrap } from './data/persist'
import { seed } from '@capacitylens/shared/data/seed'
import { APP_NAME } from '@capacitylens/shared/brand'
import { applyThemeToDom, watchSystemTheme } from './lib/theme'

// Paint the saved colour scheme (the inline <head> script already did this to beat
// the first paint; this re-affirms it from the store) and keep "system" mode live
// by repainting whenever the OS scheme flips.
applyThemeToDom(useStore.getState().theme)
watchSystemTheme(() => useStore.getState().theme)

// Load (and seed on first run) before/while the app renders. The AppShell gates
// content on `hydrated`, so there's no flash of empty data.
void bootstrap(useStore, persistenceAdapter, {
  // Auto-seed is a DEMO-BUILD-ONLY convenience (single-company-per-instance policy): the
  // localStorage build has no server to own the data, so it seeds a demo dataset on first run.
  // A server-backed instance (the default) must NOT auto-seed — the server owns its data, and a
  // fresh real deploy now deliberately starts EMPTY at the create-your-company picker rather than
  // fabricating a "Studio North". `undefined` here means bootstrap() only loads whatever the
  // server already has (possibly nothing).
  seedIfEmpty: isDemoMode() ? seed() : undefined,
  // Per-account hydration (P1.13): in server mode a tenant pick loads ONLY that account's slice and
  // re-seeds the diff snapshot atomically (the switch orchestrator). The demo build leaves it inert.
  serverMode: isServerConfigured(),
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
if (!rootEl) throw new Error(`${APP_NAME} mount node #root not found in index.html`)

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      {/* Auth boundary (P3.3): the demo build and auth-off deploys pass straight through;
          only an auth-enabled server (CAPACITYLENS_AUTH=password|sso) can swap in the login
          screen. Wraps the router so a 401 walls off the whole app, picker included. */}
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
)
