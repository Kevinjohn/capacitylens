import { describe, it, expect } from 'vitest'
import { resolveBarColor, type BarColorMaps } from './color'
import type { Allocation, Client, Project, Resource, Activity } from '../types/entities'

// Build the id→entity maps resolveBarColor consumes, from plain arrays.
function maps(over: { activities?: Activity[]; projects?: Project[]; clients?: Client[]; resources?: Resource[] } = {}): BarColorMaps {
  return {
    activities: new Map((over.activities ?? []).map((t) => [t.id, t])),
    projects: new Map((over.projects ?? []).map((p) => [p.id, p])),
    clients: new Map((over.clients ?? []).map((c) => [c.id, c])),
    resources: new Map((over.resources ?? []).map((r) => [r.id, r])),
  }
}

const TS = 't'
const alloc = (resourceId: string, activityId: string): Allocation => ({
  id: 'a', accountId: 'acct', createdAt: TS, updatedAt: TS, resourceId, activityId,
  startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 0, status: 'confirmed',
})
const project = (id: string, color: string): Project => ({ id, accountId: 'acct', createdAt: TS, updatedAt: TS, name: id, clientId: 'c', color })
const activity = (id: string, projectId?: string): Activity => ({ id, accountId: 'acct', createdAt: TS, updatedAt: TS, name: id, kind: 'project', projectId })
const resource = (id: string, kind: Resource['kind']): Resource => ({
  id, accountId: 'acct', createdAt: TS, updatedAt: TS, kind, role: 'R',
  employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#123456',
})

describe('resolveBarColor', () => {
  it("colours a person's bar by its project", () => {
    const m = maps({ activities: [activity('t', 'p')], projects: [project('p', '#abcdef')], resources: [resource('r', 'person')] })
    expect(resolveBarColor(alloc('r', 't'), m)).toBe('#abcdef')
  })

  it('forces an EXTERNAL bar to neutral grey, overriding the project colour', () => {
    // Same project as the person above, but the external short-circuit wins so an outsourced
    // bar never looks like one of our own (DECISIONS.md "external kind": single neutral colour).
    const m = maps({ activities: [activity('t', 'p')], projects: [project('p', '#abcdef')], resources: [resource('ext', 'external')] })
    expect(resolveBarColor(alloc('ext', 't'), m)).toBe('#9ca3af')
  })
})
