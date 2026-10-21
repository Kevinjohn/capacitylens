import { describe, it, expect } from "vitest";
import { migrate } from "./migrate";
import { seed } from "./seed";
import { serializeData, parseData } from "./transfer";
import {
  applyInternalClientRepairs,
  ensureInternalClients,
  internalClientFor,
  buildInternalClient,
  wouldAddSecondBuiltin,
  INTERNAL_CLIENT_NAME,
} from "./internalClient";
import { emptyAppData } from "../types/entities";
import type { Client } from "../types/entities";
import { activeOnly } from "../domain/lifecycle";

const TS = "2026-01-01T00:00:00.000Z";

function requiredInternalClient(clients: Client[], accountId: string): Client {
  const internal = internalClientFor(clients, accountId);
  if (internal === undefined) throw new Error(`Expected Internal client for ${accountId}`);
  return internal;
}

function registerSeedTests(): void {
  it("seed gives every account exactly one builtin Internal client", () => {
    const data = seed();
    for (const account of data.accounts) {
      const internal = data.clients.filter((c) => c.builtin === true && c.accountId === account.id);
      expect(internal).toHaveLength(1);
      expect(internal[0]?.name).toBe(INTERNAL_CLIENT_NAME);
    }
  });

  it("applyInternalClientRepairs adds one Internal per account that lacks one, and is idempotent", () => {
    const base = {
      ...emptyAppData(),
      accounts: [
        { id: "a1", createdAt: TS, updatedAt: TS, name: "A1", color: "#111111" },
        { id: "a2", createdAt: TS, updatedAt: TS, name: "A2", color: "#222222" },
      ],
    };
    const once = applyInternalClientRepairs(base, TS);
    expect(once.clients.filter((c) => c.builtin)).toHaveLength(2);
    expect(internalClientFor(once.clients, "a1")).toBeDefined();
    expect(internalClientFor(once.clients, "a2")).toBeDefined();
    const twice = applyInternalClientRepairs(once, TS);
    expect(twice).toBe(once);
    expect(twice.clients.filter((c) => c.builtin)).toHaveLength(2);
  });
}

function registerCorruptInputTests(): void {
  it("adds only one Internal when corrupt input repeats an account id, then converges", () => {
    const account = { id: "a1", createdAt: TS, updatedAt: TS, name: "A1", color: "#111111" };
    const base = {
      ...emptyAppData(),
      accounts: [account, { ...account, name: "Duplicate A1" }],
    };

    const once = applyInternalClientRepairs(base, TS);
    expect(once.clients.filter((client) => client.builtin && client.accountId === "a1")).toHaveLength(1);
    expect(once.clients[0]?.id).toBe("internal:a1");
    expect(ensureInternalClients(once, TS)).toBe(once);
  });

  it("uses a collision-free id when an ordinary client already owns the generated id", () => {
    const ordinary = {
      id: "internal:a1",
      accountId: "a1",
      createdAt: TS,
      updatedAt: TS,
      name: "Ordinary",
      color: "#111111",
    } as Client;
    const data = {
      ...emptyAppData(),
      accounts: [{ id: "a1", createdAt: TS, updatedAt: TS, name: "A1", color: "#111111" }],
      clients: [ordinary, { ...ordinary, id: "internal:a1:1", name: "Also ordinary" }],
    };

    const repaired = applyInternalClientRepairs(data, TS);

    expect(repaired.clients).toHaveLength(3);
    expect(new Set(repaired.clients.map(({ id }) => id)).size).toBe(3);
    expect(internalClientFor(repaired.clients, "a1")?.id).toBe("internal:a1:2");
    expect(repaired.clients).toContain(ordinary);
    expect(applyInternalClientRepairs(repaired, TS)).toBe(repaired);
  });
}

function registerDuplicateBuiltinTests(): void {
  it("deterministically folds duplicate builtins and rewires their projects", () => {
    const generated = { ...buildInternalClient("a1", TS), id: "internal:a1" };
    const duplicate: Client = {
      ...buildInternalClient("a1", "2025-01-01T00:00:00.000Z"),
      id: "legacy-internal",
    };
    const data = {
      ...emptyAppData(),
      accounts: [{ id: "a1", createdAt: TS, updatedAt: TS, name: "A1", color: "#111111" }],
      clients: [duplicate, generated],
      projects: [
        {
          id: "p1",
          accountId: "a1",
          clientId: duplicate.id,
          createdAt: TS,
          updatedAt: TS,
          name: "P",
          color: "#111111",
        },
      ],
    };

    const repaired = applyInternalClientRepairs(data, TS);

    expect(repaired.clients.filter((client) => client.builtin)).toEqual([generated]);
    expect(repaired.projects[0]?.clientId).toBe(generated.id);
    expect(repaired.projects[0]?.updatedAt).toBe("2026-01-01T00:00:00.001Z");
    expect(applyInternalClientRepairs(repaired, TS)).toBe(repaired);
  });
}

function registerSameIdDuplicateTests(): void {
  it("folds duplicate builtins that share the same primary id", () => {
    const retained = buildInternalClient("a1", TS);
    const duplicate = { ...retained, createdAt: "2026-01-02T00:00:00.000Z" };
    const data = {
      ...emptyAppData(),
      accounts: [{ id: "a1", createdAt: TS, updatedAt: TS, name: "A1", color: "#111111" }],
      clients: [retained, duplicate],
      projects: [
        {
          id: "p1",
          accountId: "a1",
          clientId: retained.id,
          createdAt: TS,
          updatedAt: TS,
          name: "P",
          color: "#111111",
        },
      ],
    };

    const repaired = applyInternalClientRepairs(data, TS);

    expect(repaired.clients).toEqual([retained]);
    expect(repaired.projects).toBe(data.projects);
    expect(applyInternalClientRepairs(repaired, TS)).toBe(repaired);
  });
}

function registerRepairRevisionTests(): void {
  it("bumps only rewired projects so updatedAt-based sync persists a duplicate fold", () => {
    const generated = buildInternalClient("a1", TS);
    const duplicate = { ...buildInternalClient("a1", TS), id: "legacy-internal" };
    const rewired = {
      id: "p1",
      accountId: "a1",
      clientId: duplicate.id,
      createdAt: TS,
      updatedAt: TS,
      name: "Rewired",
      color: "#111111",
    };
    const untouched = { ...rewired, id: "p2", clientId: generated.id, name: "Untouched" };

    const repaired = applyInternalClientRepairs(
      {
        ...emptyAppData(),
        accounts: [{ id: "a1", createdAt: TS, updatedAt: TS, name: "A1", color: "#111111" }],
        clients: [generated, duplicate],
        projects: [rewired, untouched],
      },
      TS,
    );

    expect(repaired.projects[0]).toMatchObject({ clientId: generated.id, updatedAt: "2026-01-01T00:00:00.001Z" });
    expect(repaired.projects[1]).toBe(untouched);
  });

  it("stamps a REPAIRED retained builtin with a fresh updatedAt so the repair persists", () => {
    // ServerSyncAdapter.diffOps detects changes solely by updatedAt, so a name/colour correction that
    // left updatedAt untouched would be re-applied in memory on every load yet never emit a PUT.
    const NOW = "2026-06-01T00:00:00.000Z";
    const data = {
      ...emptyAppData(),
      accounts: [{ id: "a1", createdAt: TS, updatedAt: TS, name: "A1", color: "#111111" }],
      clients: [
        {
          id: "internal:a1",
          accountId: "a1",
          createdAt: TS,
          updatedAt: TS,
          name: "JUNK NAME",
          color: "#000000",
          builtin: true,
        } as Client,
      ],
    };
    const internal = requiredInternalClient(applyInternalClientRepairs(data, NOW).clients, "a1");
    expect(internal.name).toBe(INTERNAL_CLIENT_NAME);
    expect(internal.updatedAt).toBe(NOW);
  });
}

function registerReactivationTests(): void {
  it.each([
    ["archived", { archivedAt: TS }],
    ["deleted", { archivedAt: TS, deletedAt: "2026-01-02T00:00:00.000Z" }],
  ] as const)("reactivates a retained %s built-in Internal client", (_state, tombstones) => {
    const internal = { ...buildInternalClient("a1", TS), ...tombstones };
    const data = {
      ...emptyAppData(),
      accounts: [{ id: "a1", createdAt: TS, updatedAt: TS, name: "A1", color: "#111111" }],
      clients: [internal],
    };

    const repaired = applyInternalClientRepairs(data, TS);
    const retained = requiredInternalClient(repaired.clients, "a1");

    expect(repaired).not.toBe(data);
    expect(retained).not.toHaveProperty("archivedAt");
    expect(retained).not.toHaveProperty("deletedAt");
    expect(retained.updatedAt).toBe("2026-01-01T00:00:00.001Z");
    expect(activeOnly(repaired).clients).toEqual([retained]);
  });

  it("forces a distinct, non-decreasing revision when the repair clock is equal or older", () => {
    const repair = (updatedAt: string, now: string) => {
      const data = {
        ...emptyAppData(),
        accounts: [{ id: "a1", createdAt: TS, updatedAt: TS, name: "A1", color: "#111111" }],
        clients: [
          {
            id: "internal:a1",
            accountId: "a1",
            createdAt: TS,
            updatedAt,
            name: "JUNK NAME",
            color: "#000000",
            builtin: true,
          } as Client,
        ],
      };
      return requiredInternalClient(applyInternalClientRepairs(data, now).clients, "a1").updatedAt;
    };

    expect(repair(TS, TS)).toBe("2026-01-01T00:00:00.001Z");
    expect(repair("2027-01-01T00:00:00.000Z", TS)).toBe("2027-01-01T00:00:00.001Z");
  });
}

function registerRepairBoundaryTests(): void {
  it("refuses a repair that cannot advance within the supported timestamp domain", () => {
    const maximum = "9999-12-31T23:59:59.999Z";
    const data = {
      ...emptyAppData(),
      accounts: [{ id: "a1", createdAt: TS, updatedAt: TS, name: "A1", color: "#111111" }],
      clients: [
        {
          ...buildInternalClient("a1", TS),
          name: "Damaged",
          updatedAt: maximum,
        },
      ],
    };

    expect(() => applyInternalClientRepairs(data, TS)).toThrow(
      new RangeError("Internal-client repair cannot advance beyond the supported four-digit ISO timestamp range."),
    );
    expect(data.clients[0]).toMatchObject({ name: "Damaged", updatedAt: maximum });
  });

  it("leaves an already-canonical retained builtin updatedAt untouched (no phantom-write churn)", () => {
    const NOW = "2026-06-01T00:00:00.000Z";
    const data = {
      ...emptyAppData(),
      // a1 is canonical; a2 lacks a builtin, forcing the function past its no-op early return so the
      // retain/restamp map actually runs over a1.
      accounts: [
        { id: "a1", createdAt: TS, updatedAt: TS, name: "A1", color: "#111111" },
        { id: "a2", createdAt: TS, updatedAt: TS, name: "A2", color: "#222222" },
      ],
      clients: [buildInternalClient("a1", TS)],
    };
    const repaired = applyInternalClientRepairs(data, NOW);
    expect(internalClientFor(repaired.clients, "a2")).toBeDefined();
    expect(requiredInternalClient(repaired.clients, "a1").updatedAt).toBe(TS);
  });
}

function registerMigrationTests(): void {
  it("migrate (v5→v6) backfills one Internal per account, idempotently and without duplicating a pre-existing one", () => {
    const blob = {
      schemaVersion: 5,
      data: {
        accounts: [
          { id: "a1", createdAt: TS, updatedAt: TS, name: "A1", color: "#111111" },
          { id: "a2", createdAt: TS, updatedAt: TS, name: "A2", color: "#222222" },
        ],
        // a1 already has a builtin Internal (must not be duplicated); a2 has none.
        clients: [
          {
            id: "pre-internal",
            accountId: "a1",
            createdAt: TS,
            updatedAt: TS,
            name: "Internal",
            color: "#9c3ace",
            builtin: true,
          },
          { id: "acme", accountId: "a1", createdAt: TS, updatedAt: TS, name: "Ferris", color: "#ef4444" },
        ],
      },
    };
    const out = migrate(blob);
    expect(out.clients.filter((c) => c.builtin && c.accountId === "a1")).toHaveLength(1);
    expect(internalClientFor(out.clients, "a1")?.id).toBe("pre-internal");
    expect(out.clients.filter((c) => c.builtin && c.accountId === "a2")).toHaveLength(1);
    const again = migrate({ schemaVersion: 6, data: out });
    expect(again.clients.filter((c) => c.builtin)).toHaveLength(2);
  });

  it("migrate does NOT add Internal clients to an account-less import slice", () => {
    const out = migrate({
      schemaVersion: 5,
      data: {
        accounts: [],
        clients: [{ id: "c1", accountId: "a1", createdAt: TS, updatedAt: TS, name: "A", color: "#1" }],
      },
    });
    expect(out.clients.filter((c) => c.builtin)).toHaveLength(0);
  });

  it("seed round-trips deep-equal through serialize → parse (migrate stays idempotent at the current version)", () => {
    const data = seed();
    expect(parseData(serializeData(data))).toEqual(data);
  });
}

function registerPublicPredicateTests(): void {
  it("buildInternalClient uses the deterministic id and reserved name/colour with builtin:true", () => {
    const c = buildInternalClient("a9", TS);
    expect(c).toMatchObject({ accountId: "a9", name: INTERNAL_CLIENT_NAME, builtin: true });
    expect(c.id).toBe("internal:a9");
  });

  // A client write must reject a second built-in client in the same account while allowing updates to the existing one.
  it("wouldAddSecondBuiltin: reproduces the server reject check byte-for-byte", () => {
    const existing: Client = {
      id: "c-int",
      accountId: "a1",
      createdAt: TS,
      updatedAt: TS,
      name: "Internal",
      color: "#9c3ace",
      builtin: true,
    };
    const clients = [existing];
    expect(wouldAddSecondBuiltin([], "a1", "c-int")).toBe(false);
    expect(wouldAddSecondBuiltin(clients, "a1", "c-int2")).toBe(true);
    expect(wouldAddSecondBuiltin(clients, "a1", "c-int")).toBe(false);
    expect(wouldAddSecondBuiltin(clients, "a2", "c-int-2")).toBe(false);
  });
}

describe("built-in Internal client", () => {
  registerSeedTests();
  registerCorruptInputTests();
  registerDuplicateBuiltinTests();
  registerSameIdDuplicateTests();
  registerRepairRevisionTests();
  registerReactivationTests();
  registerRepairBoundaryTests();
  registerMigrationTests();
  registerPublicPredicateTests();
});
