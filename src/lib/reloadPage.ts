/** Reloads the page to discard stale in-memory recovery state through a testable navigation boundary. */
export function reloadPage(): void {
  window.location.reload();
}
