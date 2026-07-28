// Focus restoration for Modal lives outside dialogs.tsx because react-refresh forbids exporting
// non-component helpers from a component module. Radix owns focus containment for all dialogs.

/** Restore focus to `prev` (the element that had focus before the overlay opened) on close.
 *  But .focus() on a node that's been detached from the DOM is a silent no-op that drops
 *  focus to <body>, stranding keyboard/SR users (WCAG 2.4.3) — an action like delete can
 *  unmount the row/button that opened the dialog. So fall back to the <main> landmark (made
 *  programmatically focusable) to keep focus in the content. */
export function restoreFocus(prev: HTMLElement | null) {
  if (prev?.isConnected) {
    prev.focus?.();
  } else {
    const main = document.querySelector<HTMLElement>("main");
    if (main) {
      main.tabIndex = -1;
      main.focus();
    }
  }
}
