import {
  deleteActivityCascade,
  deleteClientCascade,
  deleteProjectCascade,
  deleteResourceCascade,
} from "@capacitylens/shared/lib/integrity";
import type { AppData, ID, ISODate } from "@capacitylens/shared/types/entities";
import { buildEmptyFilters } from "./types";
import type { LifecycleEntity, SchedulerUI } from "./types";
import { readNextDataRevision } from "./revisions";

/** How each tombstone table is physically removed at the end of the lifecycle (purgeEntity): the
 * row and its children go together, via the same cascades the regular delete* actions use
 * (single-sourced from shared/lib/integrity.ts, no drift). The resource cascade re-stamps
 * nothing, so it alone needs no fresh revision. */
export const PURGE_CASCADES: Record<LifecycleEntity, (data: AppData, id: ID) => AppData> = {
  resources: (data, id) => deleteResourceCascade(data, id),
  clients: (data, id) => deleteClientCascade(data, id, readNextDataRevision(data)),
  projects: (data, id) => deleteProjectCascade(data, id, readNextDataRevision(data)),
  activities: (data, id) => deleteActivityCascade(data, id),
};

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
