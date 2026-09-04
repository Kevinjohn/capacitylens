import {
  OFFLINE_PREF_KEY,
  SHELL_CACHE_PREFIX,
  SHELL_METADATA_CACHE,
  ACTIVE_SHELL_POINTER,
  OFFLINE_WORKER_URL,
  SHELL_ACTIVATION_TIMEOUT_MS,
} from "./constants";
import { offlineReadEnabled, publishPreference, setOfflineCacheWriteFailed } from "./state";
import { webCrypto, deviceKey, initialiseWriteBoundary } from "./crypto";
import { openOfflineDb } from "./idb";
// Teardown stays on the public facade; this binding is called only after module initialisation.
import { clearAllOfflineData } from "../offlineCache";

export function offlineShellAvailable(environment: { PROD: boolean; MODE: string }): boolean {
  return environment.PROD || environment.MODE === "test";
}

/** Does this registration belong to our app-shell worker? Any of its three lifecycle slots proves
 * ownership, so revalidation and teardown recognise the same registrations. */
function isOfflineWorkerRegistration(registration: ServiceWorkerRegistration): boolean {
  return [registration.active, registration.waiting, registration.installing].some((worker) =>
    worker?.scriptURL.endsWith(OFFLINE_WORKER_URL),
  );
}

/** Revalidate the durable shell promised by the device preference. A browser/site-data cleanup can
 * remove the worker or cache without removing localStorage, so the preference must fail closed. */
export async function revalidateOfflineShell(): Promise<boolean> {
  if (!offlineReadEnabled()) return false;
  try {
    if (!("serviceWorker" in navigator) || typeof caches === "undefined") throw new Error("unsupported");
    const registrations = await navigator.serviceWorker.getRegistrations();
    const workerPresent = registrations.some(isOfflineWorkerRegistration);
    const metadata = await caches.open(SHELL_METADATA_CACHE);
    const pointer = await metadata.match(ACTIVE_SHELL_POINTER);
    const cacheName = pointer ? await pointer.text() : "";
    const shellPresent =
      cacheName.startsWith(SHELL_CACHE_PREFIX) &&
      (await caches.has(cacheName)) &&
      Boolean(await (await caches.open(cacheName)).match("/"));
    if (workerPresent && shellPresent) return true;
  } catch (error) {
    console.warn("offlineCache: the promised offline shell could not be revalidated", error);
  }
  try {
    localStorage.removeItem(OFFLINE_PREF_KEY);
  } catch (error) {
    console.warn("offlineCache: the stale offline preference could not be removed", error);
  }
  publishPreference();
  return false;
}

/** Registration creation precedes the worker's install/activate lifecycle. The worker publishes
 * its active-shell pointer inside activate.waitUntil(), so `activated` is the first state that
 * proves every shell asset was staged and the neutral index entry was promoted successfully. */
async function waitForOfflineShellActivation(registration: ServiceWorkerRegistration): Promise<void> {
  const worker = registration.installing ?? registration.waiting ?? registration.active;
  if (!worker) throw new Error("Offline shell registration did not provide a service worker.");
  if (worker.state === "activated") return;
  if (worker.state === "redundant") {
    throw new Error("Offline shell installation failed before activation.");
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeEventListener("statechange", onStateChange);
      if (error) reject(error);
      else resolve();
    };
    const onStateChange = () => {
      if (worker.state === "activated") finish();
      else if (worker.state === "redundant") {
        finish(new Error("Offline shell installation failed before activation."));
      }
    };
    const timer = setTimeout(
      () => finish(new Error("Offline shell installation did not finish in time.")),
      SHELL_ACTIVATION_TIMEOUT_MS,
    );
    worker.addEventListener("statechange", onStateChange);
    onStateChange();
  });
}

/** Enable or disable offline access on this device. Disabling also removes the app-shell worker. */
export async function setOfflineReadEnabled(enabled: boolean): Promise<void> {
  if (enabled && !offlineShellAvailable(import.meta.env)) {
    throw new Error("Offline access can only be enabled from a production build.");
  }
  if (enabled && !("serviceWorker" in navigator)) {
    throw new Error("Offline access is not supported by this browser.");
  }

  try {
    if (enabled) {
      webCrypto();
      const db = await openOfflineDb();
      try {
        await deviceKey(db);
        await initialiseWriteBoundary(db);
      } finally {
        db.close();
      }
      const registration = await navigator.serviceWorker.register(OFFLINE_WORKER_URL, { scope: "/" });
      await waitForOfflineShellActivation(registration);
      localStorage.setItem(OFFLINE_PREF_KEY, "on");
      publishPreference();
      return;
    }

    localStorage.removeItem(OFFLINE_PREF_KEY);
    publishPreference();
    setOfflineCacheWriteFailed(false);
    await clearAllOfflineData();
    if (!("serviceWorker" in navigator)) return;
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations.filter(isOfflineWorkerRegistration).map((registration) => registration.unregister()),
    );
    if (typeof caches !== "undefined") {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(SHELL_CACHE_PREFIX) || name === SHELL_METADATA_CACHE)
          .map((name) => caches.delete(name)),
      );
    }
  } catch (error) {
    // A failed enable must fail closed: without a working shell cache the preference would promise
    // offline access that cannot actually boot. A failed disable remains disabled even if browser
    // cleanup itself was blocked; the stale worker contains no tenant data and is never consulted.
    if (enabled) {
      try {
        localStorage.removeItem(OFFLINE_PREF_KEY);
      } catch (cleanupError) {
        console.warn("offlineCache: failed to clean up after offline enablement failed", cleanupError);
      }
    }
    throw error;
  }
}
