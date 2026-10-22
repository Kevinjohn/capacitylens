import type { ISODate } from "@capacitylens/shared/types/entities";
import { buildEmptyFilters } from "./types";
import type { SchedulerUI } from "./types";

// Tenant transitions must clear session-owned state so the leaving account cannot
// leak into the next view. Shared reset fields keep each boundary complete.

/** Every transient, tenant-owned session field, cleared. `notice` is deliberately not included:
 * each boundary has its own message (or none). */
export const buildClearedSession = () => ({
  srAnnouncement: null,
  dirtyForm: false,
  dirtyFormSources: new Set<symbol>(),
  draggingAllocationId: null,
});

/** The scheduler view blanked for the incoming tenant. Pass an `anchor` ({@link readCurrentWeekAnchor}) to also
 * open on that account's current week; omit it where the week in view must be preserved. */
export const resetSchedulerView = (
  schedulerUi: SchedulerUI,
  anchor?: { originDate: ISODate; focusDate: ISODate },
): SchedulerUI => ({
  ...schedulerUi,
  filters: buildEmptyFilters(),
  collapsedGroups: [],
  selectedAllocationId: null,
  scrollToResource: null,
  ...anchor,
});
