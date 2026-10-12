// Device preferences use separate storage from tenant data. Failed reads use each documented default, and failed writes retain the current session choice.

// All keys below carry the shared brand prefix (defined once in shared/src/brand.ts) so clearing /
// migrating by prefix catches every one of them.
import { STORAGE_KEY_PREFIX } from "@capacitylens/shared/brand";

interface ReadBooleanPreferenceInput {
  key: string;
  fallback: boolean;
}

interface WriteBooleanPreferenceInput {
  key: string;
  on: boolean;
}

interface CreateBooleanPreferenceInput {
  key: string;
  fallback: boolean;
}

interface WriteStoredSidebarOpenInput {
  open: boolean;
}

// Boolean records read only declared fields so legacy or unknown preference keys
// cannot widen the shape. Sidebar choice remains tri-state to preserve first-run defaults.

function readBooleanPreference({ key, fallback }: ReadBooleanPreferenceInput): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === "on") return true;
    if (raw === "off") return false;
  } catch {
    // This device preference may use its default when browser storage or APIs are unavailable.
  }
  return fallback;
}

function writeBooleanPreference({ key, on }: WriteBooleanPreferenceInput): void {
  try {
    localStorage.setItem(key, on ? "on" : "off");
  } catch {
    // A failed device-preference write loses only this browser choice; the session keeps its in-memory value.
  }
}

function mergeBooleanRecord<T extends Record<keyof T, boolean>>(defaults: T, parsed: Partial<T>): T {
  const merged = { ...defaults };
  for (const field of Object.keys(defaults) as (keyof T)[]) {
    const value = parsed[field];
    if (typeof value === "boolean") merged[field] = value as T[keyof T];
  }
  return merged;
}

// Read only declared preference fields so legacy or unknown keys cannot widen the
// runtime shape; unavailable or malformed storage keeps the documented defaults.
function readBooleanRecordPreference<T extends Record<keyof T, boolean>>(key: string, defaults: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<T>;
      return mergeBooleanRecord(defaults, parsed);
    }
  } catch {
    // This device preference may use its default when browser storage or APIs are unavailable.
  }
  return { ...defaults };
}

function writeBooleanRecordPreference<T extends Record<keyof T, boolean>>(key: string, preferences: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(preferences));
  } catch {
    // A failed device-preference write loses only this browser choice; the session keeps its in-memory value.
  }
}

function createBooleanPreference({
  key,
  fallback,
}: CreateBooleanPreferenceInput): [read: () => boolean, write: (on: boolean) => void] {
  const storageKey = `${STORAGE_KEY_PREFIX}${key}`;
  return [
    () => readBooleanPreference({ key: storageKey, fallback: fallback }),
    (on: boolean) => writeBooleanPreference({ key: storageKey, on: on }),
  ];
}

/** Visibility preferences for utilisation summaries. */
export interface UtilizationPreferences {
  /** Show the account-wide utilisation summary. */
  showTotal: boolean;
  /** Show per-discipline utilisation. */
  showDiscipline: boolean;
  /** Show per-person (per-resource) utilisation. */
  showPersonal: boolean;
}

/** Default visibility for utilisation summaries. */
export const DEFAULT_UTILIZATION_PREFS: UtilizationPreferences = {
  showTotal: true,
  showDiscipline: true,
  showPersonal: true,
};

const STORAGE_KEY = `${STORAGE_KEY_PREFIX}utilizationPrefs`;

/** Read the saved preferences, falling back to the defaults for anything missing
 * or when storage is unavailable. Tolerant of partial/legacy stored shapes. */
export function readStoredUtilizationPrefs(): UtilizationPreferences {
  return readBooleanRecordPreference(STORAGE_KEY, DEFAULT_UTILIZATION_PREFS);
}

/** Persist the preferences. Best-effort: if storage is unavailable the in-memory
 * store still honours the choice for this session. */
export function writeStoredUtilizationPrefs(preferences: UtilizationPreferences): void {
  writeBooleanRecordPreference(STORAGE_KEY, preferences);
}

/** Visibility preferences for allocation bar labels. */
export interface BarLabelPreferences {
  /** Prefix the allocation bar's label with the client name. */
  showClient: boolean;
  /** Prefix the allocation bar's label with the project name. */
  showProject: boolean;
}

/** Default allocation bar label visibility. */
export const DEFAULT_BAR_LABEL_PREFS: BarLabelPreferences = {
  showClient: true,
  showProject: true,
};

const BAR_LABEL_STORAGE_KEY = `${STORAGE_KEY_PREFIX}barLabelPrefs`;

/** Read the saved bar-label preferences, same tolerant fallback behaviour as
 * readStoredUtilizationPrefs. */
export function readStoredBarLabelPrefs(): BarLabelPreferences {
  return readBooleanRecordPreference(BAR_LABEL_STORAGE_KEY, DEFAULT_BAR_LABEL_PREFS);
}

/** Persist the bar-label preferences. Best-effort, like writeStoredUtilizationPrefs. */
export function writeStoredBarLabelPrefs(preferences: BarLabelPreferences): void {
  writeBooleanRecordPreference(BAR_LABEL_STORAGE_KEY, preferences);
}

// Sidebar open/collapsed. Device-global like the prefs above, but tri-state on
// read: null means "the user has never chosen", and the caller falls back to the
// viewport-derived default below instead of a fixed boolean.

const SIDEBAR_STORAGE_KEY = `${STORAGE_KEY_PREFIX}sidebar`;

/** The widest viewport still treated as a phone. Single-sourced here because two separate
 * breakpoint consumers key off it: the sidebar's first-run default below and the
 * `useIsMobile` hook (hooks/useIsMobile.ts). */
export const PHONE_MAX_WIDTH_PX = 767;

// First-run navigation collapses on small or short landscape viewports to preserve schedule space; this is separate from the mobile-sheet breakpoint.
const SMALL_VIEWPORT_QUERY = `(max-width: 1023px), (max-height: 480px)`;

/** The user's explicit sidebar choice, or null if they've never toggled it. */
export function readStoredSidebarOpen(): boolean | null {
  try {
    const raw = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (raw === "open") return true;
    if (raw === "closed") return false;
  } catch {
    // This device preference may use its default when browser storage or APIs are unavailable.
  }
  return null;
}

/** Persist the sidebar choice. Best-effort, like the prefs above. */
export function writeStoredSidebarOpen({ open }: WriteStoredSidebarOpenInput): void {
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, open ? "open" : "closed");
  } catch {
    // A failed device-preference write loses only this browser choice; the session keeps its in-memory value.
  }
}

/** First-run default: open on desktop, collapsed on small screens. Guarded for
 * non-browser environments (jsdom has no matchMedia) where it defaults open. */
export function readDefaultSidebarOpen(): boolean {
  try {
    if (typeof window.matchMedia === "function") {
      return !window.matchMedia(SMALL_VIEWPORT_QUERY).matches;
    }
  } catch {
    // This device preference may use its default when browser storage or APIs are unavailable.
  }
  return true;
}

// Minimise weekend columns by default to preserve schedule width. This is a device preference.
/** Reads and writes the browser preference for minimising weekend columns. */
export const [readStoredMinimiseWeekends, writeStoredMinimiseWeekends] = createBooleanPreference({
  key: "minimiseWeekends",
  fallback: true,
});

// Week snap: after a free horizontal scroll settles, the schedule floors its left edge back to the
// current week's first day, so a stray scroll can't leave the view on a mid-week day. Always on for
// users, with no Settings control. The storage key remains only as a test override: browser tests
// store "off" to hold a mid-week position across the idle re-floor (see e2e/browserTestSupport.ts).
// Governs free scroll only; the navigation snap (zoom / Prev-Next / date-picker) is always on.
/** Storage key for the browser-test week-snap override. */
export const WEEK_SNAP_OVERRIDE_KEY = "snapToWeekStart";
/** Reads the optional browser-test override for snapping to week starts. */
export const [readStoredWeekSnapOverride] = createBooleanPreference({ key: WEEK_SNAP_OVERRIDE_KEY, fallback: true });

// "Fake sign-in": a cosmetic demo gate shown before the account picker so a viewer sees a
// "log in first, then pick a company" flow. Device-global like the prefs above (own key,
// on/off string, not account data) and defaults off so the demo sign-in shows on first run.
// This is not real auth. The real, server-authoritative seam is `src/auth/`. The flag is
// flipped on by the demo sign-in screen and cleared by "Sign out". See
// `src/components/FakeSignIn.tsx` and DECISIONS.md.
/** Reads and writes the development-only fake sign-in preference. */
export const [readStoredFakeSignedIn, writeStoredFakeSignedIn] = createBooleanPreference({
  key: "fakeSignedIn",
  fallback: false,
});
