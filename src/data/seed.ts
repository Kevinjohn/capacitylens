import type { AppData } from '../types/entities'

// A small but representative agency dataset, loaded on first run so the
// scheduler isn't empty. Deliberately includes: stacked overlapping allocations,
// an over-allocated day, a freelancer with limited working days, a placeholder
// bound to a project, and a block of time off.

const TS = '2026-05-01T00:00:00.000Z'

export function seed(): AppData {
  return {
    disciplines: [
      { id: 'd-design', createdAt: TS, updatedAt: TS, name: 'Design', color: '#6366f1', sortOrder: 0 },
      { id: 'd-dev', createdAt: TS, updatedAt: TS, name: 'Development', color: '#10b981', sortOrder: 1 },
      { id: 'd-copy', createdAt: TS, updatedAt: TS, name: 'Copywriting', color: '#f59e0b', sortOrder: 2 },
    ],
    resources: [
      { id: 'r-tyler', createdAt: TS, updatedAt: TS, kind: 'person', name: 'Tyler Nix', role: 'Designer', disciplineId: 'd-design', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#6366f1' },
      { id: 'r-pam', createdAt: TS, updatedAt: TS, kind: 'person', name: 'Pam Gonzalez', role: 'PR & Brand', disciplineId: 'd-copy', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#f59e0b' },
      { id: 'r-nike', createdAt: TS, updatedAt: TS, kind: 'person', name: 'Nike Spiros', role: 'Web Developer', disciplineId: 'd-dev', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#10b981' },
      { id: 'r-alex', createdAt: TS, updatedAt: TS, kind: 'person', name: 'Alex Rivera', role: 'Front End (freelance)', disciplineId: 'd-dev', employmentType: 'freelancer', workingHoursPerDay: 8, workingDays: [1, 2, 3], color: '#0ea5e9' },
      { id: 'r-ph-designer', createdAt: TS, updatedAt: TS, kind: 'placeholder', role: 'Senior Designer', disciplineId: 'd-design', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#a855f7', projectId: 'p-acme' },
    ],
    clients: [
      { id: 'c-acme', createdAt: TS, updatedAt: TS, name: 'Acme Inc.', color: '#ef4444' },
      { id: 'c-globex', createdAt: TS, updatedAt: TS, name: 'Globex', color: '#3b82f6' },
    ],
    projects: [
      { id: 'p-acme', createdAt: TS, updatedAt: TS, name: 'Project Lightning', clientId: 'c-acme', color: '#ec4899' },
      { id: 'p-brand', createdAt: TS, updatedAt: TS, name: 'Brand Themes', clientId: 'c-globex', color: '#14b8a6' },
    ],
    phases: [
      { id: 'ph-disc', createdAt: TS, updatedAt: TS, name: 'Discovery', projectId: 'p-acme' },
      { id: 'ph-build', createdAt: TS, updatedAt: TS, name: 'Build', projectId: 'p-acme' },
    ],
    tasks: [
      { id: 't-wires', createdAt: TS, updatedAt: TS, name: 'Wireframes', projectId: 'p-acme', phaseId: 'ph-disc' },
      { id: 't-visual', createdAt: TS, updatedAt: TS, name: 'Visual Design', projectId: 'p-acme', phaseId: 'ph-build' },
      { id: 't-cms', createdAt: TS, updatedAt: TS, name: 'CMS Review', projectId: 'p-acme' },
      { id: 't-brand', createdAt: TS, updatedAt: TS, name: 'Brand System', projectId: 'p-brand' },
    ],
    allocations: [
      // Tyler: two overlapping bars on 06-03/06-04 -> stacks + over-allocated (8 + 4 > 8).
      { id: 'a-tyler-1', createdAt: TS, updatedAt: TS, resourceId: 'r-tyler', taskId: 't-wires', startDate: '2026-06-01', endDate: '2026-06-04', hoursPerDay: 8, status: 'confirmed' },
      { id: 'a-tyler-2', createdAt: TS, updatedAt: TS, resourceId: 'r-tyler', taskId: 't-visual', startDate: '2026-06-03', endDate: '2026-06-08', hoursPerDay: 4, status: 'tentative' },
      { id: 'a-nike-1', createdAt: TS, updatedAt: TS, resourceId: 'r-nike', taskId: 't-cms', startDate: '2026-06-01', endDate: '2026-06-05', hoursPerDay: 8, status: 'confirmed' },
      { id: 'a-alex-1', createdAt: TS, updatedAt: TS, resourceId: 'r-alex', taskId: 't-cms', startDate: '2026-06-01', endDate: '2026-06-03', hoursPerDay: 8, status: 'confirmed' },
      { id: 'a-ph-1', createdAt: TS, updatedAt: TS, resourceId: 'r-ph-designer', taskId: 't-visual', startDate: '2026-06-02', endDate: '2026-06-05', hoursPerDay: 8, status: 'confirmed' },
      { id: 'a-pam-1', createdAt: TS, updatedAt: TS, resourceId: 'r-pam', taskId: 't-brand', startDate: '2026-06-01', endDate: '2026-06-09', hoursPerDay: 6, status: 'confirmed' },
    ],
    timeOff: [
      { id: 'to-tyler', createdAt: TS, updatedAt: TS, resourceId: 'r-tyler', startDate: '2026-06-10', endDate: '2026-06-12', type: 'holiday', note: 'Long weekend' },
    ],
  }
}
