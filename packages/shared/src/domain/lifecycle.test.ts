import { NULLABLE_FIELDS } from "../types/nullableFields.js";
import { describe, it, expect } from "vitest";
import {
  lifecycleStatus,
  canArchive,
  canUnarchive,
  archive,
  unarchive,
  obfuscateResource,
  isLifecycleEntityKey,
  LifecycleTransitionError,
  LIFECYCLE_ENTITY_KEYS,
} from "@capacitylens/shared/domain/lifecycle";
import type { LifecycleState, LifecycleFields } from "@capacitylens/shared/domain/lifecycle";
import type { Resource } from "../types/entities.js";

// These tests are an independent oracle of the lifecycle state machine: the expected states /
// booleans below are hand-derived from the contract (deletedAt wins; archive needs active;
// unarchive needs archived), not copied from the
// implementation. If lifecycle.ts and these tables disagree, that's the test doing its job.

// Fixed ISO consts so every assertion is deterministic (no ambient clock anywhere in the machine).
const T_ARCH = "2026-01-01T00:00:00.000Z";
const T_DEL = "2026-02-01T00:00:00.000Z";

describe("lifecycle vocabulary", () => {
  it("is immutable and keeps the narrowing guard closed", () => {
    expect(Object.isFrozen(LIFECYCLE_ENTITY_KEYS)).toBe(true);
    expect(() => (LIFECYCLE_ENTITY_KEYS as unknown as string[]).push("allocations")).toThrow();
    expect(isLifecycleEntityKey("activities")).toBe(true);
    expect(isLifecycleEntityKey("allocations")).toBe(false);
  });
});
// An arbitrary "now" used for archive/softDelete timestamps.
const NOW = "2026-06-01T00:00:00.000Z";

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
    // Capture the failure so the test can assert its typed lifecycle classification.
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

describe.each([["canUnarchive", canUnarchive]] as const)(
  "%s — public archived-state affordance",
  (_name, predicate) => {
    it.each([
      ["active", makeActive(), false],
      ["archived", makeArchived(), true],
      ["deleted", makeDeleted(), false],
    ] as const)("returns the documented result for %s", (_state, sample, expected) => {
      expect(predicate(sample)).toBe(expected);
    });
  },
);

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
    expect(result.deletedAt).toBeNull();
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

describe("unarchive — archived → active (clears archivedAt to null, immutable, fail-loud)", () => {
  it("from archived: archivedAt is null, status active", () => {
    const input = makeArchived();
    const result = unarchive(input);
    expect(result.archivedAt).toBeNull();
    expect(result.deletedAt).toBeNull();
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
    expect(result.archivedAt).toBeNull();
    expect(result.deletedAt).toBeNull();
    expect(lifecycleStatus(result)).toBe("active");
  });
});

describe("isLifecycleEntityKey — narrowing guard for the tombstone-carrying tables", () => {
  it("is TRUE for exactly resources/clients/projects/activities", () => {
    expect(isLifecycleEntityKey("resources")).toBe(true);
    expect(isLifecycleEntityKey("clients")).toBe(true);
    expect(isLifecycleEntityKey("projects")).toBe(true);
    expect(isLifecycleEntityKey("activities")).toBe(true);
  });
  it("is FALSE for every non-lifecycle table (they carry no archivedAt/deletedAt)", () => {
    expect(isLifecycleEntityKey("phases")).toBe(false);
    expect(isLifecycleEntityKey("allocations")).toBe(false);
    expect(isLifecycleEntityKey("timeOff")).toBe(false);
    expect(isLifecycleEntityKey("disciplines")).toBe(false);
    expect(isLifecycleEntityKey("accounts")).toBe(false);
    expect(isLifecycleEntityKey("nonsense")).toBe(false);
  });
});

// A full, valid sample Resource so the preservation assertions check the real field set. The
// id's leading hex ('a1b2') is the source of the deterministic token tag. Each call returns a
// fresh object (including its own weekday arrays) so the immutability checks aren't fooled by aliasing.
const RESOURCE_BASE: Resource = {
  ...NULLABLE_FIELDS.resources,
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
    expect(input).toEqual(snapshot);
    expect(input.name).toBe("Ada Lovelace");
    expect(result).not.toBe(input);
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
    nameless.name = null;
    const result = obfuscateResource(nameless);
    expect(result.name).toBeDefined();
    expect(result.name?.startsWith("Removed person #")).toBe(true);
    expect(result.name).not.toBe("Removed person #");
  });

  it("handles an EXTERNAL resource: the COMPANY name is gone, replaced by the token", () => {
    const result = obfuscateResource(makeResource({ kind: "external", name: "Ferris Print Co" }));
    expect(result.name).not.toContain("Ferris");
    expect(result.name?.startsWith("Removed person #")).toBe(true);
  });

  it("never leaves a bare 'Removed person #' — the tag is non-empty for a normal UUID id", () => {
    const result = obfuscateResource(makeResource());
    const tag = result.name?.replace("Removed person #", "");
    expect(tag).toBe("a1b2c3d40000");
    expect(tag?.length).toBeGreaterThan(0);
  });

  // ANON_FALLBACK_TAG branch of shortResourceTag(id): when the id yields no alphanumerics to
  // derive a tag from, the token falls back to the documented '0000' rather than leaving a bare
  // 'Removed person #'. Both an empty id and an all-punctuation id must hit that same fallback.
  it("empty id ⇒ fallback tag '0000' (no alphanumerics to derive from)", () => {
    expect(obfuscateResource(makeResource({ id: "" })).name).toBe("Removed person #0000");
  });

  it("id with only non-alphanumerics ('----') ⇒ fallback tag '0000'", () => {
    expect(obfuscateResource(makeResource({ id: "----" })).name).toBe("Removed person #0000");
  });
});
