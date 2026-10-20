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
import { bootstrapDemo } from "./data/bootstrapDemo";
import { attachPlanningRuntime } from "./data/planning/planningRuntime";
import { createPlanningTransport } from "./data/planning/planningTransport";
import { createProductionPlanningActions } from "./data/planning/productionPlanningActions";
import { registerPlanningExecutor } from "./data/planning/planningActions";
import { isDemoMode, isServerConfigured } from "./data/apiConfig";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import { seedForCurrentWeek } from "@capacitylens/shared/data/seed";
import { APP_NAME } from "@capacitylens/shared/brand";
import { applyThemeToDom, watchSystemTheme } from "./lib/theme";

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
function startPersistence(): void {
  if (persistenceStarted) return;
  persistenceStarted = true;
  if (isServerConfigured()) {
    const runtime = attachPlanningRuntime(useStore, createPlanningTransport());
    const actions = createProductionPlanningActions(useStore, runtime.controller);
    const detachActions = registerPlanningExecutor(async (name, parameters, draft) =>
      Reflect.apply(actions[name], actions, [...parameters, draft]),
    );
    detachPersistence = () => {
      detachActions();
      runtime.dispose();
    };
    return;
  }
  // The demo owns only the current page's Zustand state. A fresh page boot starts from
  // the canonical seed again; no browser persistence or diff subscriber is attached.
  bootstrapDemo(useStore, isDemoMode() ? seedForCurrentWeek() : emptyAppData());
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
    detachPersistence?.();
    detachTheme();
    reactRoot.unmount();
  });
}
