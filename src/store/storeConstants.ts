import {
  deleteActivityCascade,
  deleteClientCascade,
  deleteProjectCascade,
  deleteResourceCascade,
} from "@capacitylens/shared/lib/integrity";
import type { AppData, ID, ISODate } from "@capacitylens/shared/types/entities";
import { buildEmptyFilters, type LifecycleEntity, type SchedulerUI } from "./types";
import { readNextDataRevision } from "./revisions";

/** How each tombstone table is physically removed at the END of the lifecycle (purgeEntity): the
 *  row AND its children go together, via the SAME cascades the regular delete* actions use
 *  (single-sourced from shared/lib/integrity.ts — no drift). The resource cascade re-stamps
 *  nothing, so it alone needs no fresh revision. */
export const PURGE_CASCADES: Record<LifecycleEntity, (data: AppData, id: ID) => AppData> = {
  resources: (data, id) => deleteResourceCascade(data, id),
  clients: (data, id) => deleteClientCascade(data, id, readNextDataRevision(data)),
  projects: (data, id) => deleteProjectCascade(data, id, readNextDataRevision(data)),
  activities: (data, id) => deleteActivityCascade(data, id),
};

// --- Tenant-boundary resets ----------------------------------------------------------------------
// Deleting, switching, publishing a slice without the active tenant, or importing over one all cross
// a tenant boundary, and none of them may carry the LEAVING account's transient session state or
// scheduler view into what is shown next. The field sets live here ONCE so a boundary can't quietly
// forget one; each site keeps only what is specific to it (which notice, whether the week is
// re-anchored, which filters survive).

/** Every transient, tenant-owned session field, cleared. `notice` is deliberately NOT included:
 *  each boundary has its own message (or none). */
export const buildClearedSession = () => ({
  srAnnouncement: null,
  dirtyForm: false,
  dirtyFormSources: new Set<symbol>(),
  draggingAllocationId: null,
});

/** The scheduler view blanked for the incoming tenant. Pass an `anchor` ({@link readCurrentWeekAnchor}) to ALSO
 *  open on that account's current week; omit it where the week in view must be preserved. */
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
