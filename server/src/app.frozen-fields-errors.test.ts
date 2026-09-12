import { describe, it, expect, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp, resolveErrorStatus } from "./app";
import { ValidationError } from "./validate";
import { openDb } from "./db";
import { freshApp, account } from "./fixtures/appTestEntities";
import { call, body, post, put, patch, batch } from "./fixtures/appTestHttp";
import { readStateAccount } from "./fixtures/appTestScaffold";

// Seed an account carrying all three frozen fields (so a change is detectable).
const FROZEN = {
  weekStartsOn: 1 as const,
  timezone: "Etc/GMT",
  language: "en",
};

async function seedFrozen(app: FastifyInstance) {
  expect((await post(app, "accounts", { ...account("a1"), ...FROZEN })).statusCode).toBe(201);
}

function createFrozenFieldPatchTests(): void {
  it("PATCH changing weekStartsOn → 409", async () => {
    const { app } = freshApp();
    await seedFrozen(app);
    const res = await patch({ app, entity: "accounts", id: "a1", payload: { weekStartsOn: 0 } });
    expect(res.statusCode).toBe(409);
    expect((await readStateAccount(app)).weekStartsOn).toBe(1); // unchanged
  });

  it("PATCH changing timezone → 409", async () => {
    const { app } = freshApp();
    await seedFrozen(app);
    expect(
      (await patch({ app, entity: "accounts", id: "a1", payload: { timezone: "Europe/London" } })).statusCode,
    ).toBe(409);
    expect((await readStateAccount(app)).timezone).toBe("Etc/GMT");
  });

  it("PATCH with an unsupported language is sanitised to an unchanged no-op", async () => {
    const { app } = freshApp();
    await seedFrozen(app);
    expect((await patch({ app, entity: "accounts", id: "a1", payload: { language: "fr" } })).statusCode).toBe(200);
    expect((await readStateAccount(app)).language).toBe("en");
  });
}

function createFrozenFieldPutTests(): void {
  it("PUT resending the row with a CHANGED frozen field → 409", async () => {
    const { app } = freshApp();
    await seedFrozen(app);
    const res = await put({
      app,
      entity: "accounts",
      id: "a1",
      payload: {
        ...account("a1"),
        ...FROZEN,
        weekStartsOn: 0,
      },
    });
    expect(res.statusCode).toBe(409);
    expect((await readStateAccount(app)).weekStartsOn).toBe(1);
  });

  it("an UNCHANGED PUT of the frozen fields → 200 (change-not-presence)", async () => {
    const { app } = freshApp();
    await seedFrozen(app);
    // The sync adapter re-sends the WHOLE row on any edit (e.g. a rename) — an unchanged
    // frozen value present in the body must PASS.
    const res = await put({
      app,
      entity: "accounts",
      id: "a1",
      payload: {
        ...account("a1"),
        ...FROZEN,
        name: "Renamed",
      },
    });
    expect(res.statusCode).toBe(200);
    expect((await readStateAccount(app)).name).toBe("Renamed");
  });

  it("an UNCHANGED PATCH of a frozen field → 200", async () => {
    const { app } = freshApp();
    await seedFrozen(app);
    expect((await patch({ app, entity: "accounts", id: "a1", payload: { weekStartsOn: 1 } })).statusCode).toBe(200);
  });
}

function createFrozenFieldInitializationTest(): void {
  it("lets a minimal /api/orgs account set each missing frozen field once", async () => {
    const { app } = freshApp();
    expect(
      (
        await call(app, {
          method: "POST",
          url: "/api/orgs",
          payload: body({ id: "a1", name: "Studio" }),
        })
      ).statusCode,
    ).toBe(201);

    expect(
      (
        await patch({
          app,
          entity: "accounts",
          id: "a1",
          payload: {
            weekStartsOn: 0,
            timezone: "Europe/London",
            language: "en",
          },
        })
      ).statusCode,
    ).toBe(200);
    expect((await patch({ app, entity: "accounts", id: "a1", payload: { timezone: "Etc/GMT" } })).statusCode).toBe(409);

    const stored = await readStateAccount(app);
    expect(stored).toMatchObject({
      weekStartsOn: 0,
      timezone: "Europe/London",
      language: "en",
    });
  });
}

function createFrozenFieldSanitizationTest(): void {
  it("treats sanitiser-dropped frozen values as no-ops across PUT, PATCH and batch", async () => {
    const { app } = freshApp();
    await seedFrozen(app);

    expect(
      (
        await patch({
          app,
          entity: "accounts",
          id: "a1",
          payload: {
            language: "fr",
            timezone: "Mars/Olympus",
            weekStartsOn: 2,
          },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await put({
          app,
          entity: "accounts",
          id: "a1",
          payload: {
            ...account("a1"),
            ...FROZEN,
            language: 123,
            timezone: null,
            weekStartsOn: -1,
          },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await batch(app, [
          {
            method: "PUT",
            table: "accounts",
            id: "a1",
            row: {
              ...account("a1"),
              ...FROZEN,
              language: "cy",
              timezone: "invalid",
              weekStartsOn: 7,
            },
          },
        ])
      ).statusCode,
    ).toBe(200);

    expect(await readStateAccount(app)).toMatchObject(FROZEN);
  });
}

function createFrozenFieldPreferenceAndBatchTests(): void {
  it("PATCH mutable account preferences, including engagement grouping", async () => {
    const { app } = freshApp();
    await seedFrozen(app);
    expect((await patch({ app, entity: "accounts", id: "a1", payload: { name: "New Name" } })).statusCode).toBe(200);
    expect((await patch({ app, entity: "accounts", id: "a1", payload: { disciplinesEnabled: true } })).statusCode).toBe(
      200,
    );
    expect(
      (await patch({ app, entity: "accounts", id: "a1", payload: { groupResourcesByEngagement: false } })).statusCode,
    ).toBe(200);
    expect((await patch({ app, entity: "accounts", id: "a1", payload: { schedulingMode: "blocks" } })).statusCode).toBe(
      200,
    );
    expect((await readStateAccount(app)).groupResourcesByEngagement).toBe(false);
  });

  it("a batch PUT changing a frozen field returns the same reloadable 409 as direct writes", async () => {
    const { app } = freshApp();
    await seedFrozen(app);
    // Documented asymmetry: the batch maps a ValidationError to 400 (vs the per-route 409).
    const res = await batch(app, [
      {
        method: "PUT",
        table: "accounts",
        id: "a1",
        row: { ...account("a1"), ...FROZEN, timezone: "Europe/London" },
      },
    ]);
    expect(res.statusCode).toBe(409);
    expect((await readStateAccount(app)).timezone).toBe("Etc/GMT"); // tx rolled back
  });
}

describe("account frozen fields (P1.14): language / weekStartsOn / timezone", () => {
  createFrozenFieldPatchTests();
  createFrozenFieldPutTests();
  createFrozenFieldInitializationTest();
  createFrozenFieldSanitizationTest();
  createFrozenFieldPreferenceAndBatchTests();
});

function createErrorStatusMappingTest() {
  it("maps validation + constraint errors to 400 and unexpected errors to 500", () => {
    expect(resolveErrorStatus(new ValidationError("bad ref"))).toBe(400);
    expect(
      resolveErrorStatus(
        Object.assign(new Error("FOREIGN KEY constraint failed"), {
          code: "ERR_SQLITE_ERROR",
          errcode: 787,
        }),
      ),
    ).toBe(400);
    expect(
      resolveErrorStatus(
        Object.assign(new Error("NOT NULL constraint failed: resources.role"), {
          code: "ERR_SQLITE_ERROR",
          errcode: 1299,
        }),
      ),
    ).toBe(400);
    expect(
      resolveErrorStatus(
        Object.assign(new Error("forced erasure failure"), {
          code: "ERR_SQLITE_ERROR",
          errcode: 1811,
        }),
      ),
    ).toBe(500);
    expect(resolveErrorStatus(new Error("upstream constraint failed unexpectedly"))).toBe(500);
    expect(resolveErrorStatus(new Error("something unexpected blew up"))).toBe(500);
    expect(resolveErrorStatus("a string")).toBe(500);
  });
}

describe("error status mapping (statusFor)", () => {
  createErrorStatusMappingTest();
  // PINNING TEST: these trigger real node:sqlite violations so the classifier stays tied to the
  // runtime's structured error metadata for each supported row-data constraint family.
  describe("pins node:sqlite constraint metadata on real violations", () => {
    const grab = (fn: () => void): Error => {
      try {
        fn();
      } catch (e) {
        return e as Error;
      }
      throw new Error("expected a constraint violation, but none was thrown");
    };

    const expectConstraint = (error: Error): void => {
      expect(error).toMatchObject({ code: "ERR_SQLITE_ERROR" });
      expect((error as Error & { errcode: number }).errcode & 0xff).toBe(19);
      expect(resolveErrorStatus(error)).toBe(400);
    };

    it("maps a real NOT NULL violation to 400", () => {
      const db = openDb(":memory:");
      const e = grab(() =>
        db.exec(`INSERT INTO accounts (id, name, color, createdAt, updatedAt) VALUES ('a', NULL, '#fff', 't', 't')`),
      );
      expectConstraint(e);
    });

    it("maps a real UNIQUE/PRIMARY KEY violation to 400", () => {
      const db = openDb(":memory:");
      db.exec(`INSERT INTO accounts (id, name, color, createdAt, updatedAt) VALUES ('a', 'Studio', '#fff', 't', 't')`);
      const e = grab(() =>
        db.exec(`INSERT INTO accounts (id, name, color, createdAt, updatedAt) VALUES ('a', 'Dup', '#fff', 't', 't')`),
      );
      expectConstraint(e);
    });

    it("maps a real FOREIGN KEY violation to 400", () => {
      const db = openDb(":memory:"); // openDb turns foreign_keys ON
      const e = grab(() =>
        db.exec(
          `INSERT INTO clients (id, accountId, name, color, createdAt, updatedAt) VALUES ('c', 'no-such-account', 'Acme', '#fff', 't', 't')`,
        ),
      );
      expectConstraint(e);
    });
  });
});

describe("global error redaction", () => {
  it("does not trust an arbitrary sub-500 statusCode as proof that its message is public", async () => {
    const app = createApp(openDb(":memory:"));
    const sentinel = "PRIVATE schema path /srv/capacitylens.db clients.color";
    const cause = Object.assign(new Error(sentinel), { statusCode: 400 });
    const constraintPhraseCause = new Error("upstream constraint failed unexpectedly");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    app.get("/api/test/decorated-client-error", () => {
      throw cause;
    });
    app.get("/api/test/spoofed-framework-error", () => {
      throw Object.assign(new Error(sentinel), {
        code: "FST_ERR_CTP_BODY_TOO_LARGE",
        statusCode: 413,
      });
    });
    app.get("/api/test/non-sqlite-constraint-phrase", () => {
      throw constraintPhraseCause;
    });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/test/decorated-client-error",
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: "Internal server error" });
      expect(response.body).not.toContain(sentinel);
      expect(consoleError).toHaveBeenCalledWith(cause);

      const spoofed = await app.inject({
        method: "GET",
        url: "/api/test/spoofed-framework-error",
      });
      expect(spoofed.statusCode).toBe(413);
      expect(spoofed.json()).toEqual({ error: "Request body is too large" });
      expect(spoofed.body).not.toContain(sentinel);

      consoleError.mockClear();
      const unrelated = await app.inject({
        method: "GET",
        url: "/api/test/non-sqlite-constraint-phrase",
      });
      expect(unrelated.statusCode).toBe(500);
      expect(unrelated.json()).toEqual({ error: "Internal server error" });
      expect(unrelated.body).not.toContain(constraintPhraseCause.message);
      expect(consoleError).toHaveBeenCalledWith(constraintPhraseCause);
    } finally {
      consoleError.mockRestore();
    }
  });
});
