// Shared focus plumbing for capacitylens's hand-rolled overlay semantics (the Modal in
// ./dialogs.tsx and the CommandPalette). Lives in its own module — not dialogs.tsx — because
// react-refresh forbids exporting non-component helpers from a component file, and because the
// two overlays must share ONE definition of "focusable" and one restore policy so they can't drift.

/** The set of natively-focusable controls inside a dialog-like overlay — shared by the manual
 *  Tab-trap (window keydown), the Modal's initial-focus fallback (onOpenAutoFocus), and the
 *  CommandPalette's Tab wrap so the three can't drift. The Tab-traps additionally drop
 *  disabled elements at runtime; initial focus uses a `:not([disabled])` variant so it never
 *  lands on a disabled control (which would silently drop focus to <body>). */
export const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/** Restore focus to `prev` (the element that had focus before the overlay opened) on close.
 *  But .focus() on a node that's been detached from the DOM is a silent no-op that drops
 *  focus to <body>, stranding keyboard/SR users (WCAG 2.4.3) — an action like delete can
 *  unmount the row/button that opened the dialog. So fall back to the <main> landmark (made
 *  programmatically focusable) to keep focus in the content. */
export function restoreFocus(prev: HTMLElement | null) {
  if (prev?.isConnected) {
    prev.focus?.()
  } else {
    const main = document.querySelector<HTMLElement>('main')
    if (main) {
      main.tabIndex = -1
      main.focus()
    }
  }
}
