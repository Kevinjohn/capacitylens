/** Removes storage left by the retired snapshot feature without opening or reading a database. */
export async function retireBrowserSnapshots(): Promise<void> {
  const removals: Promise<unknown>[] = [];
  removals.push(
    Promise.resolve().then(() => {
      for (const key of ["offlineRead", "offlineWriteBoundary", "masqueradeOfflineIsolation"]) {
        localStorage.removeItem(`capacitylens/${key}`);
      }
    }),
  );
  if ("serviceWorker" in navigator) {
    removals.push(
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) =>
          Promise.all(
            registrations
              .filter((registration) =>
                [registration.active, registration.waiting, registration.installing].some(
                  (worker) => worker && new URL(worker.scriptURL).pathname === "/offline-worker.js",
                ),
              )
              .map((registration) => registration.unregister()),
          ),
        ),
    );
  }
  if (typeof caches !== "undefined") {
    removals.push(
      caches
        .keys()
        .then((names) =>
          Promise.all(
            names
              .filter(
                (name) => name.startsWith("capacitylens-shell-") || name === "capacitylens-offline-shell-metadata-v1",
              )
              .map((name) => caches.delete(name)),
          ),
        ),
    );
  }
  if (typeof indexedDB !== "undefined") {
    removals.push(
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase("capacitylens-offline-v1");
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error ?? new Error("Retired browser snapshots could not be deleted."));
        request.onblocked = () => reject(new Error("Another open tab is holding retired browser snapshots."));
      }),
    );
  }
  const results = await Promise.allSettled(removals);
  const failures = results.filter((result) => result.status === "rejected").map((result) => result.reason as unknown);
  if (failures.length > 0) throw new AggregateError(failures, "Retired browser storage could not be fully removed.");
}
