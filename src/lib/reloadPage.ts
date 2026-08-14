/** Reload through a testable boundary for recovery states that must discard stale in-memory data:
 * a completed import, and post-sign-in invite recovery (reloading the same bearer URL so the invite
 * is reviewed by the NEW session). The ONE boundary for `location.reload()`, so jsdom-backed tests
 * can assert the reboot without attempting to navigate. */
export function reloadPage(): void {
  window.location.reload();
}
