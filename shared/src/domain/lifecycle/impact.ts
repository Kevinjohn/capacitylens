import type { AppData, ISOTimestamp } from "../../types/entities";
import { lifecycleStatus, type LifecycleEntityKey, type LifecycleFields } from "./types";
import { activeOnly } from "./projection";
import { LifecycleTransitionError } from "./transitions";

/**
 * Per-table counts of currently-ACTIVE descendants that archiving ONE entity would additionally HIDE
 * from the {@link activeOnly} view projection — NOT counting the entity itself. Feeds the
 * archive-confirmation warning ("this also hides N projects and M allocations").
 */
export interface ArchiveImpact {
  /** Active projects hidden — non-zero only when archiving a CLIENT. */
  projects: number;
  /** Active phases hidden beneath an archived client or project. */
  phases: number;
  /** Active project-activities hidden. */
  activities: number;
  /** Active allocation bars hidden. */
  allocations: number;
  /** Active time-off entries hidden — non-zero only when archiving a RESOURCE. */
  timeOff: number;
}

// A valid sentinel `archivedAt` used only to MEASURE the cascade (never persisted), so this flips
// the target row to 'archived' for the diff under the same strict timestamp rule as real rows.
const ARCHIVE_IMPACT_SENTINEL = "2000-01-01T00:00:00.000Z" as ISOTimestamp;

/**
 * Count what archiving one active `resource`/`client`/`project` would ADDITIONALLY hide from the
 * normal view, so the UI can warn before a cascade archive. PURE.
 *
 * Computed by DIFFING {@link activeOnly} before vs after flipping the target row to archived, so the
 * counts can NEVER drift from the real view-projection rule (extend the cascade in activeOnly and
 * this follows for free). The entity's OWN row is excluded per type: a client's own row lives in
 * `clients`; a project has no descendant projects; a resource no descendant resources — so `projects`
 * is reported only for a client and `timeOff` only for a resource.
 *
 * @param data   account-scoped AppData to measure against — pass the ACTIVE projection, since the
 *               counts are of currently-VISIBLE descendants that would disappear.
 * @param entity which lifecycle table the archived row lives in.
 * @param id     the row being archived; throws when it is missing or not active.
 */
export function archiveImpact(data: AppData, entity: LifecycleEntityKey, id: string): ArchiveImpact {
  const target = data[entity].find((row) => row.id === id);
  if (!target) {
    throw new LifecycleTransitionError(
      "invalid_transition",
      `Cannot measure archive impact: ${entity}.${id} is missing.`,
    );
  }
  const targetState = lifecycleStatus(target);
  if (targetState !== "active") {
    throw new LifecycleTransitionError(
      "already_inactive",
      `Cannot measure archive impact: ${entity}.${id} is ${targetState}, not active.`,
    );
  }
  const flip = <T extends LifecycleFields & { id: string }>(rows: readonly T[]): T[] =>
    rows.map((row) => (row.id === id ? { ...row, archivedAt: ARCHIVE_IMPACT_SENTINEL } : row));
  const archived: AppData = {
    ...data,
    resources: entity === "resources" ? flip(data.resources) : data.resources,
    clients: entity === "clients" ? flip(data.clients) : data.clients,
    projects: entity === "projects" ? flip(data.projects) : data.projects,
  };
  const before = activeOnly(data);
  const after = activeOnly(archived);
  const hidden = (key: "projects" | "phases" | "activities" | "allocations" | "timeOff"): number =>
    before[key].length - after[key].length;
  return {
    projects: entity === "clients" ? hidden("projects") : 0,
    phases: hidden("phases"),
    activities: hidden("activities"),
    allocations: hidden("allocations"),
    timeOff: entity === "resources" ? hidden("timeOff") : 0,
  };
}
