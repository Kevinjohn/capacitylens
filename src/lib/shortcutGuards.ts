/** True when a text-editing control should retain its native keyboard shortcut behavior. */
export function textEntryOwnsShortcut(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.matches('input, textarea, select') ||
    target.isContentEditable ||
    target.closest('[contenteditable]:not([contenteditable="false"])') !== null
  )
}

/** Radix dialogs are portalled, so query the document rather than the shortcut event's ancestry. */
export function hasOpenModal(): boolean {
  return document.querySelector('[aria-modal="true"]:not([data-state="closed"])') !== null
}
