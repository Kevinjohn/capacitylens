import { normalizeAccountWorkingDays } from "@capacitylens/shared/lib/accountWorkingDays";
import { DATE_STYLES, DEFAULT_DATE_STYLE } from "@capacitylens/shared/types/entities";
import type { Account, AppData, DateStyle, ID, Weekday } from "@capacitylens/shared/types/entities";
import { DEFAULT_TIME_ZONE } from "@/lib/timezones";

const DEFAULT_CALENDAR_TIME_ZONE = DEFAULT_TIME_ZONE;
/** Monday is the default first day for calendar weeks. */
export const DEFAULT_WEEK_STARTS_ON = 1 as const;

// Missing accounts and missing setting fields must resolve to the same per-setting default.
const createAccountFieldSelector =
  <K extends keyof Account>(key: K, fallback: NonNullable<Account[K]>) =>
  (data: AppData, activeAccountId: ID | null): NonNullable<Account[K]> =>
    data.accounts.find((account) => account.id === activeAccountId)?.[key] ?? fallback;

// Mirror one company date convention into synchronous formatters. Unknown stored
// styles fall back so legacy or hand-edited rows cannot break date rendering; import
// sanitisation removes unsupported styles.
const rawDateStyle = createAccountFieldSelector("dateStyle", DEFAULT_DATE_STYLE);
/** Resolve the date display style for the active account. */
export function resolveDateStyle(data: AppData, activeAccountId: ID | null): DateStyle {
  const stored = rawDateStyle(data, activeAccountId);
  return DATE_STYLES.includes(stored) ? stored : DEFAULT_DATE_STYLE;
}

/** The active company's scheduling input mode. Absent on the account reads as 'hourly'.
 * Shared by the modal and bar. */
export const resolveSchedulingMode = createAccountFieldSelector("schedulingMode", "hourly");

/** Whether the active company uses disciplines; every discipline surface shares this value. */
export const hasDisciplinesEnabled = createAccountFieldSelector("disciplinesEnabled", true);

/** Whether the active company shows placeholders; an absent field defaults to false. */
export const hasPlaceholdersEnabled = createAccountFieldSelector("placeholdersEnabled", false);

/** Whether the active company shows external resources; an absent field defaults to false. */
export const hasExternalResourcesEnabled = createAccountFieldSelector("externalEnabled", false);

/** Whether the Allocation modal offers the inline "Add activity" input + button. Absent reads as
 * false (disabled). Single source so Settings and the modal use the same workspace value. */
export const canCreateInlineActivity = createAccountFieldSelector("inlineActivityCreateEnabled", false);

/** Whether populated allocation task text is shown in schedule details. Absent reads as false. */
export const hasVisibleTaskFieldInSchedule = createAccountFieldSelector("showTaskFieldInSchedule", false);

/** Who may open Overview. Absent reads as the restricted owner/admin default. */
export const resolveCapacityOverviewAccess = createAccountFieldSelector("capacityOverviewAccess", "owner_admin");

/** Reads the active company time zone, defaulting to DEFAULT_CALENDAR_TIME_ZONE when unavailable. */
export const resolveTimeZone = createAccountFieldSelector("timezone", DEFAULT_CALENDAR_TIME_ZONE);

/** Resolve the week start day for the active account. */
export const resolveWeekStart = createAccountFieldSelector("weekStartsOn", DEFAULT_WEEK_STARTS_ON);

/** Account-wide dates on which a schedule creation gesture may start. */
export const listAccountWorkingDays = (data: AppData, activeAccountId: ID | null): Weekday[] => {
  const account = data.accounts.find((candidate) => candidate.id === activeAccountId);
  return normalizeAccountWorkingDays(account?.workingDays, account?.weekStartsOn ?? DEFAULT_WEEK_STARTS_ON);
};
