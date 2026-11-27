import { ActivityFactory } from '#database/factories/activity_factory'
import { AllocationFactory } from '#database/factories/allocation_factory'
import { ClientFactory } from '#database/factories/client_factory'
import { ClosureFactory } from '#database/factories/closure_factory'
import { DisciplineFactory } from '#database/factories/discipline_factory'
import { PhaseFactory } from '#database/factories/phase_factory'
import { ProjectFactory } from '#database/factories/project_factory'
import { ResourceFactory } from '#database/factories/resource_factory'
import { TimeOffFactory } from '#database/factories/time_off_factory'

const companyIds = { dc: 'a-studio', marvel: 'a-loft' } as const

export async function insertTwoCompanyFixture() {
  await ClientFactory.merge([
    {
      id: 'm1-dc-client',
      companyId: companyIds.dc,
      name: 'Wayne Enterprises',
      color: '#111111',
    },
    {
      id: 'm1-marvel-client',
      companyId: companyIds.marvel,
      name: 'Stark Industries',
      color: '#222222',
    },
    {
      id: 'm1-dc-client-2',
      companyId: companyIds.dc,
      name: 'Gotham Gazette',
      color: '#333333',
    },
  ]).createMany(3)
  await DisciplineFactory.merge([
    {
      id: 'm1-dc-discipline',
      companyId: companyIds.dc,
      name: 'Bat Family',
      sortOrder: 1,
    },
    {
      id: 'm1-marvel-discipline',
      companyId: companyIds.marvel,
      name: 'Avengers',
      sortOrder: 1,
    },
  ]).createMany(2)
  await ProjectFactory.merge([
    {
      id: 'm1-dc-project',
      companyId: companyIds.dc,
      clientId: 'm1-dc-client',
      name: 'Gotham',
      color: '#111111',
    },
    {
      id: 'm1-dc-project-2',
      companyId: companyIds.dc,
      clientId: 'm1-dc-client-2',
      name: 'Metropolis',
      color: '#333333',
    },
    {
      id: 'm1-marvel-project',
      companyId: companyIds.marvel,
      clientId: 'm1-marvel-client',
      name: 'Stark Tower',
      color: '#222222',
    },
  ]).createMany(3)
  await PhaseFactory.merge([
    {
      id: 'm1-dc-phase',
      companyId: companyIds.dc,
      projectId: 'm1-dc-project',
      name: 'Investigation',
    },
    {
      id: 'm1-dc-phase-2',
      companyId: companyIds.dc,
      projectId: 'm1-dc-project-2',
      name: 'Rebuild',
    },
    {
      id: 'm1-marvel-phase',
      companyId: companyIds.marvel,
      projectId: 'm1-marvel-project',
      name: 'Research',
    },
  ]).createMany(3)
  await ResourceFactory.merge([
    {
      id: 'm1-dc-resource',
      companyId: companyIds.dc,
      kind: 'person',
      name: 'Bruce Wayne',
      jobTitle: 'Designer',
      disciplineId: 'm1-dc-discipline',
      employmentType: 'permanent',
      engagement: 'studio',
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      projectId: 'm1-dc-project',
      color: '#111111',
    },
    {
      id: 'm1-dc-resource-2',
      companyId: companyIds.dc,
      kind: 'person',
      name: 'Clark Kent',
      jobTitle: 'Designer',
      disciplineId: 'm1-dc-discipline',
      employmentType: 'permanent',
      engagement: 'studio',
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      projectId: 'm1-dc-project-2',
      color: '#333333',
    },
    {
      id: 'm1-marvel-resource',
      companyId: companyIds.marvel,
      kind: 'person',
      name: 'Tony Stark',
      jobTitle: 'Designer',
      disciplineId: 'm1-marvel-discipline',
      employmentType: 'permanent',
      engagement: 'studio',
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      projectId: 'm1-marvel-project',
      color: '#222222',
    },
  ]).createMany(3)
  await ActivityFactory.merge([
    {
      id: 'm1-dc-activity',
      companyId: companyIds.dc,
      name: 'Detective work',
      kind: 'project',
      projectId: 'm1-dc-project',
      phaseId: 'm1-dc-phase',
    },
    {
      id: 'm1-dc-activity-2',
      companyId: companyIds.dc,
      name: 'City response',
      kind: 'project',
      projectId: 'm1-dc-project-2',
      phaseId: 'm1-dc-phase-2',
    },
    {
      id: 'm1-dc-unbound-project-activity',
      companyId: companyIds.dc,
      name: 'Coordination',
      kind: 'internal',
      phaseId: 'm1-dc-phase',
    },
    {
      id: 'm1-dc-cross-phase-survivor',
      companyId: companyIds.dc,
      name: 'Joint response',
      kind: 'project',
      projectId: 'm1-dc-project-2',
      phaseId: 'm1-dc-phase',
    },
    {
      id: 'm1-marvel-activity',
      companyId: companyIds.marvel,
      name: 'Arc reactor',
      kind: 'project',
      projectId: 'm1-marvel-project',
      phaseId: 'm1-marvel-phase',
    },
  ]).createMany(5)
  await AllocationFactory.merge([
    {
      id: 'm1-dc-allocation',
      companyId: companyIds.dc,
      resourceId: 'm1-dc-resource',
      activityId: 'm1-dc-activity',
      projectId: 'm1-dc-project',
      startDate: '2026-10-12',
      endDate: '2026-10-16',
      hoursPerDay: 4,
      status: 'confirmed',
    },
    {
      id: 'm1-dc-allocation-survivor',
      companyId: companyIds.dc,
      resourceId: 'm1-dc-resource-2',
      activityId: 'm1-dc-cross-phase-survivor',
      projectId: 'm1-dc-project-2',
      startDate: '2026-10-12',
      endDate: '2026-10-16',
      hoursPerDay: 4,
      status: 'confirmed',
    },
    {
      id: 'm1-marvel-allocation',
      companyId: companyIds.marvel,
      resourceId: 'm1-marvel-resource',
      activityId: 'm1-marvel-activity',
      projectId: 'm1-marvel-project',
      startDate: '2026-10-12',
      endDate: '2026-10-16',
      hoursPerDay: 4,
      status: 'confirmed',
    },
  ]).createMany(3)
  await TimeOffFactory.merge([
    {
      id: 'm1-dc-time-off',
      companyId: companyIds.dc,
      resourceId: 'm1-dc-resource',
      startDate: '2026-10-12',
      endDate: '2026-10-13',
      type: 'holiday',
    },
    {
      id: 'm1-marvel-time-off',
      companyId: companyIds.marvel,
      resourceId: 'm1-marvel-resource',
      startDate: '2026-10-12',
      endDate: '2026-10-13',
      type: 'holiday',
    },
  ]).createMany(2)
  await ClosureFactory.merge({
    id: 'm1-dc-closure',
    companyId: companyIds.dc,
    name: 'Gotham Founders Day',
    startDate: '2026-10-12',
    endDate: '2026-10-12',
  }).create()
  await ClosureFactory.merge({
    id: 'm1-marvel-closure',
    companyId: companyIds.marvel,
    name: 'Stark Expo',
    startDate: '2026-10-12',
    endDate: '2026-10-12',
  }).create()
}
