// The device theme preference resolves to a concrete light or dark scheme on the root attribute. Storage and runtime queries fall back to light so display failures cannot affect account data.
import { STORAGE_KEY_PREFIX } from "@capacitylens/shared/brand";

/** Theme selection stored for the current device. */
export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = `${STORAGE_KEY_PREFIX}theme`;

const isThemePreference = (value: unknown): value is ThemePreference =>
  value === "light" || value === "dark" || value === "system";

/** Read the saved preference. Defaults to 'light' (the product default) when
 * nothing is stored, the stored value is invalid, or storage is unavailable. */
export function readStoredTheme(): ThemePreference {
  let current: string | null;
  try {
    current = localStorage.getItem(STORAGE_KEY);
  } catch {
    // A blocked device-preference read may safely use the documented light default.
    return "light";
  }
  return isThemePreference(current) ? current : "light";
}

/** Persist the preference. Best-effort: if storage is unavailable the in-memory
 * store still honours the choice for this session. */
export function writeStoredTheme(preference: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // A failed device-preference write loses only the persisted choice; this session keeps its in-memory theme.
  }
}

const readDarkSchemeQuery = (): MediaQueryList | null => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  try {
    return window.matchMedia("(prefers-color-scheme: dark)");
  } catch (error) {
    // Theme is device-only display state, so a failed runtime query may safely use the documented
    // light fallback, but keep a breadcrumb rather than hiding the environment failure.
    console.warn("Unable to read the system colour scheme; using light", error);
    return null;
  }
};

/** Collapse a preference to the concrete scheme to paint. 'system' follows the OS;
 * if the OS can't be queried (e.g. jsdom in tests) it falls back to light. */
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
 * `getPreference` is read live so the listener tracks the current preference without
 * being re-registered on each change. Returns an unsubscribe fn (no-op if there's
 * no matchMedia). */
export function watchSystemTheme(getPreference: () => ThemePreference): () => void {
  return subscribeToSystemScheme(() => {
    if (getPreference() === "system") applyThemeToDom("system");
  });
}

/** Call `onChange` whenever the OS colour scheme flips. Returns an unsubscribe fn (no-op if
 * there's no matchMedia). */
export function subscribeToSystemScheme(onChange: () => void): () => void {
  const mediaQuery = readDarkSchemeQuery();
  if (!mediaQuery) return () => {};
  mediaQuery.addEventListener("change", onChange);
  return () => mediaQuery.removeEventListener("change", onChange);
}
