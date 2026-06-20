import { externalCapacityDefaults } from '../types/entities'
import { NEUTRAL_COLOR } from '../lib/color'
import type { AppData } from '../types/entities'

// Two demo companies, loaded on first run so the account picker isn't empty.
// "Studio North" is the rich dataset (stacked/overlapping allocations, an
// over-allocated day, a limited-days freelancer, a project-bound placeholder, a
// block of time off). "Loft Digital" is a small second tenant — enough to prove
// switching companies swaps the whole dataset. Every scoped entity carries an
// `accountId`; the store filters on it everywhere.

const TS = '2026-05-01T00:00:00.000Z'

const STUDIO = 'a-studio'
const LOFT = 'a-loft'

export function seed(): AppData {
  return {
    accounts: [
      { id: STUDIO, createdAt: TS, updatedAt: TS, name: 'Studio North', color: '#6366f1' },
      { id: LOFT, createdAt: TS, updatedAt: TS, name: 'Loft Digital', color: '#0ea5e9' },
    ],
    disciplines: [
      { id: 'd-design', accountId: STUDIO, createdAt: TS, updatedAt: TS, name: 'Design', color: '#6366f1', sortOrder: 0 },
      { id: 'd-dev', accountId: STUDIO, createdAt: TS, updatedAt: TS, name: 'Development', color: '#10b981', sortOrder: 1 },
      { id: 'd-copy', accountId: STUDIO, createdAt: TS, updatedAt: TS, name: 'Copywriting', color: '#f59e0b', sortOrder: 2 },
      { id: 'd-loft-design', accountId: LOFT, createdAt: TS, updatedAt: TS, name: 'Design', color: '#0ea5e9', sortOrder: 0 },
    ],
    resources: [
      { id: 'r-tyler', accountId: STUDIO, createdAt: TS, updatedAt: TS, kind: 'person', name: 'Tyler Nix', role: 'Designer', disciplineId: 'd-design', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#6366f1' },
      { id: 'r-pam', accountId: STUDIO, createdAt: TS, updatedAt: TS, kind: 'person', name: 'Pam Gonzalez', role: 'PR & Brand', disciplineId: 'd-copy', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#f59e0b' },
      { id: 'r-nike', accountId: STUDIO, createdAt: TS, updatedAt: TS, kind: 'person', name: 'Nike Spiros', role: 'Web Developer', disciplineId: 'd-dev', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#10b981' },
      { id: 'r-alex', accountId: STUDIO, createdAt: TS, updatedAt: TS, kind: 'person', name: 'Alex Rivera', role: 'Front End (freelance)', disciplineId: 'd-dev', employmentType: 'freelancer', workingHoursPerDay: 8, workingDays: [1, 2, 3], color: '#0ea5e9' },
      { id: 'r-ph-designer', accountId: STUDIO, createdAt: TS, updatedAt: TS, kind: 'placeholder', role: 'Senior Designer', disciplineId: 'd-design', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#a855f7', projectId: 'p-acme' },
      // External / 3rd-party partner studio: assignable to activities but has NO capacity/utilisation —
      // renders neutral in its own band at the bottom of the schedule (see ResourceKind). Its
      // working hours/days are unused silent defaults.
      { id: 'r-ext-dogeatcog', accountId: STUDIO, createdAt: TS, updatedAt: TS, kind: 'external', name: 'Dog Eat Cog', role: 'Partner studio', ...externalCapacityDefaults(), color: NEUTRAL_COLOR },
      { id: 'r-jo', accountId: LOFT, createdAt: TS, updatedAt: TS, kind: 'person', name: 'Jo Mensah', role: 'Product Designer', disciplineId: 'd-loft-design', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#0ea5e9' },
    ],
    clients: [
      { id: 'c-acme', accountId: STUDIO, createdAt: TS, updatedAt: TS, name: 'Acme Inc.', color: '#ef4444' },
      { id: 'c-globex', accountId: STUDIO, createdAt: TS, updatedAt: TS, name: 'Globex', color: '#3b82f6' },
      { id: 'c-loft-northwind', accountId: LOFT, createdAt: TS, updatedAt: TS, name: 'Northwind', color: '#14b8a6' },
    ],
    projects: [
      { id: 'p-acme', accountId: STUDIO, createdAt: TS, updatedAt: TS, name: 'Project Lightning', clientId: 'c-acme', color: '#ec4899' },
      { id: 'p-brand', accountId: STUDIO, createdAt: TS, updatedAt: TS, name: 'Brand Themes', clientId: 'c-globex', color: '#14b8a6' },
      { id: 'p-loft-app', accountId: LOFT, createdAt: TS, updatedAt: TS, name: 'Mobile App', clientId: 'c-loft-northwind', color: '#0ea5e9' },
    ],
    phases: [
      { id: 'ph-disc', accountId: STUDIO, createdAt: TS, updatedAt: TS, name: 'Discovery', projectId: 'p-acme' },
      { id: 'ph-build', accountId: STUDIO, createdAt: TS, updatedAt: TS, name: 'Build', projectId: 'p-acme' },
    ],
    activities: [
      { id: 't-wires', accountId: STUDIO, createdAt: TS, updatedAt: TS, name: 'Wireframes', kind: 'project', projectId: 'p-acme', phaseId: 'ph-disc' },
      { id: 't-visual', accountId: STUDIO, createdAt: TS, updatedAt: TS, name: 'Visual Design', kind: 'project', projectId: 'p-acme', phaseId: 'ph-build' },
      { id: 't-cms', accountId: STUDIO, createdAt: TS, updatedAt: TS, name: 'CMS Review', kind: 'project', projectId: 'p-acme' },
      { id: 't-brand', accountId: STUDIO, createdAt: TS, updatedAt: TS, name: 'Brand System', kind: 'project', projectId: 'p-brand' },
      // Internal (no-project) activity — internal work, allocatable to anyone.
      { id: 't-admin', accountId: STUDIO, createdAt: TS, updatedAt: TS, name: 'Admin / Internal', kind: 'internal' },
      // Repeatable (no-project) activities — reusable across any project; the schedule's activity lens
      // groups them so you can see "all design" / "all workshops" regardless of project.
      { id: 't-design', accountId: STUDIO, createdAt: TS, updatedAt: TS, name: 'Design', kind: 'repeatable' },
      { id: 't-workshop', accountId: STUDIO, createdAt: TS, updatedAt: TS, name: 'Workshop', kind: 'repeatable' },
      { id: 't-loft-screens', accountId: LOFT, createdAt: TS, updatedAt: TS, name: 'App Screens', kind: 'project', projectId: 'p-loft-app' },
    ],
    allocations: [
      // Tyler: two overlapping bars on 06-03/06-04 -> stacks + over-allocated (8 + 4 > 8).
      { id: 'a-tyler-1', accountId: STUDIO, createdAt: TS, updatedAt: TS, resourceId: 'r-tyler', activityId: 't-wires', startDate: '2026-06-01', endDate: '2026-06-04', hoursPerDay: 8, status: 'confirmed' },
      { id: 'a-tyler-2', accountId: STUDIO, createdAt: TS, updatedAt: TS, resourceId: 'r-tyler', activityId: 't-visual', startDate: '2026-06-03', endDate: '2026-06-08', hoursPerDay: 4, status: 'tentative' },
      { id: 'a-nike-1', accountId: STUDIO, createdAt: TS, updatedAt: TS, resourceId: 'r-nike', activityId: 't-cms', startDate: '2026-06-01', endDate: '2026-06-05', hoursPerDay: 8, status: 'confirmed' },
      { id: 'a-alex-1', accountId: STUDIO, createdAt: TS, updatedAt: TS, resourceId: 'r-alex', activityId: 't-cms', startDate: '2026-06-01', endDate: '2026-06-03', hoursPerDay: 8, status: 'confirmed' },
      { id: 'a-ph-1', accountId: STUDIO, createdAt: TS, updatedAt: TS, resourceId: 'r-ph-designer', activityId: 't-visual', startDate: '2026-06-02', endDate: '2026-06-05', hoursPerDay: 8, status: 'confirmed' },
      // External partner studio booked on Acme's visual design — a span only, no hours (hoursPerDay 0).
      { id: 'a-ext-1', accountId: STUDIO, createdAt: TS, updatedAt: TS, resourceId: 'r-ext-dogeatcog', activityId: 't-visual', startDate: '2026-06-02', endDate: '2026-06-09', hoursPerDay: 0, status: 'confirmed', ignoreWeekends: true },
      { id: 'a-pam-1', accountId: STUDIO, createdAt: TS, updatedAt: TS, resourceId: 'r-pam', activityId: 't-brand', startDate: '2026-06-01', endDate: '2026-06-09', hoursPerDay: 6, status: 'confirmed' },
      // A repeatable activity ("Design") booked across a project boundary — demonstrates the
      // schedule's activity lens ("all design work", regardless of project/client).
      { id: 'a-alex-design', accountId: STUDIO, createdAt: TS, updatedAt: TS, resourceId: 'r-alex', activityId: 't-design', startDate: '2026-06-08', endDate: '2026-06-10', hoursPerDay: 8, status: 'confirmed' },
      { id: 'a-jo-1', accountId: LOFT, createdAt: TS, updatedAt: TS, resourceId: 'r-jo', activityId: 't-loft-screens', startDate: '2026-06-01', endDate: '2026-06-05', hoursPerDay: 8, status: 'confirmed' },
    ],
    timeOff: [
      { id: 'to-tyler', accountId: STUDIO, createdAt: TS, updatedAt: TS, resourceId: 'r-tyler', startDate: '2026-06-10', endDate: '2026-06-12', type: 'holiday', note: 'Long weekend' },
    ],
  }
}
