/** Reload through a testable boundary for recovery states that must discard stale in-memory data. */
export function reloadPage(): void {
  window.location.reload();
}
