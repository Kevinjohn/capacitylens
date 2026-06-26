import { describe, it, expect } from 'vitest'
import {
  lifecycleStatus,
  canArchive,
  canUnarchive,
  canSoftDelete,
  canPurge,
  archive,
  unarchive,
  softDelete,
  PURGE_MIN_AGE_DAYS,
} from './lifecycle'
import type { LifecycleState, LifecycleFields } from './lifecycle'

// These tests are an INDEPENDENT oracle of the P2.2 lifecycle state machine: the expected states /
// booleans below are hand-derived from the contract (deletedAt wins; archive needs active; delete +
// unarchive need archived; purge needs deleted + age ≥ 30d, fail-closed), NOT copied from the
// implementation. If lifecycle.ts and these tables disagree, that's the test doing its job.

// Fixed ISO consts so every assertion is deterministic (no ambient clock anywhere in the machine).
const T_ARCH = '2026-01-01T00:00:00.000Z'
const T_DEL = '2026-02-01T00:00:00.000Z'
const NOW = '2026-06-01T00:00:00.000Z' // an arbitrary "now" used for archive/softDelete timestamps

const DAY_MS = 86_400_000

// `new Date(number).toISOString()` is deterministic/pure (a number in, never an ambient clock) — fine
// in a TEST. Used to build exact-age "now" values relative to the tombstone for the canPurge boundary.
const nowAfterDelete = (days: number): string => new Date(Date.parse(T_DEL) + days * DAY_MS).toISOString()

// The three canonical sample entities, each carrying an extra `{ id, name }` payload so the
// immutability/preservation assertions have something concrete to check survives a transition.
type Sample = LifecycleFields & { id: string; name: string }
const makeActive = (): Sample => ({ id: 'r1', name: 'x' })
const makeArchived = (): Sample => ({ id: 'r1', name: 'x', archivedAt: T_ARCH })
const makeDeleted = (): Sample => ({ id: 'r1', name: 'x', archivedAt: T_ARCH, deletedAt: T_DEL })

describe('lifecycleStatus — derive state from tombstones (deletedAt wins)', () => {
  it("active ({}) → 'active'", () => {
    expect(lifecycleStatus(makeActive())).toBe<LifecycleState>('active')
  })
  it("archived ({archivedAt}) → 'archived'", () => {
    expect(lifecycleStatus(makeArchived())).toBe<LifecycleState>('archived')
  })
  it("deleted ({archivedAt, deletedAt}) → 'deleted' (deletedAt wins over archivedAt)", () => {
    expect(lifecycleStatus(makeDeleted())).toBe<LifecycleState>('deleted')
  })
  it("standalone deletedAt with NO archivedAt → 'deleted' (deletedAt wins on its own)", () => {
    expect(lifecycleStatus({ deletedAt: T_DEL })).toBe<LifecycleState>('deleted')
  })
  it('treats null tombstones as absent (SQLite/JSON round-trip)', () => {
    expect(lifecycleStatus({ archivedAt: null as unknown as string, deletedAt: null as unknown as string })).toBe(
      'active',
    )
  })
})

describe('can* predicates — full truth table over active/archived/deleted', () => {
  // Hand-written oracle: archive←active, unarchive←archived, softDelete←archived.
  const EXPECTED = {
    active: { canArchive: true, canUnarchive: false, canSoftDelete: false },
    archived: { canArchive: false, canUnarchive: true, canSoftDelete: true },
    deleted: { canArchive: false, canUnarchive: false, canSoftDelete: false },
  } as const
  const samples: Record<keyof typeof EXPECTED, Sample> = {
    active: makeActive(),
    archived: makeArchived(),
    deleted: makeDeleted(),
  }
  for (const state of ['active', 'archived', 'deleted'] as const) {
    const e = EXPECTED[state]
    it(`canArchive(${state}) === ${e.canArchive}`, () => {
      expect(canArchive(samples[state])).toBe(e.canArchive)
    })
    it(`canUnarchive(${state}) === ${e.canUnarchive}`, () => {
      expect(canUnarchive(samples[state])).toBe(e.canUnarchive)
    })
    it(`canSoftDelete(${state}) === ${e.canSoftDelete}`, () => {
      expect(canSoftDelete(samples[state])).toBe(e.canSoftDelete)
    })
  }
})

describe('archive — active → archived (immutable, fail-loud)', () => {
  it('from active: sets archivedAt to nowISO, status archived, other fields preserved', () => {
    const input = makeActive()
    const result = archive(input, NOW)
    expect(result.archivedAt).toBe(NOW)
    expect(lifecycleStatus(result)).toBe('archived')
    expect(result.id).toBe('r1')
    expect(result.name).toBe('x')
  })
  it('does NOT mutate the input (immutability)', () => {
    const input = makeActive()
    archive(input, NOW)
    expect(input.archivedAt).toBeUndefined()
    expect(lifecycleStatus(input)).toBe('active')
  })
  it('from archived: throws (no re-archive)', () => {
    expect(() => archive(makeArchived(), NOW)).toThrow(/already archived/)
  })
  it('from deleted: throws', () => {
    expect(() => archive(makeDeleted(), NOW)).toThrow(/already deleted/)
  })
})

describe('unarchive — archived → active (clears archivedAt as ABSENT, immutable, fail-loud)', () => {
  it('from archived: archivedAt is ABSENT (not just undefined), status active', () => {
    const input = makeArchived()
    const result = unarchive(input)
    expect('archivedAt' in result).toBe(false)
    expect(result.archivedAt).toBeUndefined()
    // Rule 3: un-archive only clears archivedAt — it must NOT disturb deletedAt (which is already
    // absent on an 'archived' source). Lock that it stays absent rather than leaking a tombstone in.
    expect(result.deletedAt).toBeUndefined()
    expect(lifecycleStatus(result)).toBe('active')
    expect(result.id).toBe('r1')
    expect(result.name).toBe('x')
  })
  it('does NOT mutate the input (immutability)', () => {
    const input = makeArchived()
    unarchive(input)
    expect(input.archivedAt).toBe(T_ARCH)
    expect(lifecycleStatus(input)).toBe('archived')
  })
  it('from active: throws', () => {
    expect(() => unarchive(makeActive())).toThrow(/not archived/)
  })
  it('from deleted: throws (cannot unarchive a tombstone)', () => {
    expect(() => unarchive(makeDeleted())).toThrow(/not archived/)
  })
})

describe('softDelete — archived → deleted (preserves archivedAt, immutable, fail-loud)', () => {
  it('from archived: sets deletedAt to nowISO, PRESERVES archivedAt, status deleted', () => {
    const input = makeArchived()
    const result = softDelete(input, NOW)
    expect(result.deletedAt).toBe(NOW)
    expect(result.archivedAt).toBe(T_ARCH) // tombstone retains when it was archived
    expect(lifecycleStatus(result)).toBe('deleted')
    expect(result.id).toBe('r1')
  })
  it('does NOT mutate the input (immutability)', () => {
    const input = makeArchived()
    softDelete(input, NOW)
    expect(input.deletedAt).toBeUndefined()
    expect(lifecycleStatus(input)).toBe('archived')
  })
  it('from active: throws (must archive first)', () => {
    expect(() => softDelete(makeActive(), NOW)).toThrow(/archived first/)
  })
  it('from deleted: throws (no re-delete)', () => {
    expect(() => softDelete(makeDeleted(), NOW)).toThrow(/archived first/)
  })
})

describe('canPurge — deleted + age ≥ 30d, fail-closed', () => {
  it('deleted + age exactly 30d (== PURGE_MIN_AGE_MS) → true (inclusive boundary)', () => {
    expect(canPurge(makeDeleted(), nowAfterDelete(PURGE_MIN_AGE_DAYS))).toBe(true)
  })
  it('deleted + age 29d → false (under the window)', () => {
    expect(canPurge(makeDeleted(), nowAfterDelete(29))).toBe(false)
  })
  it('deleted + age 31d → true (over the window)', () => {
    expect(canPurge(makeDeleted(), nowAfterDelete(31))).toBe(true)
  })
  it('active → false (not deleted)', () => {
    expect(canPurge(makeActive(), nowAfterDelete(365))).toBe(false)
  })
  it('archived → false (not deleted)', () => {
    expect(canPurge(makeArchived(), nowAfterDelete(365))).toBe(false)
  })
  it('deleted but deletedAt is unparseable garbage → false (fail-closed)', () => {
    expect(canPurge({ deletedAt: 'not-a-date' }, nowAfterDelete(365))).toBe(false)
  })
  it('deleted but nowISO is garbage → false (fail-closed)', () => {
    expect(canPurge(makeDeleted(), 'not-a-date')).toBe(false)
  })
  it('future-dated tombstone (now is 5d BEFORE deletedAt, negative age) → false (clock skew, never falls open)', () => {
    // A negative age must NEVER read as purgeable: `nowMs - deletedMs` is negative, so `>= MS` is false.
    expect(canPurge(makeDeleted(), nowAfterDelete(-5))).toBe(false)
  })
  it('deleted WITHOUT archivedAt, aged 31d → true (archival is NOT a purge precondition — state+age only)', () => {
    // An aged tombstone is purgeable regardless of HOW it got there; only 'deleted' + age matters.
    expect(canPurge({ deletedAt: T_DEL }, nowAfterDelete(31))).toBe(true)
  })
  it('null deletedAt → false (null = absent ⇒ not deleted ⇒ fail-closed; DB round-trip yields null)', () => {
    // The field type is `ISOTimestamp | undefined`, but a SQLite/JSON round-trip can hand back `null`.
    expect(canPurge({ deletedAt: null } as unknown as LifecycleFields, NOW)).toBe(false)
  })
  it('exact MILLISECOND boundary: == PURGE_MIN_AGE_MS → true, one ms less → false (locks the >= edge)', () => {
    // Day-granular cases (29d/30d/31d) can't catch a `>` vs `>=` or off-by-one ms regression — assert
    // both edges to the millisecond. `new Date(number).toISOString()` is pure (a number in, no clock).
    const PURGE_MIN_AGE_MS = PURGE_MIN_AGE_DAYS * DAY_MS
    const atBoundary = new Date(Date.parse(T_DEL) + PURGE_MIN_AGE_MS).toISOString()
    const oneMsShort = new Date(Date.parse(T_DEL) + PURGE_MIN_AGE_MS - 1).toISOString()
    expect(canPurge(makeDeleted(), atBoundary)).toBe(true)
    expect(canPurge(makeDeleted(), oneMsShort)).toBe(false)
  })
})

describe('constants', () => {
  it('PURGE_MIN_AGE_DAYS === 30', () => {
    expect(PURGE_MIN_AGE_DAYS).toBe(30)
  })
})
