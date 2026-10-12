// Focus restoration for Modal lives outside dialogs.tsx because react-refresh forbids exporting
// non-component helpers from a component module. Radix owns focus containment for all dialogs.

/** Restores focus to the opener, or to main when an action removed that opener. This fallback keeps keyboard focus in content after deletion. */
export function restoreFocus(previousValue: HTMLElement | null) {
  if (previousValue?.isConnected) {
    previousValue.focus();
  } else {
    const main = document.querySelector<HTMLElement>("main");
    if (main) {
      main.tabIndex = -1;
      main.focus();
    }
  }
}
