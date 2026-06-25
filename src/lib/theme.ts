// Colour-scheme preference. Device-global (one choice per browser), stored
// separately from account data — see DECISIONS.md. The store holds the reactive
// preference; these are the pure read/write/resolve/apply helpers it leans on.
//
// Model: the *preference* is light | dark | system; what we actually paint is a
// concrete light | dark, written to <html data-theme> for the CSS to key off.
// 'system' is resolved here (via matchMedia) rather than left to a CSS media
// query, so the explicit choices and the OS-following choice share one mechanism.
import { STORAGE_KEY_PREFIX } from '@capacitylens/shared/brand'

export type ThemePref = 'light' | 'dark' | 'system'

const STORAGE_KEY = `${STORAGE_KEY_PREFIX}theme`

/** Read the saved preference. Defaults to 'light' (the product default) when
 *  nothing is stored or storage is unavailable. */
export function readStoredTheme(): ThemePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    // storage blocked (private mode / quota) — fall through to the default
  }
  return 'light'
}

/** Persist the preference. Best-effort: if storage is unavailable the in-memory
 *  store still honours the choice for this session. */
export function writeStoredTheme(pref: ThemePref): void {
  try {
    localStorage.setItem(STORAGE_KEY, pref)
  } catch {
    // ignore — see readStoredTheme
  }
}

const darkQuery = (): MediaQueryList | null =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null

/** Collapse a preference to the concrete scheme to paint. 'system' follows the OS;
 *  if the OS can't be queried (e.g. jsdom in tests) it falls back to light. */
export function resolveTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref === 'system') return darkQuery()?.matches ? 'dark' : 'light'
  return pref
}

/** Reflect the resolved scheme onto <html data-theme>, which the CSS keys off. */
export function applyThemeToDom(pref: ThemePref): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = resolveTheme(pref)
}

/** Re-paint when the OS scheme flips, but only while the user is on 'system'.
 *  `getPref` is read live so the listener tracks the current preference without
 *  being re-registered on each change. Returns an unsubscribe fn (no-op if there's
 *  no matchMedia). */
export function watchSystemTheme(getPref: () => ThemePref): () => void {
  const mql = darkQuery()
  if (!mql) return () => {}
  const onChange = () => {
    if (getPref() === 'system') applyThemeToDom('system')
  }
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}
