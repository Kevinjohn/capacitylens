/** True when a text-editing control should retain its native keyboard shortcut behavior. */
export function textEntryOwnsShortcut(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.matches("input, textarea, select") ||
    target.isContentEditable ||
    target.closest('[contenteditable]:not([contenteditable="false"])') !== null
  );
}

/** Radix dialogs are portalled, so query the document rather than the shortcut event's ancestry. */
export function hasOpenModal(ignoredModal?: Element | null): boolean {
  return Array.from(document.querySelectorAll('[aria-modal="true"]:not([data-state="closed"])')).some(
    (modal) => modal !== ignoredModal,
  );
}
