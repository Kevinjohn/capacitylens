// Display preferences. Device-global (one set of choices per browser), stored
// separately from account data — same rationale as the theme preference
// (see theme.ts / DECISIONS.md): these are view toggles, not tenant records.
//
// The store holds the reactive values; these are the pure read/write helpers it
// leans on. Everything defaults to true (show everything) on first run.

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
    // ignore — see readStoredUtilizationPrefs
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
    // ignore — see readStoredUtilizationPrefs
  }
}
