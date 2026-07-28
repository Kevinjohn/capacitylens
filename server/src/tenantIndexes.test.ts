import { describe, expect, it } from 'vitest'
import { initializeOpenDb, openDb } from './db'
import {
  FOREIGN_KEY_CHILD_INDEXES_V23,
  TENANT_ENTITY_ACCOUNT_INDEXES_V21,
  assertTenantEntityIndexesCurrent,
} from './tenantIndexes'

describe('tenant entity account indexes', () => {
  it('uses an accountId index for every scoped SELECT and DELETE', () => {
    const db = openDb(':memory:')
    for (const { table, index } of TENANT_ENTITY_ACCOUNT_INDEXES_V21) {
      for (const statement of [
        `SELECT * FROM ${table} WHERE accountId = ?`,
        `DELETE FROM ${table} WHERE accountId = ?`,
      ]) {
        const plan = db.prepare(`EXPLAIN QUERY PLAN ${statement}`).all('target-account') as Array<{
          detail: string
        }>
        expect(
          plan.some((step) => new RegExp(
            `USING (?:COVERING )?INDEX ${index} \\(accountId=\\?\\)`,
          ).test(step.detail)),
          `${statement}: ${plan.map((step) => step.detail).join(' | ')}`,
        ).toBe(true)
      }
    }
    db.close()
  })

  it('uses a child-column index for every non-account foreign-key lookup', () => {
    const db = openDb(':memory:')
    for (const { table, column, index } of FOREIGN_KEY_CHILD_INDEXES_V23) {
      const statement = `SELECT id FROM ${table} WHERE ${column} = ?`
      const plan = db.prepare(`EXPLAIN QUERY PLAN ${statement}`).all('parent-id') as Array<{ detail: string }>
      expect(
        plan.some((step) => new RegExp(
          `USING (?:COVERING )?INDEX ${index} \\(${column}=\\?\\)`,
        ).test(step.detail)),
        `${statement}: ${plan.map((step) => step.detail).join(' | ')}`,
      ).toBe(true)
    }
    db.close()
  })

  it('refuses a current-version database whose tenant index has drifted', () => {
    const db = openDb(':memory:')
    db.exec('DROP INDEX idx_allocations_accountId')

    expect(() => assertTenantEntityIndexesCurrent(db)).toThrow(
      /idx_allocations_accountId does not match allocations\(accountId\)/,
    )
    expect(() => initializeOpenDb(db, ':memory:')).toThrow(
      /idx_allocations_accountId does not match allocations\(accountId\)/,
    )
    db.close()
  })

  it('refuses a current-version database whose foreign-key child index has drifted', () => {
    const db = openDb(':memory:')
    db.exec('DROP INDEX idx_allocations_resourceId')

    expect(() => assertTenantEntityIndexesCurrent(db)).toThrow(
      /idx_allocations_resourceId does not match allocations\(resourceId\)/,
    )
    expect(() => initializeOpenDb(db, ':memory:')).toThrow(
      /idx_allocations_resourceId does not match allocations\(resourceId\)/,
    )
    db.close()
  })
})
