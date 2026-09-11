import {
  archiveImpact,
  canArchive,
  type ArchiveImpact,
  type LifecycleEntityKey,
} from "@capacitylens/shared/domain/lifecycle";
import type { AppData } from "@capacitylens/shared/types/entities";
import { m } from "@/i18n";

/**
 * `archiveImpact` THROWS when its target row is missing or already inactive — a real possibility at
 * render time, not just at call time: the archive-confirm dialog holds the row it opened with, and
 * that row can stop being active in `data` before the user confirms (a teammate archives it, a
 * sync/reload lands, an undo restores an earlier tree, the active account changes). The three
 * archive-message builders (client/project/activity) all call this INSTEAD of `archiveImpact`
 * directly so every dialog tolerates that race the same way: `undefined` means "render the base
 * message, no cascade sentence" — never a thrown error, and never a zero-count sentence.
 *
 * Re-checks against the CURRENT row in `data` (not a possibly-stale `confirming` object a caller
 * might hold) using the same `canArchive` affordance predicate `archiveImpact`'s own precondition
 * is built on, so this can never disagree with when `archiveImpact` would throw.
 */
export function safeArchiveImpact(data: AppData, entity: LifecycleEntityKey, id: string): ArchiveImpact | undefined {
  const row = data[entity].find((candidate) => candidate.id === id);
  return row && canArchive(row) ? archiveImpact(data, entity, id) : undefined;
}

/** Pick the one/other form for a count. `one` and `other` are UNCALLED message references, invoked
 *  here at lookup time so Paraglide resolves the active locale on each render rather than freezing
 *  it at import. English-only pluralisation (1 vs everything else) matches the message catalogue's
 *  current plural forms; a locale with more categories would need Paraglide's own plural selector. */
const plural =
  (one: (inputs: { count: number }) => string, other: (inputs: { count: number }) => string) =>
  (count: number): string =>
    count === 1 ? one({ count }) : other({ count });

const projectCount = plural(m.list_archive_project_one, m.list_archive_project_other);
const phaseCount = plural(m.list_archive_phase_one, m.list_archive_phase_other);
const allocationCount = plural(m.list_archive_allocation_one, m.list_archive_allocation_other);

export function buildClientArchiveImpactCopy({ projects, phases, allocations }: ArchiveImpact): string {
  return m.list_clients_archive_cascade({
    projects: projectCount(projects),
    phases: phaseCount(phases),
    allocations: allocationCount(allocations),
  });
}

export function buildProjectArchiveImpactCopy({ phases, allocations }: ArchiveImpact): string {
  return m.list_projects_archive_cascade({
    phases: phaseCount(phases),
    allocations: allocationCount(allocations),
  });
}

export function buildActivityArchiveImpactCopy({ allocations }: ArchiveImpact): string {
  return m.list_activities_archive_cascade({
    allocations: allocationCount(allocations),
  });
}
