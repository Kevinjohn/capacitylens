// Display preferences. Device-global (one set of choices per browser), stored
// separately from account data — same rationale as the theme preference
// (see theme.ts / DECISIONS.md): these are view toggles, not tenant records.
//
// The store holds the reactive values; these are the pure read/write helpers it
// leans on. The utilisation and bar-label display toggles default to true (show
// everything) on first run; other prefs in this file carry their own documented
// defaults (the sidebar is tri-state; fake-sign-in and intro-seen default off).
//
// ON THE SWALLOW (deliberate): every localStorage access below is wrapped and falls back to a
// documented default. This is the ONE category where swallow-to-default is correct (see
// DEFENSIVE-CODING.md §5) — these are device-global, NON-TENANT view toggles, so a blocked /
// private-mode / quota / corrupt store can lose a toggle but can NEVER corrupt account data, and
// the in-memory store still honours the choice for the session. Do NOT copy this onto a data path.

// All keys below carry the shared brand prefix (defined once in shared/src/brand.ts) so clearing /
// migrating by prefix catches every one of them.
import { STORAGE_KEY_PREFIX } from "@capacitylens/shared/brand";

// ---------------------------------------------------------------------------
// Shared storage shapes
//
// Two encodings serve every pref in this file: a single boolean stored as the literal string
// 'on'/'off' under its own key (readBoolPref/writeBoolPref), and a small record of booleans
// stored as JSON (readBoolRecordPref/writeBoolRecordPref). The sidebar pref below is deliberately
// NEITHER — it is tri-state ('open'/'closed'/never-chosen). All four helpers share the swallow
// rule from the file header: a blocked/corrupt store loses the toggle but can never touch tenant
// data.
// ---------------------------------------------------------------------------

/** Read an on/off flag stored as 'on'/'off' under `key`; returns `fallback` when unset,
 *  unrecognised, or when storage is unavailable. */
function readBoolPref(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === "on") return true;
    if (raw === "off") return false;
  } catch {
    // storage blocked — fall through to the fallback
  }
  return fallback;
}

/** Persist an on/off flag as 'on'/'off' under `key`. Best-effort, like the prefs above. */
function writeBoolPref(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? "on" : "off");
  } catch {
    // best-effort write — storage blocked/full; deliberate non-tenant swallow (see file header).
  }
}

/** Read a JSON record of booleans under `key`, falling back to `defaults` for anything missing,
 *  non-boolean, or when storage is unavailable. Tolerant of partial/legacy stored shapes: only
 *  the fields declared in `defaults` are read, so an unknown stored key is ignored rather than
 *  widening the returned shape. Always returns a fresh object. */
function readBoolRecordPref<T extends Record<keyof T, boolean>>(key: string, defaults: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<T>;
      const merged = { ...defaults };
      for (const field of Object.keys(defaults) as (keyof T)[]) {
        const value = parsed[field];
        if (typeof value === "boolean") merged[field] = value as T[keyof T];
      }
      return merged;
    }
  } catch {
    // storage blocked or malformed JSON — fall through to the defaults
  }
  return { ...defaults };
}

/** Persist a record of booleans as JSON under `key`. Best-effort, like the prefs above. */
function writeBoolRecordPref<T extends Record<keyof T, boolean>>(key: string, prefs: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(prefs));
  } catch {
    // best-effort write — storage blocked/full; deliberate non-tenant swallow (see file header).
  }
}

/** Declare one on/off flag: returns its `[read, write]` pair over readBoolPref/writeBoolPref,
 *  bound to `${STORAGE_KEY_PREFIX}${key}` and the given default. Keeps each flag below a single
 *  line so the pref's RATIONALE (the comment above it) is the only thing that varies. */
function boolPref(key: string, fallback: boolean): [read: () => boolean, write: (on: boolean) => void] {
  const storageKey = `${STORAGE_KEY_PREFIX}${key}`;
  return [() => readBoolPref(storageKey, fallback), (on: boolean) => writeBoolPref(storageKey, on)];
}

export interface UtilizationPrefs {
  /** Show the account-wide utilisation summary. */
  showTotal: boolean;
  /** Show per-discipline utilisation. */
  showDiscipline: boolean;
  /** Show per-person (per-resource) utilisation. */
  showPersonal: boolean;
}

export const DEFAULT_UTILIZATION_PREFS: UtilizationPrefs = {
  showTotal: true,
  showDiscipline: true,
  showPersonal: true,
};

const STORAGE_KEY = `${STORAGE_KEY_PREFIX}utilizationPrefs`;

/** Read the saved preferences, falling back to the defaults for anything missing
 *  or when storage is unavailable. Tolerant of partial/legacy stored shapes. */
export function readStoredUtilizationPrefs(): UtilizationPrefs {
  return readBoolRecordPref(STORAGE_KEY, DEFAULT_UTILIZATION_PREFS);
}

/** Persist the preferences. Best-effort: if storage is unavailable the in-memory
 *  store still honours the choice for this session. */
export function writeStoredUtilizationPrefs(prefs: UtilizationPrefs): void {
  writeBoolRecordPref(STORAGE_KEY, prefs);
}

export interface BarLabelPrefs {
  /** Prefix the allocation bar's label with the client name. */
  showClient: boolean;
  /** Prefix the allocation bar's label with the project name. */
  showProject: boolean;
}

export const DEFAULT_BAR_LABEL_PREFS: BarLabelPrefs = {
  showClient: true,
  showProject: true,
};

const BAR_LABEL_STORAGE_KEY = `${STORAGE_KEY_PREFIX}barLabelPrefs`;

/** Read the saved bar-label preferences — same tolerant fallback behaviour as
 *  readStoredUtilizationPrefs. */
export function readStoredBarLabelPrefs(): BarLabelPrefs {
  return readBoolRecordPref(BAR_LABEL_STORAGE_KEY, DEFAULT_BAR_LABEL_PREFS);
}

/** Persist the bar-label preferences. Best-effort, like writeStoredUtilizationPrefs. */
export function writeStoredBarLabelPrefs(prefs: BarLabelPrefs): void {
  writeBoolRecordPref(BAR_LABEL_STORAGE_KEY, prefs);
}

// Sidebar open/collapsed. Device-global like the prefs above, but tri-state on
// read: null means "the user has never chosen", and the caller falls back to the
// viewport-derived default below instead of a fixed boolean.

const SIDEBAR_STORAGE_KEY = `${STORAGE_KEY_PREFIX}sidebar`;

/** The widest viewport still treated as a phone. Single-sourced here because two separate
 *  breakpoint consumers key off it: the sidebar's first-run default below and the
 *  `useIsMobile` hook (hooks/use-mobile.ts). */
export const PHONE_MAX_WIDTH_PX = 767;

/** Small-screen query for the sidebar's first-run default. Phone-portrait widths
 *  OR phone-landscape heights count as small — a landscape phone is the app's
 *  recommended orientation and still shouldn't spend 192px on a menu. */
const SMALL_VIEWPORT_QUERY = `(max-width: ${PHONE_MAX_WIDTH_PX}px), (max-height: 480px)`;

/** The user's explicit sidebar choice, or null if they've never toggled it. */
export function readStoredSidebarOpen(): boolean | null {
  try {
    const raw = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (raw === "open") return true;
    if (raw === "closed") return false;
  } catch {
    // storage blocked — fall through to "no choice"
  }
  return null;
}

/** Persist the sidebar choice. Best-effort, like the prefs above. */
export function writeStoredSidebarOpen(open: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, open ? "open" : "closed");
  } catch {
    // best-effort write — storage blocked/full; deliberate non-tenant swallow (see file header).
  }
}

/** First-run default: open on desktop, collapsed on small screens. Guarded for
 *  non-browser environments (jsdom has no matchMedia) where it defaults open. */
export function defaultSidebarOpen(): boolean {
  try {
    if (typeof window.matchMedia === "function") {
      return !window.matchMedia(SMALL_VIEWPORT_QUERY).matches;
    }
  } catch {
    // matchMedia unavailable — treat as a large screen
  }
  return true;
}

// "Minimise weekends": shrink the Saturday/Sunday columns on the schedule to a sliver.
// Device-global like the prefs above (own key, not account data), but DEFAULTS ON — the owner's
// stated default. A plain on/off string (like the sidebar) rather than JSON: it's a single bool.
export const [readStoredMinimiseWeekends, writeStoredMinimiseWeekends] = boolPref("minimiseWeekends", true);

// "Snap to week start": after a FREE horizontal scroll settles, the schedule floors its left edge
// back to the current week's first day. Device-global like the prefs above (own key, not account
// data, NOT in AppData/export), and DEFAULTS ON — keeps the first day of the week pinned to the
// left edge so a stray scroll can't nudge the view onto a mid-week (Tue/Wed) day. Governs FREE
// SCROLL ONLY; the navigation snap (zoom / Prev-Next / date-picker) is always on, independent of
// this flag. A plain on/off string (like minimiseWeekends) — it's a single bool.
export const [readStoredSnapToWeekStart, writeStoredSnapToWeekStart] = boolPref("snapToWeekStart", true);

// "Compact view": the schedule's vertical density. Device-global like the prefs above (own key, not
// account data, NOT in AppData/export) and DEFAULTS OFF, which is the roomier layout — off is the
// density the product ships with, and turning it ON restores the tighter original spacing for people
// who would rather fit more people on screen. A plain on/off string — it's a single bool. The
// geometry it selects lives in components/scheduler/layout.ts (`schedulerDensity`).
export const [readStoredCompactView, writeStoredCompactView] = boolPref("compactView", false);

// "Fake sign-in": a COSMETIC demo gate shown before the account picker so a viewer sees a
// "log in first, then pick a company" flow. Device-global like the prefs above (own key,
// on/off string, NOT account data) and DEFAULTS OFF so the demo sign-in shows on first run.
// This is NOT real auth — the real, server-authoritative seam is `src/auth/`. The flag is
// flipped on by the demo sign-in screen and cleared by "Sign out". See
// `src/components/FakeSignIn.tsx` and DECISIONS.md.
export const [readStoredFakeSignedIn, writeStoredFakeSignedIn] = boolPref("fakeSignedIn", false);

// "Intro seen": whether the post-login "What CapacityLens is" intermediary page has been dismissed on
// this device. Device-global like the prefs above (own key, on/off string, NOT account data) and
// DEFAULTS OFF so the intro shows on first contact, then stays dismissed. Frequency is
// once per device by design (see DECISIONS.md). See
// `src/components/IntroPage.tsx`.
export const [readStoredIntroSeen, writeStoredIntroSeen] = boolPref("introSeen", false);

// "Getting started dismissed": whether the schedule's first-run "Getting started" checklist card
// has been dismissed on this device. Device-global like the prefs above (own key, on/off string,
// NOT account data) and DEFAULTS OFF so the card shows on first contact. The card ALSO self-hides
// (without touching this flag) once the active account has completed every step — the checklist's
// content is derived live from scoped data, only the dismissal is a device pref. See
// `src/components/GettingStarted.tsx`.
export const [readStoredGettingStartedDismissed, writeStoredGettingStartedDismissed] = boolPref(
  "gettingStartedDismissed",
  false,
);
