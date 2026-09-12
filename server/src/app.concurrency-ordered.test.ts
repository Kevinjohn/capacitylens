import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import { getRow, openDb } from "./db";
import { isIsoInstant } from "@capacitylens/shared/account/types";
import { TS, meta, account, client } from "./fixtures/appTestEntities";
import { post, put, orderedBatch } from "./fixtures/appTestHttp";
import { isUnknownRecord, readRequiredString } from "./fixtures/appTestSnapshotCore";
import {
  readFirstClient,
  readFirstClientName,
  readClientResponse,
  readBatchSuperseded,
  readValidatedState,
  readStateClients,
} from "./fixtures/appTestSnapshotBatch";
import { readUpdatedAt, createExternalAllocationEdit } from "./fixtures/appTestScaffold";

function createOrderedBatchSuccessorTests(): void {
  it.each([true, false])(
    "ordered browser batches preserve the newer edit when sequence 1 commits before sequence 2 (optimistic=%s)",
    async (optimisticConcurrency) => {
      const app = createApp(openDb(":memory:"), { optimisticConcurrency });
      await post(app, "accounts", account("a1"));
      const created = await put({ app, entity: "clients", id: "c1", payload: client("c1", "a1") });
      const baseRevision = readClientResponse(created).updatedAt;
      const sessionId = "browser-session-0001";
      const first = await orderedBatch({
        app,
        sessionId,
        sequence: 1,
        ops: [
          {
            method: "PUT",
            table: "clients",
            id: "c1",
            row: {
              ...client("c1", "a1"),
              name: "First",
              updatedAt: baseRevision,
            },
          },
        ],
      });
      const second = await orderedBatch({
        app,
        sessionId,
        sequence: 2,
        ops: [
          {
            method: "PUT",
            table: "clients",
            id: "c1",
            row: {
              ...client("c1", "a1"),
              name: "Newest",
              updatedAt: baseRevision,
            },
          },
        ],
      });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(readBatchSuperseded(second)).toBeUndefined();
      expect(readFirstClientName((await readValidatedState(app)).clients)).toBe("Newest");
    },
  );
}

function createOrderedBatchSupersessionTests(): void {
  it.each([true, false])(
    "ordered browser batches preserve the newer edit when sequence 2 arrives before sequence 1 (optimistic=%s)",
    async (optimisticConcurrency) => {
      const app = createApp(openDb(":memory:"), { optimisticConcurrency });
      await post(app, "accounts", account("a1"));
      const created = await put({ app, entity: "clients", id: "c1", payload: client("c1", "a1") });
      const baseRevision = readClientResponse(created).updatedAt;
      const sessionId = "browser-session-0002";
      const second = await orderedBatch({
        app,
        sessionId,
        sequence: 2,
        ops: [
          {
            method: "PUT",
            table: "clients",
            id: "c1",
            row: {
              ...client("c1", "a1"),
              name: "Newest",
              updatedAt: baseRevision,
            },
          },
        ],
      });
      const first = await orderedBatch({
        app,
        sessionId,
        sequence: 1,
        ops: [
          {
            method: "PUT",
            table: "clients",
            id: "c1",
            row: {
              ...client("c1", "a1"),
              name: "First",
              updatedAt: baseRevision,
            },
          },
        ],
      });

      expect(second.statusCode).toBe(200);
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({
        ok: true,
        applied: 1,
        superseded: true,
      });
      expect(readFirstClientName((await readValidatedState(app)).clients)).toBe("Newest");
    },
  );
}

function createOrderedLifecycleFenceTests(): void {
  it.each([true, false])(
    "an ordered teardown archive fences an older in-flight lifecycle creation (optimistic=%s)",
    async (optimisticConcurrency) => {
      const app = createApp(openDb(":memory:"), { optimisticConcurrency });
      await post(app, "accounts", account("a1"));
      const pendingClient = client("c1", "a1");
      const sessionId = "browser-session-lifecycle-0001";

      const teardown = await orderedBatch({
        app,
        sessionId,
        sequence: 2,
        ops: [
          {
            method: "ARCHIVE",
            table: "clients",
            id: "c1",
            accountId: "a1",
            updatedAt: pendingClient.updatedAt,
          },
        ],
      });
      const olderCreation = await orderedBatch({
        app,
        sessionId,
        sequence: 1,
        ops: [
          {
            method: "PUT",
            table: "clients",
            id: "c1",
            row: pendingClient,
          },
        ],
      });

      expect(teardown.statusCode).toBe(200);
      expect(teardown.json()).toMatchObject({ ok: true, applied: 1, changed: 0 });
      expect(olderCreation.statusCode).toBe(200);
      expect(olderCreation.json()).toMatchObject({ ok: true, applied: 1, superseded: true });
      expect((await readValidatedState(app)).clients).toEqual([]);
    },
  );
}

function createOrderedLifecycleArchiveTests(): void {
  it("applies an ordered lifecycle archive atomically and retains its inactive row", async () => {
    const db = openDb(":memory:");
    const app = createApp(db);
    await post(app, "accounts", account("a1"));
    const created = await put({ app, entity: "clients", id: "c1", payload: client("c1", "a1") });

    const response = await orderedBatch({
      app,
      sessionId: "browser-session-lifecycle-0002",
      sequence: 1,
      ops: [
        {
          method: "ARCHIVE",
          table: "clients",
          id: "c1",
          accountId: "a1",
          updatedAt: readClientResponse(created).updatedAt,
        },
      ],
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, applied: 1, changed: 1 });
    const archivedRow = getRow(db, "clients", "c1");
    if (!isUnknownRecord(archivedRow)) throw new Error("Expected the archived client row to remain in the database.");
    expect(readRequiredString(archivedRow, "id", "archived client row")).toBe("c1");
    expect(readRequiredString(archivedRow, "accountId", "archived client row")).toBe("a1");
    expect(isIsoInstant(readRequiredString(archivedRow, "archivedAt", "archived client row"))).toBe(true);
  });
}

function createOrderedExternalEditTests(): void {
  it("ordered successor still rejects a stale write after an intervening external edit", async () => {
    const app = createApp(openDb(":memory:"), { optimisticConcurrency: false });
    await post(app, "accounts", account("a1"));
    const created = await put({ app, entity: "clients", id: "c1", payload: client("c1", "a1") });
    const baseRevision = readClientResponse(created).updatedAt;
    const sessionId = "browser-session-0003";
    await orderedBatch({
      app,
      sessionId,
      sequence: 1,
      ops: [
        {
          method: "PUT",
          table: "clients",
          id: "c1",
          row: { ...client("c1", "a1"), name: "First", updatedAt: baseRevision },
        },
      ],
    });
    const afterFirst = readFirstClient((await readValidatedState(app)).clients);
    await put({ app, entity: "clients", id: "c1", payload: { ...afterFirst, name: "External" } });
    const successor = await orderedBatch({
      app,
      sessionId,
      sequence: 2,
      ops: [
        {
          method: "PUT",
          table: "clients",
          id: "c1",
          row: { ...client("c1", "a1"), name: "Newest", updatedAt: baseRevision },
        },
      ],
    });

    expect(successor.statusCode).toBe(409);
    expect(readFirstClientName((await readValidatedState(app)).clients)).toBe("External");
  });
}

function createOrderedStaleDeleteTests(): void {
  it("ordered stale DELETE rolls back its batch and preserves an externally edited row", async () => {
    const app = createApp(openDb(":memory:"), { optimisticConcurrency: false });
    const { baseRevision, external } = await createExternalAllocationEdit(app);
    expect(external.statusCode).toBe(200);
    const externalRevision = readUpdatedAt(external);
    expect(externalRevision).not.toBe(baseRevision);

    const staleDelete = await orderedBatch({
      app,
      sessionId: "stale-delete-browser-1",
      sequence: 1,
      ops: [
        {
          method: "PUT",
          table: "disciplines",
          id: "rolled-back",
          row: {
            id: "rolled-back",
            accountId: "a1",
            name: "Must not persist",
            color: "#5c34d4",
            sortOrder: 0,
            ...meta(),
          },
        },
        {
          method: "DELETE",
          table: "allocations",
          id: "al1",
          accountId: "a1",
          updatedAt: baseRevision,
        },
      ],
    });

    expect(staleDelete.statusCode).toBe(409);
    expect(staleDelete.json()).toMatchObject({
      error: "The record was modified more recently on the server.",
      current: {
        id: "al1",
        note: "Committed by another browser",
        updatedAt: externalRevision,
      },
    });
    const current = await readValidatedState(app);
    expect(current.allocations).toEqual([
      expect.objectContaining({
        id: "al1",
        note: "Committed by another browser",
      }),
    ]);
    expect(current.disciplines).toEqual([]);
  });
}

function createOrderedStaleArchiveTests(): void {
  it("ordered stale ARCHIVE rolls back its batch when it is not a same-session successor", async () => {
    const app = createApp(openDb(":memory:"), { optimisticConcurrency: false });
    await post(app, "accounts", account("a1"));
    const created = await post(app, "clients", client("c1", "a1"));
    const createdRow = created.json() as Record<string, unknown>;
    const baseRevision = createdRow.updatedAt as string;
    const external = await put({
      app,
      entity: "clients",
      id: "c1",
      payload: {
        ...createdRow,
        name: "Externally edited",
        updatedAt: baseRevision,
      },
    });
    expect(external.statusCode).toBe(200);

    const response = await orderedBatch({
      app,
      sessionId: "stale-archive-browser-1",
      sequence: 1,
      ops: [
        {
          method: "ARCHIVE",
          table: "clients",
          id: "c1",
          accountId: "a1",
          updatedAt: baseRevision,
        },
      ],
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: "The record was modified more recently on the server.",
      current: { id: "c1", name: "Externally edited" },
    });
    expect(await readStateClients(app)).toEqual([expect.objectContaining({ id: "c1", name: "Externally edited" })]);
  });
}

function createOrderedNonLifecycleDeletionTests(): void {
  it.each(["first-before-undo", "undo-before-first"])(
    "ordered creation followed by a non-lifecycle deletion cannot be resurrected (%s)",
    async (arrivalOrder) => {
      const app = createApp(openDb(":memory:"), {
        optimisticConcurrency: false,
      });
      await post(app, "accounts", account("a1"));
      const sessionId = `browser-session-${arrivalOrder}`;
      const row = {
        id: "d1",
        accountId: "a1",
        name: "Temporary",
        color: "#5c34d4",
        sortOrder: 0,
        createdAt: TS,
        updatedAt: TS,
      };
      const create = () =>
        orderedBatch({ app, sessionId, sequence: 1, ops: [{ method: "PUT", table: "disciplines", id: "d1", row }] });
      const undo = () =>
        orderedBatch({
          app,
          sessionId,
          sequence: 2,
          ops: [
            {
              method: "DELETE",
              table: "disciplines",
              id: "d1",
              accountId: "a1",
              updatedAt: TS,
            },
          ],
        });

      const responses =
        arrivalOrder === "first-before-undo" ? [await create(), await undo()] : [await undo(), await create()];

      expect(responses.every((response) => response.statusCode === 200)).toBe(true);
      expect((await readValidatedState(app)).disciplines).toEqual([]);
    },
  );
}

describe("optimistic concurrency (default-on)", () => {
  createOrderedBatchSuccessorTests();
  createOrderedBatchSupersessionTests();
  createOrderedLifecycleFenceTests();
  createOrderedLifecycleArchiveTests();
  createOrderedExternalEditTests();
  createOrderedStaleDeleteTests();
  createOrderedStaleArchiveTests();
  createOrderedNonLifecycleDeletionTests();
});
