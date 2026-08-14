/** True when a text-editing control should retain its native keyboard shortcut behavior. */
export function textEntryOwnsShortcut(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.matches("input, textarea, select") || target.isContentEditable) return true;

  // jsdom SHIM, not production logic: real browsers already answered this via `isContentEditable`
  // above, which jsdom does not implement (it is always false there). The walk below reproduces
  // the inheritance rule by hand off the `contenteditable` ATTRIBUTE — nearest ancestor wins, and
  // an explicit `contenteditable="false"` stops the search — so the guard behaves the same under
  // test as it does in a browser. Delete it only if jsdom gains `isContentEditable`.
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
  // Iterate the live NodeList directly and bail on the first hit — no intermediate array, and the
  // common case (one dialog, and it is the ignored one) stops after a single comparison.
  for (const modal of document.querySelectorAll('[aria-modal="true"]:not([data-state="closed"])')) {
    if (modal !== ignoredModal) return true;
  }
  return false;
}
