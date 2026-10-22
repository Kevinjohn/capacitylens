import { StrictMode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import "driver.js/dist/driver.css";
import "./index.css";
import { router } from "./router";
import { QueryCacheLifecycle } from "./api/QueryCacheLifecycle";
import { queryClient } from "./api/queryClient";
import { AuthProvider } from "./auth/AuthProvider";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { useStore } from "./store/useStore";
import { retireBrowserSnapshots } from "./data/retireBrowserSnapshots";
import { isDemoMode } from "./data/apiConfig";
import { seedForCurrentWeek } from "@capacitylens/shared/data/seed";
import { APP_NAME } from "@capacitylens/shared/brand";
import { applyThemeToDom, watchSystemTheme } from "./lib/theme";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error(`${APP_NAME} mount node #root not found in index.html`);

void retireBrowserSnapshots().catch((error: unknown) => console.error("Browser snapshot retirement failed", error));

applyThemeToDom(useStore.getState().theme);
const detachTheme = watchSystemTheme(() => useStore.getState().theme);

let dataStarted = false;
function startData(): void {
  if (dataStarted) return;
  dataStarted = true;
  if (isDemoMode()) useStore.getState().replaceAll(seedForCurrentWeek());
  useStore.getState().setHydrated(true);
}

const reactRoot = createRoot(rootEl);
reactRoot.render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <AuthProvider onTenantAccessReady={startData}>
          <QueryCacheLifecycle />
          <RouterProvider router={router} />
        </AuthProvider>
      </ErrorBoundary>
    </QueryClientProvider>
  </StrictMode>,
);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    detachTheme();
    reactRoot.unmount();
  });
}
