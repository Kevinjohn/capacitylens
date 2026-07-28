import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
// driver.css BEFORE index.css: index.css re-skins the tour popover (.driver-popover block) onto
// the app tokens with equal-specificity rules, so the vendor sheet must come first in the
// cascade. Importing it from lib/tour.ts instead put it AFTER index.css in the bundle and its
// hard-coded white background won in dark mode.
import "driver.js/dist/driver.css";
import "./index.css";
import { router } from "./router";
import { AuthProvider } from "./auth/AuthProvider";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { useStore } from "./store/useStore";
import { persistenceAdapter } from "./data/storageAdapter";
import { isDemoMode, isServerConfigured } from "./data/apiConfig";
import { bootstrap, ReloadDiscardedEditError } from "./data/persist";
import { persistenceErrorNotice } from "./data/persistenceErrorNotice";
import { seedForCurrentWeek } from "@capacitylens/shared/data/seed";
import { APP_NAME } from "@capacitylens/shared/brand";
import { applyThemeToDom, watchSystemTheme } from "./lib/theme";
import { m } from "@/i18n";

// Validate the fatal mount precondition before theme, persistence, network or listener side effects.
const rootEl = document.getElementById("root");
if (!rootEl)
  throw new Error(`${APP_NAME} mount node #root not found in index.html`);

// Paint the saved colour scheme (the inline <head> script already did this to beat
// the first paint; this re-affirms it from the store) and keep "system" mode live
// by repainting whenever the OS scheme flips.
applyThemeToDom(useStore.getState().theme);
const detachTheme = watchSystemTheme(() => useStore.getState().theme);

// AuthProvider invokes this only after /api/auth/me admits tenant access (or immediately for the
// serverless demo). The AppShell still gates content on `hydrated`, so deferring the request cannot
// flash empty data. The module guard also makes the callback safe under StrictMode's effect replay.
let persistenceStarted = false;
let detachPersistence: (() => void) | null = null;
let moduleDisposed = false;
function startPersistence(): void {
  if (persistenceStarted) return;
  persistenceStarted = true;
  void bootstrap(useStore, persistenceAdapter, {
    // Auto-seed is a DEMO-BUILD-ONLY convenience (single-company-per-instance policy): the
    // in-memory build has no server to own the data, so it seeds a demo dataset on each page load.
    // A server-backed instance (the default) must NOT auto-seed — the server owns its data, and a
    // fresh real deploy now deliberately starts EMPTY at the create-your-company picker rather than
    // fabricating a "Studio North". `undefined` here means bootstrap() only loads whatever the
    // server already has (possibly nothing).
    seedIfEmpty: isDemoMode() ? seedForCurrentWeek() : undefined,
    // Per-account hydration (P1.13): in server mode a tenant pick loads ONLY that account's slice and
    // re-seeds the diff snapshot atomically (the switch orchestrator). The demo build leaves it inert.
    serverMode: isServerConfigured(),
    onError: (e) => {
      // Successful reloads rebase edits made during their network window. This typed error is the
      // exceptional case where an older failed write or committed external replacement cannot be
      // safely replayed. It is a discrete loss, not an ongoing transport failure, so its sticky
      // toast is the whole surface — skip the "changes aren't saving" banner.
      if (e instanceof ReloadDiscardedEditError) {
        useStore.getState().setNotice(m.notice_edit_dropped_reload(), "error");
        return;
      }
      useStore.getState().setPersistError(true);
      const notice = persistenceErrorNotice(e);
      if (notice) useStore.getState().setNotice(notice, "error");
    },
    // Recovery: once a write lands again (e.g. the server comes back), take the
    // "changes aren't saving" banner back down. Guarded so a normal save doesn't
    // churn the store on every keystroke.
    onSuccess: () => {
      if (useStore.getState().persistError)
        useStore.getState().setPersistError(false);
    },
  })
    .then((detach) => {
      if (moduleDisposed) detach();
      else detachPersistence = detach;
    })
    .catch((e) => {
      // Hydration itself failed — still let the app render (with the banner) rather
      // than dying on an unhandled rejection. The banner tells the user "changes aren't saving",
      // but log the real cause too so a contributor isn't left guessing what broke at boot.
      console.error(
        "bootstrap: hydration failed; rendering with the persist-error banner",
        e,
      );
      useStore.getState().setHydrated(true);
      useStore.getState().setPersistError(true);
    });
}

const reactRoot = createRoot(rootEl);
reactRoot.render(
  <StrictMode>
    <ErrorBoundary>
      {/* Auth boundary (P3.3): the demo build and auth-off deploys pass straight through;
          only an auth-enabled server (CAPACITYLENS_AUTH=password|sso) can swap in the login
          screen. Wraps the router so a 401 walls off the whole app, picker included. */}
      <AuthProvider onTenantAccessReady={startPersistence}>
        <RouterProvider router={router} />
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    moduleDisposed = true;
    detachPersistence?.();
    detachTheme();
    reactRoot.unmount();
  });
}
