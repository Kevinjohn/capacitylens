const SHOW_COMPANY_PICKER_ON_RELOAD = "capacitylens.showCompanyPickerOnReload";

function historyStateRecord(): Record<string, unknown> {
  const current: unknown = window.history.state;
  return typeof current === "object" && current !== null && !Array.isArray(current)
    ? { ...(current as Record<string, unknown>) }
    : {};
}

/** Mark the clean post-sign-in reload as first entry, without retaining any company identity. */
export function markCompanyPickerForNextReload(): void {
  try {
    window.history.replaceState(
      { ...historyStateRecord(), [SHOW_COMPANY_PICKER_ON_RELOAD]: true },
      "",
      window.location.href,
    );
  } catch (error) {
    // The authentication result remains authoritative. If history state is unavailable, continue
    // the clean boot; the reload may auto-open a sole company instead of stranding the signed-in user.
    console.warn("The one-use company-picker entry marker could not be set", error);
  }
}

/** Consume the post-sign-in marker once. A failed cleanup degrades safely to showing the picker. */
export function consumeCompanyPickerForReload(): boolean {
  const state = historyStateRecord();
  if (state[SHOW_COMPANY_PICKER_ON_RELOAD] !== true) return false;
  delete state[SHOW_COMPANY_PICKER_ON_RELOAD];
  try {
    window.history.replaceState(state, "", window.location.href);
  } catch (error) {
    console.warn("The one-use company-picker entry marker could not be cleared", error);
  }
  return true;
}
