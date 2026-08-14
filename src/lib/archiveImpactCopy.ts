import type { ArchiveImpact } from "@capacitylens/shared/domain/lifecycle";
import { m } from "@/i18n";

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

export function clientArchiveImpactCopy({ projects, phases, allocations }: ArchiveImpact): string {
  return m.list_clients_archive_cascade({
    projects: projectCount(projects),
    phases: phaseCount(phases),
    allocations: allocationCount(allocations),
  });
}

export function projectArchiveImpactCopy({ phases, allocations }: ArchiveImpact): string {
  return m.list_projects_archive_cascade({
    phases: phaseCount(phases),
    allocations: allocationCount(allocations),
  });
}
