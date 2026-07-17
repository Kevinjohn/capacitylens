import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import {
  ACCESS_LAB_ACCOUNT_ID,
  ACCESS_LAB_DB_PATH,
  ACCESS_LAB_PERSONAS,
  buildAccessLabData,
  resolveAccessLabDbPath,
} from './accessLab'

describe('access lab fixture', () => {
  it('accepts only the exact repository fixture path, not a same-named database elsewhere', () => {
    expect(resolveAccessLabDbPath(ACCESS_LAB_DB_PATH)).toBe(ACCESS_LAB_DB_PATH)
    expect(() => resolveAccessLabDbPath(join('/tmp', '.access-lab.db'))).toThrow(/refuses every database/i)
  })

  it('contains one company, one persona at each role, and human-visible confidential fields', () => {
    const data = buildAccessLabData()
    expect(data.accounts).toEqual([expect.objectContaining({ id: ACCESS_LAB_ACCOUNT_ID, name: 'Studio North' })])
    expect(new Set(ACCESS_LAB_PERSONAS.map((persona) => persona.role))).toEqual(
      new Set(['owner', 'admin', 'editor', 'viewer']),
    )
    expect(data.clients).toContainEqual(expect.objectContaining({ name: 'Acme Inc.', isPrivate: true, codeName: 'Northstar' }))
    expect(data.projects).toContainEqual(expect.objectContaining({ name: 'Project Lightning', isPrivate: true, codeName: 'Aurora' }))
    expect(data.timeOff.some((row) => Boolean(row.note))).toBe(true)
    const scopedRows: Array<{ accountId: string }> = [
      ...data.disciplines,
      ...data.resources,
      ...data.clients,
      ...data.projects,
      ...data.phases,
      ...data.activities,
      ...data.allocations,
      ...data.timeOff,
    ]
    expect(scopedRows.every((row) => row.accountId === ACCESS_LAB_ACCOUNT_ID)).toBe(true)
  })
})
