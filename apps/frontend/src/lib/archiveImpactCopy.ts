import type { ArchiveImpact } from '@capacitylens/shared/domain/lifecycle'
import { m } from '@/i18n'
import { plural } from './pluralCopy'

const projectCount = plural(m.list_archive_project_one, m.list_archive_project_other)
const phaseCount = plural(m.list_archive_phase_one, m.list_archive_phase_other)
const allocationCount = plural(m.list_archive_allocation_one, m.list_archive_allocation_other)

/**
 * Builds the notice shown after the server reports what an archive hid, or `null` when it hid
 * nothing the person would look for: projects, phases or allocations for a client, phases or
 * allocations for a project, allocations for an activity.
 */
export function buildArchiveImpactNotice(
  entity: 'clients' | 'projects' | 'activities',
  { projects, phases, allocations }: ArchiveImpact
): string | null {
  if (entity === 'clients') {
    return projects + phases + allocations > 0
      ? m.list_clients_archive_cascade({
          projects: projectCount(projects),
          phases: phaseCount(phases),
          allocations: allocationCount(allocations),
        })
      : null
  }
  if (entity === 'projects') {
    return phases + allocations > 0
      ? m.list_projects_archive_cascade({
          phases: phaseCount(phases),
          allocations: allocationCount(allocations),
        })
      : null
  }
  return allocations > 0
    ? m.list_activities_archive_cascade({ allocations: allocationCount(allocations) })
    : null
}
