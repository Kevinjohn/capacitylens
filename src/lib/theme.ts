// Colour-scheme preference. Device-global (one choice per browser), stored
// separately from account data — see DECISIONS.md. The store holds the reactive
// preference; these are the pure read/write/resolve/apply helpers it leans on.
//
// Model: the *preference* is light | dark | system; what we actually paint is a
// concrete light | dark, written to <html data-theme> for the CSS to key off.
// 'system' is resolved here (via matchMedia) rather than left to a CSS media
// query, so the explicit choices and the OS-following choice share one mechanism.
import { STORAGE_KEY_PREFIX } from "@capacitylens/shared/brand";

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = `${STORAGE_KEY_PREFIX}theme`;

const isThemePreference = (value: unknown): value is ThemePreference =>
  value === "light" || value === "dark" || value === "system";

/** Read the saved preference. Defaults to 'light' (the product default) when
 *  nothing is stored, the stored value is invalid, or storage is unavailable. */
export function readStoredTheme(): ThemePreference {
  let current: string | null;
  try {
    current = localStorage.getItem(STORAGE_KEY);
  } catch {
    // storage blocked (private mode / quota) — fall through to the default
    return "light";
  }
  return isThemePreference(current) ? current : "light";
}

/** Persist the preference. Best-effort: if storage is unavailable the in-memory
 *  store still honours the choice for this session. */
export function writeStoredTheme(preference: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // ignore — see readStoredTheme
  }
}

const readDarkSchemeQuery = (): MediaQueryList | null =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

/** Collapse a preference to the concrete scheme to paint. 'system' follows the OS;
 *  if the OS can't be queried (e.g. jsdom in tests) it falls back to light. */
export function resolveTheme(preference: ThemePreference): "light" | "dark" {
  if (preference === "system") return readDarkSchemeQuery()?.matches ? "dark" : "light";
  return preference;
}

/** Reflect the resolved scheme onto <html data-theme>, which the CSS keys off. */
export function applyThemeToDom(preference: ThemePreference): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = resolveTheme(preference);
}

/** Re-paint when the OS scheme flips, but only while the user is on 'system'.
 *  `getPreference` is read live so the listener tracks the current preference without
 *  being re-registered on each change. Returns an unsubscribe fn (no-op if there's
 *  no matchMedia). */
export function watchSystemTheme(getPreference: () => ThemePreference): () => void {
  const mediaQuery = readDarkSchemeQuery();
  if (!mediaQuery) return () => {};
  const onChange = () => {
    if (getPreference() === "system") applyThemeToDom("system");
  };
  mediaQuery.addEventListener("change", onChange);
  return () => mediaQuery.removeEventListener("change", onChange);
}
