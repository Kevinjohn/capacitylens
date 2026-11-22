import type { AppData, ISOTimestamp } from '../../types/entities.js';
import { resolveLifecycleStatus } from './types.js';
import type { LifecycleEntityKey, LifecycleFields } from './types.js';
import { buildActiveData } from './projection.js';
import { LifecycleTransitionError } from './transitions.js';

/**
 * Per-table counts of currently-active descendants that archiving one entity would additionally hide
 * from the {@link buildActiveData} view projection, not counting the entity itself. The server reports
 * it in the archive reply, and the browser shows it as a notice after the archive.
 */
export interface ArchiveImpact {
  /** Active projects hidden, non-zero only when archiving a client. */
  projects: number;
  /** Active phases hidden beneath an archived client or project. */
  phases: number;
  /** Active project-activities hidden. */
  activities: number;
  /** Active allocation bars hidden. */
  allocations: number;
  /** Active time-off entries hidden, non-zero only when archiving a resource. */
  timeOff: number;
}

// A valid sentinel `archivedAt` used only to measure the cascade (never persisted), so this flips
// the target row to 'archived' for the diff under the same strict timestamp rule as real rows.
const ARCHIVE_IMPACT_SENTINEL = '2000-01-01T00:00:00.000Z' as ISOTimestamp;

/**
 * Count what archiving one active `resource`/`client`/`project`/`activity` would additionally hide from the
 * normal view, so the UI can warn before a cascade archive. Pure.
 *
 * Computed by diffing {@link buildActiveData} before vs after flipping the target row to archived, so the
 * counts can never drift from the real view-projection rule (extend the cascade in buildActiveData and
 * this follows for free). The entity's own row is excluded per type: a client's own row lives in
 * `clients`; a project has no descendant projects; a resource no descendant resources; an activity's
 * own row is excluded, so `projects` is reported only for a client and `timeOff` only for a resource.
 *
 * @param data   company-scoped AppData with archived rows included; the function applies the active
 * projection itself. An active row under an archived parent is missing from that projection, so
 * passing it already projected throws for such a row.
 * @param entity which lifecycle table the archived row lives in.
 * @param id     the row being archived; throws when it is missing or not active.
 */
export function archiveImpact(
  data: AppData,
  entity: LifecycleEntityKey,
  id: string,
): ArchiveImpact {
  const target = data[entity].find((row) => row.id === id);
  if (!target) {
    throw new LifecycleTransitionError(
      'invalid_transition',
      `Cannot measure archive impact: ${entity}.${id} is missing.`,
    );
  }
  const targetState = resolveLifecycleStatus(target);
  if (targetState !== 'active') {
    throw new LifecycleTransitionError(
      'already_inactive',
      `Cannot measure archive impact: ${entity}.${id} is ${targetState}, not active.`,
    );
  }
  const flip = <T extends LifecycleFields & { id: string }>(rows: readonly T[]): T[] =>
    rows.map((row) => (row.id === id ? { ...row, archivedAt: ARCHIVE_IMPACT_SENTINEL } : row));
  const archived: AppData = {
    ...data,
    resources: entity === 'resources' ? flip(data.resources) : data.resources,
    clients: entity === 'clients' ? flip(data.clients) : data.clients,
    projects: entity === 'projects' ? flip(data.projects) : data.projects,
    activities: entity === 'activities' ? flip(data.activities) : data.activities,
  };
  const before = buildActiveData(data);
  const after = buildActiveData(archived);
  const countHidden = (
    key: 'projects' | 'phases' | 'activities' | 'allocations' | 'timeOff',
  ): number => before[key].length - after[key].length;
  return {
    projects: entity === 'clients' ? countHidden('projects') : 0,
    phases: countHidden('phases'),
    activities: entity === 'activities' ? 0 : countHidden('activities'),
    allocations: countHidden('allocations'),
    timeOff: entity === 'resources' ? countHidden('timeOff') : 0,
  };
}
