import { StrictMode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
// Import vendor tour CSS before app styles so equal-specificity theme overrides win.
import "driver.js/dist/driver.css";
import "./index.css";
import { router } from "./router";
import { QueryCacheLifecycle } from "./api/QueryCacheLifecycle";
import { queryClient } from "./api/queryClient";
import { AuthProvider } from "./auth/AuthProvider";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { useStore } from "./store/useStore";
import { retireBrowserSnapshots } from "./data/retireBrowserSnapshots";
import { persistenceAdapter } from "./data/storageAdapter";
import { isDemoMode, isServerConfigured } from "./data/apiConfig";
import { bootstrap, ReloadDiscardedEditError } from "./data/persist";
import { resolvePersistenceErrorNotice } from "./data/persistenceErrorNotice";
import { seedForCurrentWeek } from "@capacitylens/shared/data/seed";
import { APP_NAME } from "@capacitylens/shared/brand";
import { applyThemeToDom, watchSystemTheme } from "./lib/theme";
import { m } from "@/i18n";

// Validate the fatal mount precondition before theme, persistence, network or listener side effects.
const rootEl = document.getElementById("root");
if (!rootEl) throw new Error(`${APP_NAME} mount node #root not found in index.html`);

// Remove old workers as well as records so a later navigation cannot revive the retired app shell.
void retireBrowserSnapshots().catch((error: unknown) => console.error("Browser snapshot retirement failed", error));

applyThemeToDom(useStore.getState().theme);
const detachTheme = watchSystemTheme(() => useStore.getState().theme);

// AuthProvider invokes this only after /api/auth/me admits tenant access (or immediately for the
// serverless demo). The AppShell still gates content on `hydrated`, so deferring the request cannot
// flash empty data. The module guard also makes the callback safe under StrictMode's effect replay.
let persistenceStarted = false;
let detachPersistence: (() => void) | null = null;
let moduleDisposed = false;
function startPersistence(identitySource: "live" | "open"): void {
  if (persistenceStarted) return;
  persistenceStarted = true;
  const masquerade = useStore.getState().masquerade;
  const activeMasquerade = masquerade.kind !== "inactive" ? masquerade.state : undefined;
  let bootstrapProjectionOptions: {
    initialLoad?: "empty";
    initialAccountId?: string;
    skipExistingCheck?: boolean;
  } = {};
  if (activeMasquerade && isServerConfigured()) {
    bootstrapProjectionOptions = { initialAccountId: activeMasquerade.accountId, skipExistingCheck: true };
  } else if (identitySource === "live" && isServerConfigured()) {
    bootstrapProjectionOptions = { initialLoad: "empty" };
  }
  void bootstrap(useStore, persistenceAdapter, {
    ...bootstrapProjectionOptions,
    // Seed only the memory-only demo build. Server-backed instances load their own data
    // and begin at company creation when empty.
    ...(isDemoMode() ? { seedIfEmpty: seedForCurrentWeek() } : {}),

    serverMode: isServerConfigured(),
    onError: (error) => {
      // Successful reloads rebase edits made during their network window. This typed error is the
      // exceptional case where an older failed write or committed external replacement cannot be
      // safely replayed. It is a discrete loss, not an ongoing transport failure, so its sticky
      // toast is the whole surface, skip the "changes aren't saving" banner.
      if (error instanceof ReloadDiscardedEditError) {
        useStore.getState().setNotice(m.notice_edit_dropped_reload(), "error");
        return;
      }
      useStore.getState().setPersistError(true);
      const notice = resolvePersistenceErrorNotice(error);
      if (notice) useStore.getState().setNotice(notice, "error");
    },
    // Recovery: once a write lands again (e.g. the server comes back), take the
    // "changes aren't saving" banner back down. Guarded so a normal save doesn't
    // churn the store on every keystroke.
    onSuccess: () => {
      if (useStore.getState().persistError) useStore.getState().setPersistError(false);
    },
  })
    .then((detach) => {
      if (moduleDisposed) detach();
      else detachPersistence = detach;
    })
    .catch((e) => {
      // Hydration itself failed, still let the app render (with the banner) rather
      // than dying on an unhandled rejection. The banner tells the user "changes aren't saving",
      // but log the real cause too so a contributor isn't left guessing what broke at boot.
      console.error("bootstrap: hydration failed; rendering with the persist-error banner", e);
      useStore.getState().setHydrated(true);
      useStore.getState().setPersistError(true);
    });
}

const reactRoot = createRoot(rootEl);
reactRoot.render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        {/* AuthProvider gates the router so an expired authenticated session also hides the picker. */}
        <AuthProvider onTenantAccessReady={startPersistence}>
          <QueryCacheLifecycle />
          <RouterProvider router={router} />
        </AuthProvider>
      </ErrorBoundary>
    </QueryClientProvider>
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
