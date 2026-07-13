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
  obfuscateResource,
  activeOnly,
  archiveImpact,
  isLifecycleEntityKey,
  PURGE_MIN_AGE_DAYS,
} from './lifecycle'
import type { LifecycleState, LifecycleFields } from './lifecycle'
import { emptyAppData } from '../types/entities'
import type { AppData, Resource } from '../types/entities'

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

describe('isLifecycleEntityKey — narrowing guard for the tombstone-carrying tables', () => {
  it('is TRUE for exactly resources/clients/projects', () => {
    expect(isLifecycleEntityKey('resources')).toBe(true)
    expect(isLifecycleEntityKey('clients')).toBe(true)
    expect(isLifecycleEntityKey('projects')).toBe(true)
  })
  it('is FALSE for every non-lifecycle table (they carry no archivedAt/deletedAt)', () => {
    expect(isLifecycleEntityKey('phases')).toBe(false)
    expect(isLifecycleEntityKey('activities')).toBe(false)
    expect(isLifecycleEntityKey('allocations')).toBe(false)
    expect(isLifecycleEntityKey('timeOff')).toBe(false)
    expect(isLifecycleEntityKey('disciplines')).toBe(false)
    expect(isLifecycleEntityKey('accounts')).toBe(false)
    expect(isLifecycleEntityKey('nonsense')).toBe(false)
  })
})

describe('obfuscateResource — scrub a Resource\'s PII at soft-delete (pure, immutable)', () => {
  // A full, valid sample Resource so the preservation assertions check the REAL field set. The
  // id's leading hex ('a1b2') is the source of the deterministic token tag. Each call returns a
  // fresh object (its own workingDays array) so the immutability checks aren't fooled by aliasing.
  const makeResource = (over: Partial<Resource> = {}): Resource => ({
    id: 'a1b2c3d4-0000-4000-8000-000000000000',
    accountId: 'acc-1',
    kind: 'person',
    name: 'Ada Lovelace',
    role: 'Senior Designer',
    disciplineId: 'disc-1',
    employmentType: 'permanent',
    workingHoursPerDay: 8,
    workingDays: [1, 2, 3, 4, 5],
    projectId: undefined,
    color: '#3b82f6',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
    archivedAt: T_ARCH,
    deletedAt: T_DEL,
    ...over,
  })

  it("scrubs a named person's name → 'Removed person #…', original name gone", () => {
    const result = obfuscateResource(makeResource())
    expect(result.name?.startsWith('Removed person #')).toBe(true)
    expect(result.name).not.toContain('Ada Lovelace')
    expect(result.name).not.toContain('Ada')
  })

  it('preserves EVERY non-PII field unchanged (role is NOT PII)', () => {
    const input = makeResource()
    const result = obfuscateResource(input)
    expect(result.id).toBe(input.id)
    expect(result.accountId).toBe(input.accountId)
    expect(result.kind).toBe(input.kind)
    expect(result.role).toBe('Senior Designer') // a job label, retained
    expect(result.disciplineId).toBe(input.disciplineId)
    expect(result.employmentType).toBe(input.employmentType)
    expect(result.workingHoursPerDay).toBe(input.workingHoursPerDay)
    expect(result.workingDays).toEqual(input.workingDays)
    expect(result.projectId).toBe(input.projectId)
    expect(result.color).toBe(input.color)
    expect(result.createdAt).toBe(input.createdAt)
    expect(result.updatedAt).toBe(input.updatedAt)
    expect(result.archivedAt).toBe(input.archivedAt)
    expect(result.deletedAt).toBe(input.deletedAt)
  })

  it('does NOT mutate the input and returns a NEW reference (immutability)', () => {
    const input = makeResource()
    const snapshot = structuredClone(input)
    const result = obfuscateResource(input)
    expect(input).toEqual(snapshot) // input deep-unchanged (name still 'Ada Lovelace')
    expect(input.name).toBe('Ada Lovelace')
    expect(result).not.toBe(input) // different object
  })

  it('is DETERMINISTIC: same id ⇒ identical token across two calls', () => {
    const a = obfuscateResource(makeResource())
    const b = obfuscateResource(makeResource())
    expect(a.name).toBe(b.name)
  })

  it('different ids ⇒ different tokens (first-4 hex differ)', () => {
    const a = obfuscateResource(makeResource({ id: 'a1b2c3d4-0000-4000-8000-000000000000' }))
    const b = obfuscateResource(makeResource({ id: 'ffff0000-0000-4000-8000-000000000000' }))
    expect(a.name).not.toBe(b.name)
  })

  it('handles a NAMELESS placeholder (name undefined) → token set, non-empty', () => {
    const result = obfuscateResource(makeResource({ kind: 'placeholder', name: undefined }))
    expect(result.name).toBeDefined()
    expect(result.name?.startsWith('Removed person #')).toBe(true)
    expect(result.name).not.toBe('Removed person #') // a real tag, not bare
  })

  it('handles an EXTERNAL resource: the COMPANY name is gone, replaced by the token', () => {
    const result = obfuscateResource(makeResource({ kind: 'external', name: 'Acme Print Co' }))
    expect(result.name).not.toContain('Acme')
    expect(result.name?.startsWith('Removed person #')).toBe(true)
  })

  it("never leaves a bare 'Removed person #' — the tag is non-empty for a normal UUID id", () => {
    const result = obfuscateResource(makeResource())
    const tag = result.name?.replace('Removed person #', '')
    expect(tag).toBe('a1b2') // first-4 alphanumerics of the id
    expect(tag?.length).toBeGreaterThan(0)
  })

  // ANON_FALLBACK_TAG branch of shortResourceTag(id): when the id yields NO alphanumerics to
  // derive a tag from, the token falls back to the documented '0000' rather than leaving a bare
  // 'Removed person #'. Both an empty id and an all-punctuation id must hit that same fallback.
  it("empty id ⇒ fallback tag '0000' (no alphanumerics to derive from)", () => {
    expect(obfuscateResource(makeResource({ id: '' })).name).toBe('Removed person #0000')
  })

  it("id with only non-alphanumerics ('----') ⇒ fallback tag '0000'", () => {
    expect(obfuscateResource(makeResource({ id: '----' })).name).toBe('Removed person #0000')
  })
})

describe('activeOnly — VIEW/read projection that drops non-active resources/clients/projects (pure, immutable)', () => {
  // A small AppData with a deliberate MIX in each lifecycle-bearing table: one active, one archived
  // (archivedAt only), one soft-deleted (deletedAt set). The non-lifecycle tables carry a row each so
  // we can assert they pass through byte-for-byte (no lifecycle field ⇒ never filtered). Field shapes
  // need only satisfy the array element types loosely — the projection reads ONLY the tombstones.
  const A = 'acct-1'
  function mixedData(): AppData {
    return {
      ...emptyAppData(),
      // accounts has no lifecycle field — pass-through.
      accounts: [{ id: A, name: 'Studio', color: '#3b82f6', createdAt: T_ARCH, updatedAt: T_ARCH }],
      disciplines: [{ id: 'd1', accountId: A, name: 'Design', sortOrder: 0, createdAt: T_ARCH, updatedAt: T_ARCH }],
      resources: [
        { id: 'r-active', accountId: A, kind: 'person', name: 'Active', role: 'Designer', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#3b82f6', createdAt: T_ARCH, updatedAt: T_ARCH },
        { id: 'r-archived', accountId: A, kind: 'person', name: 'Archived', role: 'Designer', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#3b82f6', createdAt: T_ARCH, updatedAt: T_ARCH, archivedAt: T_ARCH },
        { id: 'r-deleted', accountId: A, kind: 'person', name: 'Deleted', role: 'Designer', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#3b82f6', createdAt: T_ARCH, updatedAt: T_ARCH, archivedAt: T_ARCH, deletedAt: T_DEL },
      ],
      clients: [
        { id: 'c-active', accountId: A, name: 'Active Co', color: '#3b82f6', createdAt: T_ARCH, updatedAt: T_ARCH },
        { id: 'c-archived', accountId: A, name: 'Archived Co', color: '#3b82f6', createdAt: T_ARCH, updatedAt: T_ARCH, archivedAt: T_ARCH },
        { id: 'c-deleted', accountId: A, name: 'Deleted Co', color: '#3b82f6', createdAt: T_ARCH, updatedAt: T_ARCH, deletedAt: T_DEL },
      ],
      projects: [
        { id: 'p-active', accountId: A, name: 'Active P', clientId: 'c-active', color: '#3b82f6', createdAt: T_ARCH, updatedAt: T_ARCH },
        { id: 'p-hidden-parent', accountId: A, name: 'Hidden with client', clientId: 'c-archived', color: '#3b82f6', createdAt: T_ARCH, updatedAt: T_ARCH },
        { id: 'p-archived', accountId: A, name: 'Archived P', clientId: 'c-active', color: '#3b82f6', createdAt: T_ARCH, updatedAt: T_ARCH, archivedAt: T_ARCH },
        { id: 'p-deleted', accountId: A, name: 'Deleted P', clientId: 'c-active', color: '#3b82f6', createdAt: T_ARCH, updatedAt: T_ARCH, deletedAt: T_DEL },
      ],
      // Non-lifecycle child tables — carry a row each to prove pass-through.
      phases: [
        { id: 'ph1', accountId: A, name: 'Build', projectId: 'p-active', createdAt: T_ARCH, updatedAt: T_ARCH },
        { id: 'ph-hidden', accountId: A, name: 'Hidden', projectId: 'p-hidden-parent', createdAt: T_ARCH, updatedAt: T_ARCH },
      ],
      activities: [
        { id: 'act1', accountId: A, name: 'Activity', kind: 'project', projectId: 'p-active', createdAt: T_ARCH, updatedAt: T_ARCH },
        { id: 'act-hidden', accountId: A, name: 'Hidden Activity', kind: 'project', projectId: 'p-hidden-parent', createdAt: T_ARCH, updatedAt: T_ARCH },
      ],
      allocations: [
        { id: 'al1', accountId: A, resourceId: 'r-active', activityId: 'act1', startDate: '2026-01-01', endDate: '2026-01-05', hoursPerDay: 8, status: 'confirmed', createdAt: T_ARCH, updatedAt: T_ARCH },
        { id: 'al-hidden-activity', accountId: A, resourceId: 'r-active', activityId: 'act-hidden', startDate: '2026-01-01', endDate: '2026-01-05', hoursPerDay: 8, status: 'confirmed', createdAt: T_ARCH, updatedAt: T_ARCH },
        { id: 'al-hidden-resource', accountId: A, resourceId: 'r-archived', activityId: 'act1', startDate: '2026-01-01', endDate: '2026-01-05', hoursPerDay: 8, status: 'confirmed', createdAt: T_ARCH, updatedAt: T_ARCH },
      ],
      timeOff: [
        { id: 'to1', accountId: A, resourceId: 'r-active', startDate: '2026-02-01', endDate: '2026-02-03', type: 'holiday', createdAt: T_ARCH, updatedAt: T_ARCH },
        { id: 'to-hidden', accountId: A, resourceId: 'r-archived', startDate: '2026-02-01', endDate: '2026-02-03', type: 'holiday', createdAt: T_ARCH, updatedAt: T_ARCH },
      ],
    }
  }

  it('DROPS archived AND soft-deleted resources/clients/projects; KEEPS the active ones', () => {
    const out = activeOnly(mixedData())
    expect(out.resources.map((r) => r.id)).toEqual(['r-active'])
    expect(out.clients.map((c) => c.id)).toEqual(['c-active'])
    expect(out.projects.map((p) => p.id)).toEqual(['p-active'])
  })

  it('closure-prunes descendants of hidden parents/resources while preserving top-level metadata', () => {
    const input = mixedData()
    const out = activeOnly(input)
    expect(out.phases.map((row) => row.id)).toEqual(['ph1'])
    expect(out.activities.map((row) => row.id)).toEqual(['act1'])
    expect(out.allocations.map((row) => row.id)).toEqual(['al1'])
    expect(out.timeOff.map((row) => row.id)).toEqual(['to1'])
    expect(out.disciplines).toBe(input.disciplines)
    expect(out.accounts).toBe(input.accounts)
  })

  it('does NOT mutate the input (deep-equal the original) and returns a NEW object', () => {
    const input = mixedData()
    const snapshot = structuredClone(input)
    const out = activeOnly(input)
    expect(input).toEqual(snapshot) // input deep-unchanged — every archived/deleted row still present
    expect(input.resources).toHaveLength(3)
    expect(input.clients).toHaveLength(3)
    expect(input.projects).toHaveLength(4)
    expect(out).not.toBe(input) // a fresh AppData reference
  })

  it('an all-active dataset is preserved (every row kept, every table present)', () => {
    const input = mixedData()
    // Strip the non-active rows so everything left is active.
    input.resources = input.resources.filter((r) => r.id === 'r-active')
    input.clients = input.clients.filter((c) => c.id === 'c-active')
    input.projects = input.projects.filter((p) => p.id === 'p-active')
    const out = activeOnly(input)
    expect(out.resources).toHaveLength(1)
    expect(out.clients).toHaveLength(1)
    expect(out.projects).toHaveLength(1)
    expect(Object.keys(out).sort()).toEqual(Object.keys(emptyAppData()).sort())
  })

  it('an empty dataset projects to an empty dataset (no throw)', () => {
    const out = activeOnly(emptyAppData())
    expect(out.resources).toEqual([])
    expect(out.clients).toEqual([])
    expect(out.projects).toEqual([])
  })
})

describe('archiveImpact', () => {
  const A = 'acct-1'
  // A minimal live tree: client c1 → project p1 → project-activity a1 → allocation al1; plus an
  // internal activity (no project) whose allocation al-internal hangs off the resource, not the
  // client; plus time-off to1. c-empty has nothing beneath it.
  function base(): AppData {
    return {
      ...emptyAppData(),
      accounts: [{ id: A, name: 'Studio', color: '#3b82f6', createdAt: T_ARCH, updatedAt: T_ARCH }],
      resources: [
        { id: 'r1', accountId: A, kind: 'person', name: 'R', role: 'Dev', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#3b82f6', createdAt: T_ARCH, updatedAt: T_ARCH },
      ],
      clients: [
        { id: 'c1', accountId: A, name: 'C1', color: '#3b82f6', createdAt: T_ARCH, updatedAt: T_ARCH },
        { id: 'c-empty', accountId: A, name: 'Empty', color: '#3b82f6', createdAt: T_ARCH, updatedAt: T_ARCH },
      ],
      projects: [
        { id: 'p1', accountId: A, name: 'P1', clientId: 'c1', color: '#3b82f6', createdAt: T_ARCH, updatedAt: T_ARCH },
      ],
      activities: [
        { id: 'a1', accountId: A, name: 'A1', kind: 'project', projectId: 'p1', createdAt: T_ARCH, updatedAt: T_ARCH },
        { id: 'internal', accountId: A, name: 'Admin', kind: 'internal', createdAt: T_ARCH, updatedAt: T_ARCH },
      ],
      allocations: [
        { id: 'al1', accountId: A, resourceId: 'r1', activityId: 'a1', startDate: '2026-01-01', endDate: '2026-01-05', hoursPerDay: 8, status: 'confirmed', createdAt: T_ARCH, updatedAt: T_ARCH },
        { id: 'al-internal', accountId: A, resourceId: 'r1', activityId: 'internal', startDate: '2026-01-01', endDate: '2026-01-05', hoursPerDay: 8, status: 'confirmed', createdAt: T_ARCH, updatedAt: T_ARCH },
      ],
      timeOff: [
        { id: 'to1', accountId: A, resourceId: 'r1', startDate: '2026-02-01', endDate: '2026-02-03', type: 'holiday', createdAt: T_ARCH, updatedAt: T_ARCH },
      ],
    }
  }

  it('counts a client’s active descendants: its projects + their project-activities + allocations', () => {
    // al-internal stays (its activity is internal, not under c1); to1 is a resource descendant.
    expect(archiveImpact(base(), 'clients', 'c1')).toEqual({ projects: 1, activities: 1, allocations: 1, timeOff: 0 })
  })

  it('reports zero descendants for an empty client', () => {
    expect(archiveImpact(base(), 'clients', 'c-empty')).toEqual({ projects: 0, activities: 0, allocations: 0, timeOff: 0 })
  })

  it('for a project: activities + allocations, and NEVER a self project count', () => {
    expect(archiveImpact(base(), 'projects', 'p1')).toEqual({ projects: 0, activities: 1, allocations: 1, timeOff: 0 })
  })

  it('for a resource: all its allocations (incl. the internal-activity one) + its time off', () => {
    expect(archiveImpact(base(), 'resources', 'r1')).toEqual({ projects: 0, activities: 0, allocations: 2, timeOff: 1 })
  })

  it('does NOT mutate the input', () => {
    const input = base()
    const snapshot = structuredClone(input)
    archiveImpact(input, 'clients', 'c1')
    expect(input).toEqual(snapshot)
  })
})
