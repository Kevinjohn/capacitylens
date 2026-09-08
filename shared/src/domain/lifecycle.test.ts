import { describe, it, expect } from "vitest";
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
  inspectLifecycleAncestry,
  isLifecycleEntityKey,
  PURGE_MIN_AGE_DAYS,
  LifecycleTransitionError,
  LIFECYCLE_ENTITY_KEYS,
} from "@capacitylens/shared/domain/lifecycle";
import type {
  LifecycleAncestryLookup,
  LifecycleAncestryRow,
  LifecycleState,
  LifecycleFields,
} from "@capacitylens/shared/domain/lifecycle";
import { emptyAppData } from "../types/entities";
import type { AppData, Resource, Weekday } from "../types/entities";

// These tests are an INDEPENDENT oracle of the P2.2 lifecycle state machine: the expected states /
// booleans below are hand-derived from the contract (deletedAt wins; archive needs active; delete +
// unarchive need archived; purge needs deleted + age ≥ 30d, fail-closed), NOT copied from the
// implementation. If lifecycle.ts and these tables disagree, that's the test doing its job.

// Fixed ISO consts so every assertion is deterministic (no ambient clock anywhere in the machine).
const T_ARCH = "2026-01-01T00:00:00.000Z";
const T_DEL = "2026-02-01T00:00:00.000Z";

describe("lifecycle vocabulary", () => {
  it("is immutable and keeps the narrowing guard closed", () => {
    expect(Object.isFrozen(LIFECYCLE_ENTITY_KEYS)).toBe(true);
    expect(() => (LIFECYCLE_ENTITY_KEYS as unknown as string[]).push("allocations")).toThrow();
    expect(isLifecycleEntityKey("allocations")).toBe(false);
  });
});
const NOW = "2026-06-01T00:00:00.000Z"; // an arbitrary "now" used for archive/softDelete timestamps

const DAY_MS = 86_400_000;

// `new Date(number).toISOString()` is deterministic/pure (a number in, never an ambient clock) — fine
// in a TEST. Used to build exact-age "now" values relative to the tombstone for the canPurge boundary.
const nowAfterDelete = (days: number): string => new Date(Date.parse(T_DEL) + days * DAY_MS).toISOString();

// The three canonical sample entities, each carrying an extra `{ id, name }` payload so the
// immutability/preservation assertions have something concrete to check survives a transition.
type Sample = LifecycleFields & { id: string; name: string };
const makeActive = (): Sample => ({ id: "r1", name: "x" });
const makeArchived = (): Sample => ({ id: "r1", name: "x", archivedAt: T_ARCH });
const makeDeleted = (): Sample => ({ id: "r1", name: "x", archivedAt: T_ARCH, deletedAt: T_DEL });

const expectLifecycleError = (
  operation: () => unknown,
  code: LifecycleTransitionError["code"],
  message: RegExp,
): void => {
  let caught: unknown;
  try {
    operation();
  } catch (error: unknown) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(LifecycleTransitionError);
  if (caught instanceof LifecycleTransitionError) {
    expect(caught.name).toBe("LifecycleTransitionError");
    expect(caught.code).toBe(code);
    expect(caught.message).toMatch(message);
  }
};

describe("lifecycleStatus — derive state from tombstones (deletedAt wins)", () => {
  it("active ({}) → 'active'", () => {
    expect(lifecycleStatus(makeActive())).toBe<LifecycleState>("active");
  });
  it("archived ({archivedAt}) → 'archived'", () => {
    expect(lifecycleStatus(makeArchived())).toBe<LifecycleState>("archived");
  });
  it("deleted ({archivedAt, deletedAt}) → 'deleted' (deletedAt wins over archivedAt)", () => {
    expect(lifecycleStatus(makeDeleted())).toBe<LifecycleState>("deleted");
  });
  it("standalone deletedAt with NO archivedAt → 'deleted' (deletedAt wins on its own)", () => {
    expect(lifecycleStatus({ deletedAt: T_DEL })).toBe<LifecycleState>("deleted");
  });
  it("treats null tombstones as absent (SQLite/JSON round-trip)", () => {
    expect(lifecycleStatus({ archivedAt: null as unknown as string, deletedAt: null as unknown as string })).toBe(
      "active",
    );
  });
  it("derives the nearest valid state from malformed legacy tombstones", () => {
    expect(lifecycleStatus({ archivedAt: T_ARCH, deletedAt: "not-a-date" })).toBe("archived");
    expect(lifecycleStatus({ archivedAt: "", deletedAt: "not-a-date" })).toBe("active");
  });
});

describe("canArchive — public archive affordance over active/archived/deleted", () => {
  const EXPECTED = {
    active: true,
    archived: false,
    deleted: false,
  } as const;
  const samples: Record<keyof typeof EXPECTED, Sample> = {
    active: makeActive(),
    archived: makeArchived(),
    deleted: makeDeleted(),
  };
  for (const state of ["active", "archived", "deleted"] as const) {
    it(`canArchive(${state}) === ${EXPECTED[state]}`, () => {
      expect(canArchive(samples[state])).toBe(EXPECTED[state]);
    });
  }
});

describe.each([
  ["canUnarchive", canUnarchive],
  ["canSoftDelete", canSoftDelete],
] as const)("%s — public archived-state affordance", (_name, predicate) => {
  it.each([
    ["active", makeActive(), false],
    ["archived", makeArchived(), true],
    ["deleted", makeDeleted(), false],
  ] as const)("returns the documented result for %s", (_state, sample, expected) => {
    expect(predicate(sample)).toBe(expected);
  });
});

describe("archive — active → archived (immutable, fail-loud)", () => {
  it("from active: sets archivedAt to nowISO, status archived, other fields preserved", () => {
    const input = makeActive();
    const result = archive(input, NOW);
    expect(result.archivedAt).toBe(NOW);
    expect(lifecycleStatus(result)).toBe("archived");
    expect(result.id).toBe("r1");
    expect(result.name).toBe("x");
  });
  it("does NOT mutate the input (immutability)", () => {
    const input = makeActive();
    archive(input, NOW);
    expect(input.archivedAt).toBeUndefined();
    expect(lifecycleStatus(input)).toBe("active");
  });
  it("replaces malformed legacy tombstones when archiving the recovered active state", () => {
    const result = archive({ ...makeActive(), archivedAt: "", deletedAt: "not-a-date" }, NOW);
    expect(result.archivedAt).toBe(NOW);
    expect(result).not.toHaveProperty("deletedAt");
    expect(lifecycleStatus(result)).toBe("archived");
  });
  it("from archived: throws (no re-archive)", () => {
    expectLifecycleError(() => archive(makeArchived(), NOW), "already_inactive", /already archived/);
  });
  it("from deleted: throws", () => {
    expectLifecycleError(() => archive(makeDeleted(), NOW), "invalid_transition", /already deleted/);
  });
  it("rejects an invalid archive timestamp and canonicalizes an explicit offset", () => {
    expect(() => archive(makeActive(), "not-a-timestamp")).toThrow(/valid ISO timestamp/);
    expect(archive(makeActive(), "2026-06-01T01:00:00+01:00").archivedAt).toBe(NOW);
  });
});

describe("unarchive — archived → active (clears archivedAt as ABSENT, immutable, fail-loud)", () => {
  it("from archived: archivedAt is ABSENT (not just undefined), status active", () => {
    const input = makeArchived();
    const result = unarchive(input);
    expect("archivedAt" in result).toBe(false);
    expect(result.archivedAt).toBeUndefined();
    // Rule 3: un-archive only clears archivedAt — it must NOT disturb deletedAt (which is already
    // absent on an 'archived' source). Lock that it stays absent rather than leaking a tombstone in.
    expect(result.deletedAt).toBeUndefined();
    expect(lifecycleStatus(result)).toBe("active");
    expect(result.id).toBe("r1");
    expect(result.name).toBe("x");
  });
  it("does NOT mutate the input (immutability)", () => {
    const input = makeArchived();
    unarchive(input);
    expect(input.archivedAt).toBe(T_ARCH);
    expect(lifecycleStatus(input)).toBe("archived");
  });
  it("from active: throws", () => {
    expect(() => unarchive(makeActive())).toThrow(/not archived/);
  });
  it("from deleted: throws (cannot unarchive a tombstone)", () => {
    expect(() => unarchive(makeDeleted())).toThrow(/not archived/);
  });
  it("recovers an archived row carrying a malformed deletion tombstone", () => {
    const result = unarchive({ ...makeArchived(), deletedAt: "not-a-date" });
    expect(result).not.toHaveProperty("archivedAt");
    expect(result).not.toHaveProperty("deletedAt");
    expect(lifecycleStatus(result)).toBe("active");
  });
});

describe("softDelete — archived → deleted (preserves archivedAt, immutable, fail-loud)", () => {
  it("from archived: sets deletedAt to nowISO, PRESERVES archivedAt, status deleted", () => {
    const input = makeArchived();
    const result = softDelete(input, NOW);
    expect(result.deletedAt).toBe(NOW);
    expect(result.archivedAt).toBe(T_ARCH); // tombstone retains when it was archived
    expect(lifecycleStatus(result)).toBe("deleted");
    expect(result.id).toBe("r1");
  });
  it("does NOT mutate the input (immutability)", () => {
    const input = makeArchived();
    softDelete(input, NOW);
    expect(input.deletedAt).toBeUndefined();
    expect(lifecycleStatus(input)).toBe("archived");
  });
  it("from active: throws (must archive first)", () => {
    expect(() => softDelete(makeActive(), NOW)).toThrow(/archived first/);
  });
  it("from deleted: throws (no re-delete)", () => {
    expect(() => softDelete(makeDeleted(), NOW)).toThrow(/archived first/);
  });

  it("never records deletion before a future archive when the caller clock moves backward", () => {
    const futureArchive = "2099-01-01T00:00:00.000Z";
    const result = softDelete({ ...makeArchived(), archivedAt: futureArchive }, NOW);

    expect(result.archivedAt).toBe(futureArchive);
    expect(result.deletedAt).toBe(futureArchive);
  });

  it("rejects malformed transition and archive timestamps", () => {
    expect(() => softDelete(makeArchived(), "not-a-timestamp")).toThrow(/valid ISO timestamp/);
    expect(() => softDelete({ ...makeArchived(), archivedAt: "not-a-timestamp" }, NOW)).toThrow(/archived first/);
  });
});

describe("canPurge — deleted + age ≥ 30d, fail-closed", () => {
  it("deleted + age exactly 30d (== PURGE_MIN_AGE_MS) → true (inclusive boundary)", () => {
    expect(canPurge(makeDeleted(), nowAfterDelete(PURGE_MIN_AGE_DAYS))).toBe(true);
  });
  it("deleted + age 29d → false (under the window)", () => {
    expect(canPurge(makeDeleted(), nowAfterDelete(29))).toBe(false);
  });
  it("deleted + age 31d → true (over the window)", () => {
    expect(canPurge(makeDeleted(), nowAfterDelete(31))).toBe(true);
  });
  it("active → false (not deleted)", () => {
    expect(canPurge(makeActive(), nowAfterDelete(365))).toBe(false);
  });
  it("archived → false (not deleted)", () => {
    expect(canPurge(makeArchived(), nowAfterDelete(365))).toBe(false);
  });
  it("deleted but deletedAt is unparseable garbage → false (fail-closed)", () => {
    expect(canPurge({ deletedAt: "not-a-date" }, nowAfterDelete(365))).toBe(false);
  });
  it.each(["0", "01/01/2000", "2026-02-29T00:00:00Z"])(
    "deleted but deletedAt is Date.parse-compatible non-ISO %s → false (fail-closed)",
    (deletedAt) => {
      expect(canPurge({ deletedAt }, NOW)).toBe(false);
    },
  );
  it("deleted but nowISO is garbage → false (fail-closed)", () => {
    expect(canPurge(makeDeleted(), "not-a-date")).toBe(false);
  });
  it("future-dated tombstone (now is 5d BEFORE deletedAt, negative age) → false (clock skew, never falls open)", () => {
    // A negative age must NEVER read as purgeable: `nowMs - deletedMs` is negative, so `>= MS` is false.
    expect(canPurge(makeDeleted(), nowAfterDelete(-5))).toBe(false);
  });
  it("deleted WITHOUT archivedAt, aged 31d → true (archival is NOT a purge precondition — state+age only)", () => {
    // An aged tombstone is purgeable regardless of HOW it got there; only 'deleted' + age matters.
    expect(canPurge({ deletedAt: T_DEL }, nowAfterDelete(31))).toBe(true);
  });
  it("null deletedAt → false (null = absent ⇒ not deleted ⇒ fail-closed; DB round-trip yields null)", () => {
    // The field type is `ISOTimestamp | undefined`, but a SQLite/JSON round-trip can hand back `null`.
    expect(canPurge({ deletedAt: null } as unknown as LifecycleFields, NOW)).toBe(false);
  });
  it("exact MILLISECOND boundary: == PURGE_MIN_AGE_MS → true, one ms less → false (locks the >= edge)", () => {
    // Day-granular cases (29d/30d/31d) can't catch a `>` vs `>=` or off-by-one ms regression — assert
    // both edges to the millisecond. `new Date(number).toISOString()` is pure (a number in, no clock).
    const PURGE_MIN_AGE_MS = PURGE_MIN_AGE_DAYS * DAY_MS;
    const atBoundary = new Date(Date.parse(T_DEL) + PURGE_MIN_AGE_MS).toISOString();
    const oneMsShort = new Date(Date.parse(T_DEL) + PURGE_MIN_AGE_MS - 1).toISOString();
    expect(canPurge(makeDeleted(), atBoundary)).toBe(true);
    expect(canPurge(makeDeleted(), oneMsShort)).toBe(false);
  });
});

describe("constants", () => {
  it("PURGE_MIN_AGE_DAYS === 30", () => {
    expect(PURGE_MIN_AGE_DAYS).toBe(30);
  });
});

describe("isLifecycleEntityKey — narrowing guard for the tombstone-carrying tables", () => {
  it("is TRUE for exactly resources/clients/projects", () => {
    expect(isLifecycleEntityKey("resources")).toBe(true);
    expect(isLifecycleEntityKey("clients")).toBe(true);
    expect(isLifecycleEntityKey("projects")).toBe(true);
  });
  it("is FALSE for every non-lifecycle table (they carry no archivedAt/deletedAt)", () => {
    expect(isLifecycleEntityKey("phases")).toBe(false);
    expect(isLifecycleEntityKey("activities")).toBe(false);
    expect(isLifecycleEntityKey("allocations")).toBe(false);
    expect(isLifecycleEntityKey("timeOff")).toBe(false);
    expect(isLifecycleEntityKey("disciplines")).toBe(false);
    expect(isLifecycleEntityKey("accounts")).toBe(false);
    expect(isLifecycleEntityKey("nonsense")).toBe(false);
  });
});

// A full, valid sample Resource so the preservation assertions check the REAL field set. The
// id's leading hex ('a1b2') is the source of the deterministic token tag. Each call returns a
// fresh object (including its own weekday arrays) so the immutability checks aren't fooled by aliasing.
const RESOURCE_BASE: Resource = {
  id: "a1b2c3d4-0000-4000-8000-000000000000",
  accountId: "acc-1",
  kind: "person",
  name: "Ada Lovelace",
  role: "Senior Designer",
  disciplineId: "disc-1",
  employmentType: "permanent",
  engagement: "studio" as const,
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  color: "#3b82f6",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-02-01T00:00:00.000Z",
  archivedAt: T_ARCH,
  deletedAt: T_DEL,
  halfDays: [],
};
const makeResource = (over: Partial<Resource> = {}): Resource => ({
  ...RESOURCE_BASE,
  workingDays: [...RESOURCE_BASE.workingDays],
  ...(over.projectId === undefined ? {} : { projectId: over.projectId }),
  ...over,
  halfDays: over.halfDays ?? [],
});

describe("obfuscateResource — scrub a Resource's PII at soft-delete (pure, immutable)", () => {
  it("scrubs a named person's name → 'Removed person #…', original name gone", () => {
    const result = obfuscateResource(makeResource());
    expect(result.name?.startsWith("Removed person #")).toBe(true);
    expect(result.name).not.toContain("Ada Lovelace");
    expect(result.name).not.toContain("Ada");
  });

  it("scrubs both free-text display fields and preserves non-PII fields", () => {
    const input = makeResource();
    const result = obfuscateResource(input);
    expect(result.id).toBe(input.id);
    expect(result.accountId).toBe(input.accountId);
    expect(result.kind).toBe(input.kind);
    expect(result.role).toBe("Removed resource");
    expect(result.disciplineId).toBe(input.disciplineId);
    expect(result.employmentType).toBe(input.employmentType);
    expect(result.engagement).toBe(input.engagement);
    expect(result.workingHoursPerDay).toBe(input.workingHoursPerDay);
    expect(result.workingDays).toEqual(input.workingDays);
    expect(result.halfDays).toEqual(input.halfDays);
    expect(result.projectId).toBe(input.projectId);
    expect(result.color).toBe(input.color);
    expect(result.createdAt).toBe(input.createdAt);
    expect(result.updatedAt).toBe(input.updatedAt);
    expect(result.archivedAt).toBe(input.archivedAt);
    expect(result.deletedAt).toBe(input.deletedAt);
  });

  it("does NOT mutate the input and returns a NEW reference (immutability)", () => {
    const input = makeResource();
    const snapshot = structuredClone(input);
    const result = obfuscateResource(input);
    expect(input).toEqual(snapshot); // input deep-unchanged (name still 'Ada Lovelace')
    expect(input.name).toBe("Ada Lovelace");
    expect(result).not.toBe(input); // different object
  });

  it("is DETERMINISTIC: same id ⇒ identical token across two calls", () => {
    const a = obfuscateResource(makeResource());
    const b = obfuscateResource(makeResource());
    expect(a.name).toBe(b.name);
  });

  it("different ids ⇒ different tokens", () => {
    const a = obfuscateResource(makeResource({ id: "a1b2c3d4-0000-4000-8000-000000000000" }));
    const b = obfuscateResource(makeResource({ id: "ffff0000-0000-4000-8000-000000000000" }));
    expect(a.name).not.toBe(b.name);
  });
});

describe("obfuscateResource — scrub a Resource's PII at soft-delete (pure, immutable)", () => {
  it("distinguishes UUIDs that share the first four hexadecimal characters", () => {
    const a = obfuscateResource(makeResource({ id: "abcd1111-0000-4000-8000-000000000000" }));
    const b = obfuscateResource(makeResource({ id: "abcd2222-0000-4000-8000-000000000000" }));
    expect(a.name).toBe("Removed person #abcd11110000");
    expect(b.name).toBe("Removed person #abcd22220000");
    expect(a.name).not.toBe(b.name);
  });

  it("handles a NAMELESS placeholder (name undefined) → token set, non-empty", () => {
    const nameless = makeResource({ kind: "placeholder" });
    delete nameless.name;
    const result = obfuscateResource(nameless);
    expect(result.name).toBeDefined();
    expect(result.name?.startsWith("Removed person #")).toBe(true);
    expect(result.name).not.toBe("Removed person #"); // a real tag, not bare
  });

  it("handles an EXTERNAL resource: the COMPANY name is gone, replaced by the token", () => {
    const result = obfuscateResource(makeResource({ kind: "external", name: "Acme Print Co" }));
    expect(result.name).not.toContain("Acme");
    expect(result.name?.startsWith("Removed person #")).toBe(true);
  });

  it("never leaves a bare 'Removed person #' — the tag is non-empty for a normal UUID id", () => {
    const result = obfuscateResource(makeResource());
    const tag = result.name?.replace("Removed person #", "");
    expect(tag).toBe("a1b2c3d40000");
    expect(tag?.length).toBeGreaterThan(0);
  });

  // ANON_FALLBACK_TAG branch of shortResourceTag(id): when the id yields NO alphanumerics to
  // derive a tag from, the token falls back to the documented '0000' rather than leaving a bare
  // 'Removed person #'. Both an empty id and an all-punctuation id must hit that same fallback.
  it("empty id ⇒ fallback tag '0000' (no alphanumerics to derive from)", () => {
    expect(obfuscateResource(makeResource({ id: "" })).name).toBe("Removed person #0000");
  });

  it("id with only non-alphanumerics ('----') ⇒ fallback tag '0000'", () => {
    expect(obfuscateResource(makeResource({ id: "----" })).name).toBe("Removed person #0000");
  });
});

const ACTIVE_ONLY_ACCOUNT = "acct-1";

const makeActiveOnlyResource = (id: string, name: string, tombstones: LifecycleFields = {}) => ({
  id,
  accountId: ACTIVE_ONLY_ACCOUNT,
  kind: "person" as const,
  name,
  role: "Designer",
  employmentType: "permanent" as const,
  engagement: "studio" as const,
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5] as Weekday[],
  halfDays: [],
  color: "#3b82f6",
  createdAt: T_ARCH,
  updatedAt: T_ARCH,
  ...tombstones,
});
const makeActiveOnlyClient = (id: string, name: string, tombstones: LifecycleFields = {}) => ({
  id,
  accountId: ACTIVE_ONLY_ACCOUNT,
  name,
  color: "#3b82f6",
  createdAt: T_ARCH,
  updatedAt: T_ARCH,
  ...tombstones,
});
const makeActiveOnlyProject = ({
  id,
  name,
  clientId,
  tombstones = {},
}: {
  id: string;
  name: string;
  clientId: string;
  tombstones?: LifecycleFields;
}) => ({
  id,
  accountId: ACTIVE_ONLY_ACCOUNT,
  name,
  clientId,
  color: "#3b82f6",
  createdAt: T_ARCH,
  updatedAt: T_ARCH,
  ...tombstones,
});
const ACTIVE_ONLY_DATA: AppData = {
  ...emptyAppData(),
  accounts: [{ id: ACTIVE_ONLY_ACCOUNT, name: "Studio", color: "#3b82f6", createdAt: T_ARCH, updatedAt: T_ARCH }],
  disciplines: [
    { id: "d1", accountId: ACTIVE_ONLY_ACCOUNT, name: "Design", sortOrder: 0, createdAt: T_ARCH, updatedAt: T_ARCH },
  ],
  resources: [
    makeActiveOnlyResource("r-active", "Active"),
    makeActiveOnlyResource("r-archived", "Archived", { archivedAt: T_ARCH }),
    makeActiveOnlyResource("r-deleted", "Deleted", { archivedAt: T_ARCH, deletedAt: T_DEL }),
  ],
  clients: [
    makeActiveOnlyClient("c-active", "Active Co"),
    makeActiveOnlyClient("c-archived", "Archived Co", { archivedAt: T_ARCH }),
    makeActiveOnlyClient("c-deleted", "Deleted Co", { deletedAt: T_DEL }),
  ],
  projects: [
    makeActiveOnlyProject({ id: "p-active", name: "Active P", clientId: "c-active" }),
    makeActiveOnlyProject({ id: "p-hidden-parent", name: "Hidden with client", clientId: "c-archived" }),
    makeActiveOnlyProject({
      id: "p-archived",
      name: "Archived P",
      clientId: "c-active",
      tombstones: { archivedAt: T_ARCH },
    }),
    makeActiveOnlyProject({
      id: "p-deleted",
      name: "Deleted P",
      clientId: "c-active",
      tombstones: { deletedAt: T_DEL },
    }),
  ],
  phases: [
    {
      id: "ph1",
      accountId: ACTIVE_ONLY_ACCOUNT,
      name: "Build",
      projectId: "p-active",
      createdAt: T_ARCH,
      updatedAt: T_ARCH,
    },
    {
      id: "ph-hidden",
      accountId: ACTIVE_ONLY_ACCOUNT,
      name: "Hidden",
      projectId: "p-hidden-parent",
      createdAt: T_ARCH,
      updatedAt: T_ARCH,
    },
  ],
  activities: [
    {
      id: "act1",
      accountId: ACTIVE_ONLY_ACCOUNT,
      name: "Activity",
      kind: "project" as const,
      projectId: "p-active",
      createdAt: T_ARCH,
      updatedAt: T_ARCH,
    },
    {
      id: "act-hidden",
      accountId: ACTIVE_ONLY_ACCOUNT,
      name: "Hidden Activity",
      kind: "project" as const,
      projectId: "p-hidden-parent",
      createdAt: T_ARCH,
      updatedAt: T_ARCH,
    },
  ],
  allocations: [
    {
      id: "al1",
      accountId: ACTIVE_ONLY_ACCOUNT,
      resourceId: "r-active",
      activityId: "act1",
      startDate: "2026-01-01",
      endDate: "2026-01-05",
      hoursPerDay: 8,
      status: "confirmed" as const,
      createdAt: T_ARCH,
      updatedAt: T_ARCH,
    },
    {
      id: "al-hidden-activity",
      accountId: ACTIVE_ONLY_ACCOUNT,
      resourceId: "r-active",
      activityId: "act-hidden",
      startDate: "2026-01-01",
      endDate: "2026-01-05",
      hoursPerDay: 8,
      status: "confirmed" as const,
      createdAt: T_ARCH,
      updatedAt: T_ARCH,
    },
    {
      id: "al-hidden-resource",
      accountId: ACTIVE_ONLY_ACCOUNT,
      resourceId: "r-archived",
      activityId: "act1",
      startDate: "2026-01-01",
      endDate: "2026-01-05",
      hoursPerDay: 8,
      status: "confirmed" as const,
      createdAt: T_ARCH,
      updatedAt: T_ARCH,
    },
  ],
  timeOff: [
    {
      id: "to1",
      accountId: ACTIVE_ONLY_ACCOUNT,
      resourceId: "r-active",
      startDate: "2026-02-01",
      endDate: "2026-02-03",
      type: "holiday" as const,
      createdAt: T_ARCH,
      updatedAt: T_ARCH,
    },
    {
      id: "to-hidden",
      accountId: ACTIVE_ONLY_ACCOUNT,
      resourceId: "r-archived",
      startDate: "2026-02-01",
      endDate: "2026-02-03",
      type: "holiday" as const,
      createdAt: T_ARCH,
      updatedAt: T_ARCH,
    },
  ],
};
const makeActiveOnlyData = (): AppData => structuredClone(ACTIVE_ONLY_DATA);

const registerActiveOnlyTest1 = (): void => {
  it("DROPS archived AND soft-deleted resources/clients/projects; KEEPS the active ones", () => {
    const out = activeOnly(makeActiveOnlyData());
    expect(out.resources.map((r) => r.id)).toEqual(["r-active"]);
    expect(out.clients.map((c) => c.id)).toEqual(["c-active"]);
    expect(out.projects.map((p) => p.id)).toEqual(["p-active"]);
  });
};

const registerActiveOnlyTest2 = (): void => {
  it("closure-prunes descendants of hidden parents/resources while preserving top-level metadata", () => {
    const input = makeActiveOnlyData();
    const out = activeOnly(input);
    expect(out.phases.map((row) => row.id)).toEqual(["ph1"]);
    expect(out.activities.map((row) => row.id)).toEqual(["act1"]);
    expect(out.allocations.map((row) => row.id)).toEqual(["al1"]);
    expect(out.timeOff.map((row) => row.id)).toEqual(["to1"]);
    expect(out.disciplines).toBe(input.disciplines);
    expect(out.accounts).toBe(input.accounts);
  });
};

const registerActiveOnlyTest3 = (): void => {
  it("retains active rows with unresolved parents instead of inventing hidden lifecycle state", () => {
    const input = {
      ...emptyAppData(),
      projects: [
        {
          id: "p-dangling",
          accountId: "a1",
          clientId: "missing-client",
          name: "Visible integrity damage",
          color: "#2d75da",
          createdAt: T_ARCH,
          updatedAt: T_ARCH,
        },
        {
          id: "p-missing-field",
          accountId: "a1",
          name: "Missing parent field",
          color: "#2d75da",
          createdAt: T_ARCH,
          updatedAt: T_ARCH,
        } as AppData["projects"][number],
      ],
    };

    const out = activeOnly(input);
    expect(out.projects.map(({ id }) => id)).toEqual(["p-dangling", "p-missing-field"]);
    expect(out.projects.every((project) => lifecycleStatus(project) === "active")).toBe(true);
  });
};

const registerActiveOnlyTest4 = (): void => {
  it("treats null optional activity parents as absent and retains their allocations", () => {
    const input = {
      ...emptyAppData(),
      activities: [
        {
          id: "activity-with-null-parents",
          accountId: "a1",
          name: "Internal activity",
          kind: "internal",
          projectId: null,
          phaseId: null,
          createdAt: T_ARCH,
          updatedAt: T_ARCH,
        } as unknown as AppData["activities"][number],
      ],
      allocations: [
        {
          id: "allocation-1",
          accountId: "a1",
          resourceId: "missing-resource",
          activityId: "activity-with-null-parents",
          startDate: "2026-01-01",
          endDate: "2026-01-05",
          hoursPerDay: 8,
          status: "confirmed" as const,
          createdAt: T_ARCH,
          updatedAt: T_ARCH,
        },
      ],
    };

    const out = activeOnly(input);
    expect(out.activities.map(({ id }) => id)).toEqual(["activity-with-null-parents"]);
    expect(out.allocations.map(({ id }) => id)).toEqual(["allocation-1"]);
  });
};

const registerActiveOnlyTest5 = (): void => {
  it("hides a repeatable allocation attributed to an inactive project", () => {
    const input: AppData = {
      ...emptyAppData(),
      projects: [
        {
          id: "archived-project",
          accountId: "a1",
          clientId: "missing-client",
          name: "Archived",
          color: "#2d75da",
          archivedAt: T_ARCH,
          createdAt: T_ARCH,
          updatedAt: T_ARCH,
        },
      ],
      allocations: [
        {
          id: "attributed",
          accountId: "a1",
          resourceId: "missing-resource",
          activityId: "missing-activity",
          projectId: "archived-project",
          startDate: "2026-01-01",
          endDate: "2026-01-01",
          hoursPerDay: 8,
          status: "confirmed",
          createdAt: T_ARCH,
          updatedAt: T_ARCH,
        },
      ],
    };

    expect(activeOnly(input).allocations).toEqual([]);
  });
};

const registerActiveOnlyTest6 = (): void => {
  it("identifies the exact inactive ancestor inherited through every projection edge", () => {
    const input = makeActiveOnlyData();
    const lookup: LifecycleAncestryLookup = (table, id) =>
      (input[table] as unknown as LifecycleAncestryRow[]).find((row) => row.id === id);
    const inspect = (table: Parameters<typeof inspectLifecycleAncestry>[0], id: string) => {
      const row = lookup(table, id);
      if (!row) throw new Error(`Missing lifecycle test row ${table}.${id}`);
      return inspectLifecycleAncestry(table, row, lookup);
    };

    expect(inspect("projects", "p-hidden-parent").inactiveAncestor).toMatchObject({
      table: "clients",
      id: "c-archived",
      state: "archived",
    });
    expect(inspect("phases", "ph-hidden").inactiveAncestor).toMatchObject({
      table: "clients",
      id: "c-archived",
      state: "archived",
    });
    expect(inspect("activities", "act-hidden").inactiveAncestor).toMatchObject({
      table: "clients",
      id: "c-archived",
      state: "archived",
    });
    expect(inspect("allocations", "al-hidden-activity").inactiveAncestor).toMatchObject({
      table: "clients",
      id: "c-archived",
      state: "archived",
    });
    expect(inspect("allocations", "al-hidden-resource").inactiveAncestor).toMatchObject({
      table: "resources",
      id: "r-archived",
      state: "archived",
    });
    expect(inspect("timeOff", "to-hidden").inactiveAncestor).toMatchObject({
      table: "resources",
      id: "r-archived",
      state: "archived",
    });
    expect(inspect("allocations", "al1")).toEqual({ visible: true });
  });
};

const registerActiveOnlyTest7 = (): void => {
  it("does NOT mutate the input (deep-equal the original) and returns a NEW object", () => {
    const input = makeActiveOnlyData();
    const snapshot = structuredClone(input);
    const out = activeOnly(input);
    expect(input).toEqual(snapshot); // input deep-unchanged — every archived/deleted row still present
    expect(input.resources).toHaveLength(3);
    expect(input.clients).toHaveLength(3);
    expect(input.projects).toHaveLength(4);
    expect(out).not.toBe(input); // a fresh AppData reference
  });
};

const registerActiveOnlyTest8 = (): void => {
  it("an all-active dataset is preserved (every row kept, every table present)", () => {
    const input = makeActiveOnlyData();
    // Strip the non-active rows so everything left is active.
    input.resources = input.resources.filter((r) => r.id === "r-active");
    input.clients = input.clients.filter((c) => c.id === "c-active");
    input.projects = input.projects.filter((p) => p.id === "p-active");
    const out = activeOnly(input);
    expect(out.resources).toHaveLength(1);
    expect(out.clients).toHaveLength(1);
    expect(out.projects).toHaveLength(1);
    expect(Object.keys(out).sort()).toEqual(Object.keys(emptyAppData()).sort());
  });
};

const registerActiveOnlyTest9 = (): void => {
  it("an empty dataset projects to an empty dataset (no throw)", () => {
    const out = activeOnly(emptyAppData());
    expect(out.resources).toEqual([]);
    expect(out.clients).toEqual([]);
    expect(out.projects).toEqual([]);
  });
};

describe("activeOnly — VIEW/read projection that drops non-active resources/clients/projects (pure, immutable)", () => {
  registerActiveOnlyTest1();
  registerActiveOnlyTest2();
  registerActiveOnlyTest3();
  registerActiveOnlyTest4();
  registerActiveOnlyTest5();
  registerActiveOnlyTest6();
  registerActiveOnlyTest7();
  registerActiveOnlyTest8();
  registerActiveOnlyTest9();
});

const ARCHIVE_IMPACT_ACCOUNT = "acct-1";

const ARCHIVE_IMPACT_DATA: AppData = {
  ...emptyAppData(),
  accounts: [{ id: ARCHIVE_IMPACT_ACCOUNT, name: "Studio", color: "#3b82f6", createdAt: T_ARCH, updatedAt: T_ARCH }],
  resources: [
    {
      id: "r1",
      accountId: ARCHIVE_IMPACT_ACCOUNT,
      kind: "person",
      name: "R",
      role: "Dev",
      employmentType: "permanent",
      engagement: "studio" as const,
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5] as Weekday[],
      halfDays: [],
      color: "#3b82f6",
      createdAt: T_ARCH,
      updatedAt: T_ARCH,
    },
  ],
  clients: [
    { id: "c1", accountId: ARCHIVE_IMPACT_ACCOUNT, name: "C1", color: "#3b82f6", createdAt: T_ARCH, updatedAt: T_ARCH },
    {
      id: "c-empty",
      accountId: ARCHIVE_IMPACT_ACCOUNT,
      name: "Empty",
      color: "#3b82f6",
      createdAt: T_ARCH,
      updatedAt: T_ARCH,
    },
  ],
  projects: [
    {
      id: "p1",
      accountId: ARCHIVE_IMPACT_ACCOUNT,
      name: "P1",
      clientId: "c1",
      color: "#3b82f6",
      createdAt: T_ARCH,
      updatedAt: T_ARCH,
    },
  ],
  phases: [
    {
      id: "ph1",
      accountId: ARCHIVE_IMPACT_ACCOUNT,
      name: "Discovery",
      projectId: "p1",
      createdAt: T_ARCH,
      updatedAt: T_ARCH,
    },
  ],
  activities: [
    {
      id: "a1",
      accountId: ARCHIVE_IMPACT_ACCOUNT,
      name: "A1",
      kind: "project",
      projectId: "p1",
      createdAt: T_ARCH,
      updatedAt: T_ARCH,
    },
    {
      id: "internal",
      accountId: ARCHIVE_IMPACT_ACCOUNT,
      name: "Admin",
      kind: "internal",
      createdAt: T_ARCH,
      updatedAt: T_ARCH,
    },
  ],
  allocations: [
    {
      id: "al1",
      accountId: ARCHIVE_IMPACT_ACCOUNT,
      resourceId: "r1",
      activityId: "a1",
      startDate: "2026-01-01",
      endDate: "2026-01-05",
      hoursPerDay: 8,
      status: "confirmed",
      createdAt: T_ARCH,
      updatedAt: T_ARCH,
    },
    {
      id: "al-internal",
      accountId: ARCHIVE_IMPACT_ACCOUNT,
      resourceId: "r1",
      activityId: "internal",
      startDate: "2026-01-01",
      endDate: "2026-01-05",
      hoursPerDay: 8,
      status: "confirmed",
      createdAt: T_ARCH,
      updatedAt: T_ARCH,
    },
  ],
  timeOff: [
    {
      id: "to1",
      accountId: ARCHIVE_IMPACT_ACCOUNT,
      resourceId: "r1",
      startDate: "2026-02-01",
      endDate: "2026-02-03",
      type: "holiday",
      createdAt: T_ARCH,
      updatedAt: T_ARCH,
    },
  ],
};
const makeArchiveImpactData = (): AppData => structuredClone(ARCHIVE_IMPACT_DATA);

describe("archiveImpact", () => {
  it("counts a client’s active descendants: its projects + their project-activities + allocations", () => {
    // al-internal stays (its activity is internal, not under c1); to1 is a resource descendant.
    expect(archiveImpact(makeArchiveImpactData(), "clients", "c1")).toEqual({
      projects: 1,
      phases: 1,
      activities: 1,
      allocations: 1,
      timeOff: 0,
    });
  });

  it("reports zero descendants for an empty client", () => {
    expect(archiveImpact(makeArchiveImpactData(), "clients", "c-empty")).toEqual({
      projects: 0,
      phases: 0,
      activities: 0,
      allocations: 0,
      timeOff: 0,
    });
  });

  it.each([
    ["archived", { archivedAt: T_ARCH }, "already_inactive"],
    ["deleted", { archivedAt: T_ARCH, deletedAt: T_DEL }, "already_inactive"],
    ["missing", null, "invalid_transition"],
  ] as const)("fails loudly when the impact target is %s", (_state, tombstones, code) => {
    const input = makeArchiveImpactData();
    if (tombstones) {
      input.clients = input.clients.map((client) => (client.id === "c1" ? { ...client, ...tombstones } : client));
    }
    const id = tombstones ? "c1" : "not-there";

    expect(() => archiveImpact(input, "clients", id)).toThrow(
      expect.objectContaining({ name: "LifecycleTransitionError", code }),
    );
  });

  it("for a project: activities + allocations, and NEVER a self project count", () => {
    expect(archiveImpact(makeArchiveImpactData(), "projects", "p1")).toEqual({
      projects: 0,
      phases: 1,
      activities: 1,
      allocations: 1,
      timeOff: 0,
    });
  });

  it("for a resource: all its allocations (incl. the internal-activity one) + its time off", () => {
    expect(archiveImpact(makeArchiveImpactData(), "resources", "r1")).toEqual({
      projects: 0,
      phases: 0,
      activities: 0,
      allocations: 2,
      timeOff: 1,
    });
  });

  it("does NOT mutate the input", () => {
    const input = makeArchiveImpactData();
    const snapshot = structuredClone(input);
    archiveImpact(input, "clients", "c1");
    expect(input).toEqual(snapshot);
  });
});
