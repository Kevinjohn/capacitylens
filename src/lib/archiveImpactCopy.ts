import type { ArchiveImpact } from "@capacitylens/shared/domain/lifecycle";
import { m } from "@/i18n";

const projectCount = (count: number): string =>
  count === 1 ? m.list_archive_project_one({ count }) : m.list_archive_project_other({ count });
const phaseCount = (count: number): string =>
  count === 1 ? m.list_archive_phase_one({ count }) : m.list_archive_phase_other({ count });
const allocationCount = (count: number): string =>
  count === 1 ? m.list_archive_allocation_one({ count }) : m.list_archive_allocation_other({ count });

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
