import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import { insertRow, openDb } from "./db";
import { isIsoInstant } from "@capacitylens/shared/account/types";
import { account, client } from "./fixtures/appTestEntities";
import { readErrorResponse, post, put, patch, batch } from "./fixtures/appTestHttp";
import {
  readFirstClient,
  readFirstClientName,
  readClientIds,
  readClientResponse,
  readConflictResponse,
  readBatchReceipt,
  readValidatedState,
} from "./fixtures/appTestSnapshotBatch";

function createDirectPutConcurrencyTests(): void {
  it("rejects a stale PUT with 409 when enabled; allows same/newer", async () => {
    const app = createApp(openDb(":memory:"), { optimisticConcurrency: true });
    await post(app, "accounts", account("a1"));
    // Store a client at T2.
    const created = await put({
      app,
      entity: "clients",
      id: "c1",
      payload: {
        ...client("c1", "a1"),
        updatedAt: "2026-02-02T00:00:00.000Z",
      },
    });
    // A PUT carrying an OLDER updatedAt (T1) is a stale overwrite → 409.
    const stale = await put({
      app,
      entity: "clients",
      id: "c1",
      payload: {
        ...client("c1", "a1"),
        name: "Stale",
        updatedAt: "2026-02-01T00:00:00.000Z",
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(readFirstClientName((await readValidatedState(app)).clients)).toBe("Acme"); // not overwritten
    // A PUT at a newer time succeeds.
    const fresh = await put({
      app,
      entity: "clients",
      id: "c1",
      payload: {
        ...client("c1", "a1"),
        name: "Fresh",
        updatedAt: readClientResponse(created).updatedAt,
      },
    });
    expect(fresh.statusCode).toBe(200);
    expect(readFirstClientName((await readValidatedState(app)).clients)).toBe("Fresh");
  });
}

function createDirectPatchConcurrencyTests(): void {
  it("rejects a stale PATCH and accepts one carrying the current server revision", async () => {
    const app = createApp(openDb(":memory:"), { optimisticConcurrency: true });
    await post(app, "accounts", account("a1"));
    const created = await put({ app, entity: "clients", id: "c1", payload: client("c1", "a1") });
    const stale = await patch({
      app,
      entity: "clients",
      id: "c1",
      payload: {
        name: "Stale",
        updatedAt: "2000-01-01T00:00:00.000Z",
      },
    });
    expect(stale.statusCode).toBe(409);
    const fresh = await patch({
      app,
      entity: "clients",
      id: "c1",
      payload: {
        name: "Fresh",
        updatedAt: readClientResponse(created).updatedAt,
      },
    });
    expect(fresh.statusCode).toBe(200);
    expect(readClientResponse(fresh).name).toBe("Fresh");
    expect(Date.parse(readClientResponse(fresh).updatedAt)).not.toBeNaN();
  });
}

function createConcurrencyOptOutTests(): void {
  it("can be explicitly disabled for a trusted single-writer deployment", async () => {
    const app = createApp(openDb(":memory:"), { optimisticConcurrency: false });
    await post(app, "accounts", account("a1"));
    await put({
      app,
      entity: "clients",
      id: "c1",
      payload: {
        ...client("c1", "a1"),
        updatedAt: "2026-02-02T00:00:00.000Z",
      },
    });
    const stale = await put({
      app,
      entity: "clients",
      id: "c1",
      payload: {
        ...client("c1", "a1"),
        name: "Stale",
        updatedAt: "2026-02-01T00:00:00.000Z",
      },
    });
    expect(stale.statusCode).toBe(200);
    expect(readFirstClientName((await readValidatedState(app)).clients)).toBe("Stale");
  });
}

function createBatchStalePutConcurrencyTests(): void {
  // The batch PUT branch applies the SAME stale-write refusal as the direct PUT (it previously
  // had none — a stale client batch could silently overwrite newer server rows even with the flag
  // on). The 409 carries the stored row as `current`, and — the batch being one tx — rolls the
  // WHOLE batch back, sibling ops included.
  it("batch: rejects a stale PUT op with 409 + current when enabled, rolling back the WHOLE batch", async () => {
    const app = createApp(openDb(":memory:"), { optimisticConcurrency: true });
    await post(app, "accounts", account("a1"));
    const created = await put({
      app,
      entity: "clients",
      id: "c1",
      payload: {
        ...client("c1", "a1"),
        updatedAt: "2026-02-02T00:00:00.000Z",
      },
    });
    const res = await batch(app, [
      // A fresh sibling op that would succeed alone — it must NOT survive the rollback.
      {
        method: "PUT",
        table: "clients",
        id: "c2",
        row: { ...client("c2", "a1"), updatedAt: "2026-02-03T00:00:00.000Z" },
      },
      // The stale op: older updatedAt than the stored row → conflict.
      {
        method: "PUT",
        table: "clients",
        id: "c1",
        row: {
          ...client("c1", "a1"),
          name: "Stale",
          updatedAt: "2026-02-01T00:00:00.000Z",
        },
      },
    ]);
    expect(res.statusCode).toBe(409);
    // The direct PUT route's exact conflict shape: a message + the stored row for client re-sync.
    expect(readConflictResponse(res).error).toBe("The record was modified more recently on the server.");
    expect(readConflictResponse(res).current).toMatchObject({
      id: "c1",
      name: "Acme",
      updatedAt: readClientResponse(created).updatedAt,
    });
    const s = await readValidatedState(app);
    expect(readClientIds(s.clients)).toEqual(["c1"]); // c2 rolled back with the batch
    expect(readFirstClientName(s.clients)).toBe("Acme"); // c1 not overwritten
  });
}

function createBatchFreshPutConcurrencyTests(): void {
  it("batch: a fresh (same/newer updatedAt) PUT op passes with the flag on", async () => {
    const app = createApp(openDb(":memory:"), { optimisticConcurrency: true });
    await post(app, "accounts", account("a1"));
    const created = await put({
      app,
      entity: "clients",
      id: "c1",
      payload: {
        ...client("c1", "a1"),
        updatedAt: "2026-02-02T00:00:00.000Z",
      },
    });
    const res = await batch(app, [
      {
        method: "PUT",
        table: "clients",
        id: "c1",
        row: {
          ...client("c1", "a1"),
          name: "Fresh",
          updatedAt: readClientResponse(created).updatedAt,
        },
      },
    ]);
    expect(res.statusCode).toBe(200);
    const revisions = readBatchReceipt(res).revisions;
    expect(revisions).toHaveLength(1);
    const [revision] = revisions;
    if (!revision) throw new Error("Expected the batch response to contain a revision.");
    const persisted = readFirstClient((await readValidatedState(app)).clients);
    expect(revision).toEqual({
      table: "clients",
      id: "c1",
      createdAt: persisted.createdAt,
      updatedAt: persisted.updatedAt,
    });
    expect(isIsoInstant(revision.createdAt)).toBe(true);
    expect(isIsoInstant(revision.updatedAt)).toBe(true);
    expect(persisted.name).toBe("Fresh");
  });
}

function createMissingRevisionConcurrencyTests(): void {
  it("rejects existing-row PUTs that omit the required revision precondition", async () => {
    const app = createApp(openDb(":memory:"), { optimisticConcurrency: true });
    await post(app, "accounts", account("a1"));
    await put({
      app,
      entity: "clients",
      id: "c1",
      payload: {
        ...client("c1", "a1"),
        updatedAt: "2026-02-02T00:00:00.000Z",
      },
    });
    const noStamp: Record<string, unknown> = { ...client("c1", "a1") };
    delete noStamp.updatedAt;
    const viaBatch = await batch(app, [
      {
        method: "PUT",
        table: "clients",
        id: "c1",
        row: { ...noStamp, name: "NoStamp" },
      },
    ]);
    const viaPut = await put({
      app,
      entity: "clients",
      id: "c1",
      payload: {
        ...noStamp,
        name: "NoStamp",
      },
    });
    expect(viaBatch.statusCode).toBe(viaPut.statusCode);
    expect(viaBatch.statusCode).toBe(409);
    expect(readFirstClientName((await readValidatedState(app)).clients)).toBe("Acme");
  });
}

function createFutureRevisionConcurrencyTests(): void {
  it("rejects a future-authored revision instead of treating it as fresher than the server", async () => {
    const app = createApp(openDb(":memory:"), { optimisticConcurrency: true });
    await post(app, "accounts", account("a1"));
    await put({ app, entity: "clients", id: "c1", payload: client("c1", "a1") });

    const res = await put({
      app,
      entity: "clients",
      id: "c1",
      payload: {
        ...client("c1", "a1"),
        name: "Future overwrite",
        updatedAt: "9999-12-31T23:59:59.999Z",
      },
    });

    expect(res.statusCode).toBe(409);
    expect(readFirstClientName((await readValidatedState(app)).clients)).toBe("Acme");
  });
}

function createPartialPatchConcurrencyTests(): void {
  it("accepts a partial PATCH that omits updatedAt (a normal partial edit is never a 409)", async () => {
    // The PATCH route calls isStaleWrite unconditionally; a partial PATCH legitimately omits
    // updatedAt, so it must NOT be treated as a stale conflict — otherwise every ordinary partial
    // edit 409s. Restored documented semantics: no incoming updatedAt ⇒ no basis for a conflict.
    const app = createApp(openDb(":memory:"), { optimisticConcurrency: true });
    await post(app, "accounts", account("a1"));
    await put({ app, entity: "clients", id: "c1", payload: client("c1", "a1") });
    const res = await patch({ app, entity: "clients", id: "c1", payload: { name: "Renamed" } });
    expect(res.statusCode).toBe(200);
    expect(readClientResponse(res).name).toBe("Renamed");
    expect(Date.parse(readClientResponse(res).updatedAt)).not.toBeNaN();
  });
}

function createNullPatchConcurrencyTests(): void {
  it("rejects null for a required PATCH field without rewriting the stored value", async () => {
    const app = createApp(openDb(":memory:"));
    await post(app, "accounts", account("a1"));
    await put({ app, entity: "clients", id: "c1", payload: client("c1", "a1") });

    const res = await patch({ app, entity: "clients", id: "c1", payload: { name: null } });

    expect(res.statusCode).toBe(400);
    expect(readErrorResponse(res).error).toMatch(/required field.*cannot be null/i);
    expect(readFirstClientName((await readValidatedState(app)).clients)).toBe("Acme");
  });
}

function createUnparseableStoredRevisionTests(): void {
  it("keeps writing to a row whose STORED updatedAt is unparseable (never write-bricked)", async () => {
    // Regression: the inverted predicate returned "stale" whenever a timestamp failed to parse, so a
    // row with a corrupt/legacy stored updatedAt 409'd on EVERY write — permanently unrecoverable.
    // With the fix an unparseable stored side is simply "no basis for a conflict", so the write
    // proceeds and the server re-stamps a fresh valid updatedAt.
    const db = openDb(":memory:");
    const app = createApp(db, { optimisticConcurrency: true });
    insertRow(db, "accounts", account("a1"));
    insertRow(db, "clients", {
      ...client("c1", "a1"),
      updatedAt: "not-a-real-timestamp",
    });
    const res = await patch({
      app,
      entity: "clients",
      id: "c1",
      payload: {
        name: "Recovered",
        updatedAt: "2026-03-01T00:00:00.000Z",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(readClientResponse(res).name).toBe("Recovered");
    expect(Date.parse(readClientResponse(res).updatedAt)).not.toBeNaN();
  });
}

function createUnincrementableStoredRevisionTests(): void {
  it.each(["9999-12-31T23:59:59.999Z", "+010000-01-01T00:00:00.000Z", "+275760-09-13T00:00:00.000Z"])(
    "repairs an unincrementable or expanded stored revision through the API: %s",
    async (storedRevision) => {
      const db = openDb(":memory:");
      const app = createApp(db, { optimisticConcurrency: false });
      insertRow(db, "accounts", account("a1"));
      insertRow(db, "clients", { ...client("c1", "a1"), updatedAt: storedRevision });

      const res = await patch({ app, entity: "clients", id: "c1", payload: { name: "Recovered boundary" } });

      expect(res.statusCode).toBe(200);
      expect(isIsoInstant(readClientResponse(res).updatedAt)).toBe(true);
      expect(readClientResponse(res).updatedAt).not.toBe(storedRevision);
    },
  );
}

function createBatchConcurrencyOptOutTests(): void {
  it("batch: explicit opt-out restores last-writer-wins semantics", async () => {
    const app = createApp(openDb(":memory:"), { optimisticConcurrency: false });
    await post(app, "accounts", account("a1"));
    await put({
      app,
      entity: "clients",
      id: "c1",
      payload: {
        ...client("c1", "a1"),
        updatedAt: "2026-02-02T00:00:00.000Z",
      },
    });
    const res = await batch(app, [
      {
        method: "PUT",
        table: "clients",
        id: "c1",
        row: {
          ...client("c1", "a1"),
          name: "Stale",
          updatedAt: "2026-02-01T00:00:00.000Z",
        },
      },
    ]);
    expect(res.statusCode).toBe(200);
    expect(readFirstClientName((await readValidatedState(app)).clients)).toBe("Stale");
  });
}

describe("optimistic concurrency (default-on)", () => {
  createDirectPutConcurrencyTests();
  createDirectPatchConcurrencyTests();
  createConcurrencyOptOutTests();
  createBatchStalePutConcurrencyTests();
  createBatchFreshPutConcurrencyTests();
  createMissingRevisionConcurrencyTests();
  createFutureRevisionConcurrencyTests();
  createPartialPatchConcurrencyTests();
  createNullPatchConcurrencyTests();
  createUnparseableStoredRevisionTests();
  createUnincrementableStoredRevisionTests();
  createBatchConcurrencyOptOutTests();
});
