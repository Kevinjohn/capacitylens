import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { openDb } from './db'
import { assertTenantRelationshipIntegrityCurrent } from './tenantIntegrity'

const TS = '2026-01-01T00:00:00.000Z'

function seedRelationshipGraph(db: DatabaseSync): void {
  db.exec(`
    INSERT INTO accounts (id, name, color, createdAt, updatedAt) VALUES
      ('a1', 'One', '#3b82f6', '${TS}', '${TS}'),
      ('a2', 'Two', '#3b82f6', '${TS}', '${TS}');
    INSERT INTO clients (id, accountId, name, color, createdAt, updatedAt) VALUES
      ('c1', 'a1', 'Client One', '#3b82f6', '${TS}', '${TS}'),
      ('c2', 'a2', 'Client Two', '#3b82f6', '${TS}', '${TS}');
    INSERT INTO disciplines (id, accountId, name, sortOrder, createdAt, updatedAt) VALUES
      ('d1', 'a1', 'Discipline One', 1, '${TS}', '${TS}'),
      ('d2', 'a2', 'Discipline Two', 1, '${TS}', '${TS}');
    INSERT INTO projects (id, accountId, name, clientId, color, createdAt, updatedAt) VALUES
      ('p1', 'a1', 'Project One', 'c1', '#3b82f6', '${TS}', '${TS}'),
      ('p2', 'a2', 'Project Two', 'c2', '#3b82f6', '${TS}', '${TS}');
    INSERT INTO phases (id, accountId, name, projectId, createdAt, updatedAt) VALUES
      ('ph1', 'a1', 'Phase One', 'p1', '${TS}', '${TS}'),
      ('ph2', 'a2', 'Phase Two', 'p2', '${TS}', '${TS}');
    INSERT INTO resources (
      id, accountId, kind, name, role, disciplineId, employmentType, workingHoursPerDay,
      workingDays, projectId, color, createdAt, updatedAt
    ) VALUES
      ('r1', 'a1', 'person', 'Resource One', 'Designer', 'd1', 'employee', 8,
       '[1,2,3,4,5]', 'p1', '#3b82f6', '${TS}', '${TS}'),
      ('r2', 'a2', 'person', 'Resource Two', 'Designer', 'd2', 'employee', 8,
       '[1,2,3,4,5]', 'p2', '#3b82f6', '${TS}', '${TS}');
    INSERT INTO activities (id, accountId, name, kind, projectId, phaseId, createdAt, updatedAt) VALUES
      ('act1', 'a1', 'Activity One', 'project', 'p1', 'ph1', '${TS}', '${TS}'),
      ('act2', 'a2', 'Activity Two', 'project', 'p2', 'ph2', '${TS}', '${TS}');
    INSERT INTO allocations (
      id, accountId, resourceId, activityId, startDate, endDate, hoursPerDay,
      status, createdAt, updatedAt
    ) VALUES ('al1', 'a1', 'r1', 'act1', '2026-01-01', '2026-01-02', 4,
              'tentative', '${TS}', '${TS}');
    INSERT INTO timeOff (
      id, accountId, resourceId, startDate, endDate, type, createdAt, updatedAt
    ) VALUES ('to1', 'a1', 'r1', '2026-01-01', '2026-01-02', 'holiday', '${TS}', '${TS}');
  `)
}

describe('tenant relationship database integrity', () => {
  let db: DatabaseSync

  beforeEach(() => {
    db = openDb(':memory:')
    seedRelationshipGraph(db)
  })

  afterEach(() => db.close())

  it.each([
    ['resources.disciplineId', `INSERT INTO resources (id, accountId, kind, role, disciplineId, employmentType, workingHoursPerDay, workingDays, color, createdAt, updatedAt) VALUES ('bad-rd', 'a1', 'person', 'Designer', 'd2', 'employee', 8, '[1,2,3,4,5]', '#3b82f6', '${TS}', '${TS}')`],
    ['projects.clientId', `INSERT INTO projects (id, accountId, name, clientId, color, createdAt, updatedAt) VALUES ('bad-pc', 'a1', 'Bad', 'c2', '#3b82f6', '${TS}', '${TS}')`],
    ['phases.projectId', `INSERT INTO phases (id, accountId, name, projectId, createdAt, updatedAt) VALUES ('bad-php', 'a1', 'Bad', 'p2', '${TS}', '${TS}')`],
    ['resources.projectId', `INSERT INTO resources (id, accountId, kind, role, employmentType, workingHoursPerDay, workingDays, projectId, color, createdAt, updatedAt) VALUES ('bad-rp', 'a1', 'person', 'Designer', 'employee', 8, '[1,2,3,4,5]', 'p2', '#3b82f6', '${TS}', '${TS}')`],
    ['activities.projectId', `INSERT INTO activities (id, accountId, name, kind, projectId, createdAt, updatedAt) VALUES ('bad-ap', 'a1', 'Bad', 'project', 'p2', '${TS}', '${TS}')`],
    ['activities.phaseId', `INSERT INTO activities (id, accountId, name, kind, phaseId, createdAt, updatedAt) VALUES ('bad-aph', 'a1', 'Bad', 'repeatable', 'ph2', '${TS}', '${TS}')`],
    ['allocations.resourceId', `INSERT INTO allocations (id, accountId, resourceId, activityId, startDate, endDate, hoursPerDay, status, createdAt, updatedAt) VALUES ('bad-alr', 'a1', 'r2', 'act1', '2026-01-01', '2026-01-02', 4, 'tentative', '${TS}', '${TS}')`],
    ['allocations.activityId', `INSERT INTO allocations (id, accountId, resourceId, activityId, startDate, endDate, hoursPerDay, status, createdAt, updatedAt) VALUES ('bad-ala', 'a1', 'r1', 'act2', '2026-01-01', '2026-01-02', 4, 'tentative', '${TS}', '${TS}')`],
    ['timeOff.resourceId', `INSERT INTO timeOff (id, accountId, resourceId, startDate, endDate, type, createdAt, updatedAt) VALUES ('bad-tor', 'a1', 'r2', '2026-01-01', '2026-01-02', 'holiday', '${TS}', '${TS}')`],
  ] as const)('rejects a cross-account %s insert', (relationship, sql) => {
    expect(() => db.exec(sql)).toThrow(`cross-account relationship: ${relationship}`)
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it.each([
    ['clients', 'c1'],
    ['disciplines', 'd1'],
    ['projects', 'p1'],
    ['phases', 'ph1'],
    ['resources', 'r1'],
    ['activities', 'act1'],
    ['allocations', 'al1'],
    ['timeOff', 'to1'],
  ] as const)('makes %s.accountId immutable', (table, id) => {
    expect(() => db.prepare(`UPDATE ${table} SET accountId = 'a2' WHERE id = ?`).run(id))
      .toThrow(`accountId is immutable: ${table}`)
  })

  it('rejects a cross-account relationship introduced by update', () => {
    expect(() => db.prepare(`UPDATE allocations SET resourceId = 'r2' WHERE id = 'al1'`).run())
      .toThrow('cross-account relationship: allocations.resourceId')
  })

  it('rejects a trigger whose name is correct but enforcement body drifted', () => {
    db.exec(`
      DROP TRIGGER capacitylens_tenant_allocations_resourceId_insert;
      CREATE TRIGGER capacitylens_tenant_allocations_resourceId_insert
      BEFORE INSERT ON allocations BEGIN SELECT 1; END;
    `)
    expect(() => assertTenantRelationshipIntegrityCurrent(db))
      .toThrow(/first mismatch capacitylens_tenant_allocations_resourceId_insert/)
  })
})
