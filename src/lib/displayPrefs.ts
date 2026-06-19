// Display preferences. Device-global (one set of choices per browser), stored
// separately from account data — same rationale as the theme preference
// (see theme.ts / DECISIONS.md): these are view toggles, not tenant records.
//
// The store holds the reactive values; these are the pure read/write helpers it
// leans on. Everything defaults to true (show everything) on first run.
//
// ON THE SWALLOW (deliberate): every localStorage access below is wrapped and falls back to a
// documented default. This is the ONE category where swallow-to-default is correct (see
// DEFENSIVE-CODING.md §5) — these are device-global, NON-TENANT view toggles, so a blocked /
// private-mode / quota / corrupt store can lose a toggle but can NEVER corrupt account data, and
// the in-memory store still honours the choice for the session. Do NOT copy this onto a data path.

export interface UtilizationPrefs {
  /** Show the account-wide utilisation summary. */
  showTotal: boolean
  /** Show per-discipline utilisation. */
  showDiscipline: boolean
  /** Show per-person (per-resource) utilisation. */
  showPersonal: boolean
}

export const DEFAULT_UTILIZATION_PREFS: UtilizationPrefs = {
  showTotal: true,
  showDiscipline: true,
  showPersonal: true,
}

const STORAGE_KEY = 'floaty/utilizationPrefs'

/** Read the saved preferences, falling back to the defaults for anything missing
 *  or when storage is unavailable. Tolerant of partial/legacy stored shapes. */
export function readStoredUtilizationPrefs(): UtilizationPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<UtilizationPrefs>
      return {
        showTotal: typeof parsed.showTotal === 'boolean' ? parsed.showTotal : DEFAULT_UTILIZATION_PREFS.showTotal,
        showDiscipline:
          typeof parsed.showDiscipline === 'boolean' ? parsed.showDiscipline : DEFAULT_UTILIZATION_PREFS.showDiscipline,
        showPersonal:
          typeof parsed.showPersonal === 'boolean' ? parsed.showPersonal : DEFAULT_UTILIZATION_PREFS.showPersonal,
      }
    }
  } catch {
    // storage blocked or malformed JSON — fall through to the defaults
  }
  return { ...DEFAULT_UTILIZATION_PREFS }
}

/** Persist the preferences. Best-effort: if storage is unavailable the in-memory
 *  store still honours the choice for this session. */
export function writeStoredUtilizationPrefs(prefs: UtilizationPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // best-effort write — storage blocked/full; deliberate non-tenant swallow (see file header).
  }
}

export interface BarLabelPrefs {
  /** Prefix the allocation bar's label with the client name. */
  showClient: boolean
  /** Prefix the allocation bar's label with the project name. */
  showProject: boolean
}

export const DEFAULT_BAR_LABEL_PREFS: BarLabelPrefs = {
  showClient: true,
  showProject: true,
}

const BAR_LABEL_STORAGE_KEY = 'floaty/barLabelPrefs'

/** Read the saved bar-label preferences — same tolerant fallback behaviour as
 *  readStoredUtilizationPrefs. */
export function readStoredBarLabelPrefs(): BarLabelPrefs {
  try {
    const raw = localStorage.getItem(BAR_LABEL_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<BarLabelPrefs>
      return {
        showClient: typeof parsed.showClient === 'boolean' ? parsed.showClient : DEFAULT_BAR_LABEL_PREFS.showClient,
        showProject: typeof parsed.showProject === 'boolean' ? parsed.showProject : DEFAULT_BAR_LABEL_PREFS.showProject,
      }
    }
  } catch {
    // storage blocked or malformed JSON — fall through to the defaults
  }
  return { ...DEFAULT_BAR_LABEL_PREFS }
}

/** Persist the bar-label preferences. Best-effort, like writeStoredUtilizationPrefs. */
export function writeStoredBarLabelPrefs(prefs: BarLabelPrefs): void {
  try {
    localStorage.setItem(BAR_LABEL_STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // best-effort write — storage blocked/full; deliberate non-tenant swallow (see file header).
  }
}

// Sidebar open/collapsed. Device-global like the prefs above, but tri-state on
// read: null means "the user has never chosen", and the caller falls back to the
// viewport-derived default below instead of a fixed boolean.

const SIDEBAR_STORAGE_KEY = 'floaty/sidebar'

/** Small-screen query for the sidebar's first-run default. Phone-portrait widths
 *  OR phone-landscape heights count as small — a landscape phone is the app's
 *  recommended orientation and still shouldn't spend 192px on a menu. */
export const SMALL_VIEWPORT_QUERY = '(max-width: 767px), (max-height: 480px)'

/** The user's explicit sidebar choice, or null if they've never toggled it. */
export function readStoredSidebarOpen(): boolean | null {
  try {
    const raw = localStorage.getItem(SIDEBAR_STORAGE_KEY)
    if (raw === 'open') return true
    if (raw === 'closed') return false
  } catch {
    // storage blocked — fall through to "no choice"
  }
  return null
}

/** Persist the sidebar choice. Best-effort, like the prefs above. */
export function writeStoredSidebarOpen(open: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, open ? 'open' : 'closed')
  } catch {
    // best-effort write — storage blocked/full; deliberate non-tenant swallow (see file header).
  }
}

/** First-run default: open on desktop, collapsed on small screens. Guarded for
 *  non-browser environments (jsdom has no matchMedia) where it defaults open. */
export function defaultSidebarOpen(): boolean {
  try {
    if (typeof window.matchMedia === 'function') {
      return !window.matchMedia(SMALL_VIEWPORT_QUERY).matches
    }
  } catch {
    // matchMedia unavailable — treat as a large screen
  }
  return true
}

// Shared shape for the simple device-global on/off flags below (minimise-weekends and
// fake-sign-in): a single boolean stored as the literal string 'on'/'off' under its own key,
// with a fixed boolean default. The sidebar pref above is deliberately NOT one of these — it's
// tri-state ('open'/'closed'/never-chosen). Same swallow-to-default rule as the file header:
// a blocked/corrupt store loses the toggle but can never touch tenant data.

/** Read an on/off flag stored as 'on'/'off' under `key`; returns `fallback` when unset,
 *  unrecognised, or when storage is unavailable. */
function readBoolPref(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key)
    if (raw === 'on') return true
    if (raw === 'off') return false
  } catch {
    // storage blocked — fall through to the fallback
  }
  return fallback
}

/** Persist an on/off flag as 'on'/'off' under `key`. Best-effort, like the prefs above. */
function writeBoolPref(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? 'on' : 'off')
  } catch {
    // best-effort write — storage blocked/full; deliberate non-tenant swallow (see file header).
  }
}

// "Minimise weekends": shrink the Saturday/Sunday columns on the schedule to a sliver.
// Device-global like the prefs above (own key, not account data), but DEFAULTS ON — the owner's
// stated default. A plain on/off string (like the sidebar) rather than JSON: it's a single bool.

const MINIMISE_WEEKENDS_STORAGE_KEY = 'floaty/minimiseWeekends'

/** The saved "minimise weekends" choice; defaults to TRUE (on) when unset, unrecognised, or
 *  when storage is unavailable. */
export function readStoredMinimiseWeekends(): boolean {
  return readBoolPref(MINIMISE_WEEKENDS_STORAGE_KEY, true)
}

/** Persist the "minimise weekends" choice. Best-effort, like the prefs above. */
export function writeStoredMinimiseWeekends(on: boolean): void {
  writeBoolPref(MINIMISE_WEEKENDS_STORAGE_KEY, on)
}

// "Fake sign-in": a COSMETIC demo gate shown before the account picker so a viewer sees a
// "log in first, then pick a company" flow. Device-global like the prefs above (own key,
// on/off string, NOT account data) and DEFAULTS OFF so the demo sign-in shows on first run.
// This is NOT real auth — the real, server-authoritative seam is `src/auth/`. The flag is
// flipped on by the demo sign-in screen and cleared by "Sign out". See
// `src/components/FakeSignIn.tsx` and DECISIONS.md.

const FAKE_SIGNED_IN_STORAGE_KEY = 'floaty/fakeSignedIn'

/** The saved fake-sign-in state; defaults to FALSE (signed out → show the demo sign-in)
 *  when unset, unrecognised, or when storage is unavailable. */
export function readStoredFakeSignedIn(): boolean {
  return readBoolPref(FAKE_SIGNED_IN_STORAGE_KEY, false)
}

/** Persist the fake-sign-in state. Best-effort, like the prefs above. */
export function writeStoredFakeSignedIn(on: boolean): void {
  writeBoolPref(FAKE_SIGNED_IN_STORAGE_KEY, on)
}
