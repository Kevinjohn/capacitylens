/** True when a text-editing control should retain its native keyboard shortcut behavior. */
export function textEntryOwnsShortcut(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.matches("input, textarea, select") || target.isContentEditable) return true;

  let owner = target.closest("[contenteditable]");
  while (owner !== null) {
    const state = owner.getAttribute("contenteditable")?.toLowerCase();
    if (state === "" || state === "true" || state === "plaintext-only") return true;
    if (state === "false") return false;
    owner = owner.parentElement?.closest("[contenteditable]") ?? null;
  }
  return false;
}

/** Radix dialogs are portalled, so query the document rather than the shortcut event's ancestry. */
export function hasOpenModal(ignoredModal?: Element | null): boolean {
  return Array.from(document.querySelectorAll('[aria-modal="true"]:not([data-state="closed"])')).some(
    (modal) => modal !== ignoredModal,
  );
}
