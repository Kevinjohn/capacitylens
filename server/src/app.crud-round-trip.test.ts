import { describe, it, expect } from "vitest";
import { getRow } from "./db";
import {
  meta,
  withoutRevision,
  freshApp,
  account,
  client,
  project,
  person,
  placeholder,
  allocation,
} from "./fixtures/appTestEntities";
import { call, post, put, patch, del, batch } from "./fixtures/appTestHttp";
import { readFirstAllocation } from "./fixtures/appTestSnapshotSchedule";
import { readFirstResource, patchResourceFavourite } from "./fixtures/appTestSnapshotAccount";
import {
  readFirstClient,
  readFirstClientName,
  readClientResponse,
  readValidatedState,
  readStateClients,
} from "./fixtures/appTestSnapshotBatch";
import { scaffold } from "./fixtures/appTestScaffold";

function createCrudCreationTests(): void {
  it("creates every entity type and reads them back via /api/state", async () => {
    const { app } = freshApp();
    await scaffold(app);
    expect(
      (await post(app, "allocations", allocation({ id: "al1", accountId: "a1", resourceId: "r1", activityId: "t1" })))
        .statusCode,
    ).toBe(201);
    const s = await readValidatedState(app);
    expect(s.accounts).toHaveLength(1);
    expect(s.clients).toHaveLength(1);
    expect(s.projects).toHaveLength(1);
    expect(s.activities).toHaveLength(1);
    expect(s.resources).toHaveLength(1);
    expect(s.allocations).toHaveLength(1);
    // Round-trips exactly: both weekday JSON arrays + omitted optionals survive.
    expect(withoutRevision(readFirstResource(s.resources))).toEqual(
      withoutRevision({
        ...person("r1", "a1"),
        name: "Unnamed person",
      }),
    );
    expect(withoutRevision(readFirstAllocation(s.allocations))).toEqual(
      withoutRevision(allocation({ id: "al1", accountId: "a1", resourceId: "r1", activityId: "t1" })),
    );
  });

  it("persists an explicit mixed full and half-day resource pattern", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    const response = await post(app, "resources", { ...person("r1", "a1"), halfDays: [2, 4] });

    expect(response.statusCode).toBe(201);
    expect(readFirstResource((await readValidatedState(app)).resources)).toMatchObject({
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [2, 4],
    });
  });

  it("normalizes placeholder working patterns on create and partial update", async () => {
    const { app } = freshApp();
    await scaffold(app);
    const created = await post(app, "resources", {
      ...placeholder("ph", "a1", "p1"),
      workingDays: [0, 6],
      halfDays: [6],
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ workingDays: [1, 2, 3, 4, 5], halfDays: [] });
    const updated = await patch({ app, entity: "resources", id: "ph", payload: { workingDays: [2], halfDays: [2] } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ workingDays: [1, 2, 3, 4, 5], halfDays: [] });
  });
}

function createCrudMutationTests(): void {
  it("PATCH updates fields; DELETE removes a non-lifecycle row", async () => {
    const { app } = freshApp();
    await scaffold(app);
    const res = await patch({
      app,
      entity: "clients",
      id: "c1",
      payload: {
        ...client("c1", "a1"),
        name: "Renamed",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(readClientResponse(res).name).toBe("Renamed");
    await post(app, "disciplines", {
      id: "d1",
      accountId: "a1",
      name: "Design",
      color: "#5c34d4",
      sortOrder: 0,
      ...meta(),
    });
    expect((await del({ app, entity: "disciplines", id: "d1", accountId: "a1" })).statusCode).toBe(204);
    expect((await readValidatedState(app)).disciplines).toHaveLength(0);
  });

  it("PATCH on a missing id is 404; unknown entity is 404", async () => {
    const { app } = freshApp();
    await scaffold(app);
    expect((await patch({ app, entity: "clients", id: "nope", payload: client("nope", "a1") })).statusCode).toBe(404);
    expect((await post(app, "widgets", { id: "x" })).statusCode).toBe(404);
  });
}

function createCrudResourceMutationTests(): void {
  it("batch persists a person whose optional role is blank", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    const resource = { ...person("r1", "a1"), role: "" };
    const response = await batch(app, [{ method: "PUT", table: "resources", id: resource.id, row: resource }]);

    expect(response.statusCode, response.body).toBe(200);
    const state = await readValidatedState(app);
    expect(readFirstResource(state.resources)).toMatchObject({ id: "r1", role: "" });
  });

  it("PATCH is a partial merge: omitted fields keep their stored value", async () => {
    const { app } = freshApp();
    await scaffold(app);
    // A real partial patch — only `role`. kind/employmentType/workingDays/etc. must
    // survive (a blind column-wise UPDATE would null the NOT NULL columns → 500/400).
    const res = await patch({ app, entity: "resources", id: "r1", payload: { role: "Lead Designer" } });
    expect(res.statusCode).toBe(200);
    const s = await readValidatedState(app);
    const r = readFirstResource(s.resources);
    expect(r.role).toBe("Lead Designer");
    expect(r.kind).toBe("person");
    expect(r.employmentType).toBe("permanent");
    expect(r.workingHoursPerDay).toBe(8);
    expect(r.workingDays).toEqual([1, 2, 3, 4, 5]);
    expect(r.color).toBe("#5c34d4");
  });

  it("PATCH persists and clears a resource favourite", async () => {
    const { app, db } = freshApp();
    await scaffold(app);

    const favouriteResponse = await patchResourceFavourite(app, true);
    const favourite = favouriteResponse.isFavourite;
    expect(favourite).toBe(true);
    expect(getRow(db, "resources", "r1")?.isFavourite).toBe(true);

    const unfavouriteResponse = await patchResourceFavourite(app, false);
    const unfavourite = unfavouriteResponse.isFavourite;
    expect(unfavourite).toBe(false);
    expect(getRow(db, "resources", "r1")?.isFavourite).toBe(false);
  });
}

function createCrudScopingTests(): void {
  it("refuses to re-home an existing row to another account (accountId is immutable)", async () => {
    const { app } = freshApp();
    await scaffold(app); // c1 in a1
    await post(app, "accounts", account("a2"));
    // PATCH and PUT that try to move c1 into a2 are indistinguishable from an absent row.
    expect((await patch({ app, entity: "clients", id: "c1", payload: { accountId: "a2" } })).statusCode).toBe(404);
    expect((await put({ app, entity: "clients", id: "c1", payload: { ...client("c1", "a2") } })).statusCode).toBe(404);
    // …and c1 stays in a1.
    expect(readFirstClient(await readStateClients(app)).accountId).toBe("a1");
  });

  it("scopes a non-lifecycle delete to its owning account", async () => {
    const { app } = freshApp();
    await scaffold(app); // c1 belongs to a1
    await post(app, "accounts", account("a2"));
    await post(app, "disciplines", {
      id: "d1",
      accountId: "a1",
      name: "Design",
      color: "#5c34d4",
      sortOrder: 0,
      ...meta(),
    });
    // Asserting the WRONG account refuses with 404 and leaves the row in place…
    expect(
      (
        await call(app, {
          method: "DELETE",
          url: "/api/disciplines/d1?accountId=a2",
        })
      ).statusCode,
    ).toBe(404);
    expect((await readValidatedState(app)).disciplines).toHaveLength(1);
    // …the correct owner deletes it.
    expect(
      (
        await call(app, {
          method: "DELETE",
          url: "/api/disciplines/d1?accountId=a1",
        })
      ).statusCode,
    ).toBe(204);
    expect((await readValidatedState(app)).disciplines).toHaveLength(0);
  });

  it("refuses a scoped delete that omits accountId (the by-id bypass is closed → 400)", async () => {
    const { app } = freshApp();
    await scaffold(app);
    // A scoped delete MUST assert its owner; omitting accountId can't prove ownership, so
    // it is a 400 rather than an unscoped delete-by-id (the old tenant-guard bypass).
    expect((await call(app, { method: "DELETE", url: "/api/clients/c1" })).statusCode).toBe(400);
    expect(await readStateClients(app)).toHaveLength(1); // not deleted
  });
}

function createCrudPersistenceTests(): void {
  it("preserves the immutable createdAt on update (a PUT cannot rewrite it)", async () => {
    const { app } = freshApp();
    await scaffold(app);
    const original = readFirstClient(await readStateClients(app)).createdAt;
    await put({
      app,
      entity: "clients",
      id: "c1",
      payload: {
        ...client("c1", "a1"),
        name: "Renamed",
        createdAt: "2099-01-01T00:00:00.000Z",
      },
    });
    const after = readFirstClient(await readStateClients(app));
    expect(after.name).toBe("Renamed"); // everything else updates
    expect(after.createdAt).toBe(original); // …but createdAt is preserved
  });

  it("reports hasData:true after the user deletes all their data (no demo re-seed)", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    expect((await call(app, { method: "GET", url: "/api/meta" })).json()).toEqual({ hasData: true });
    await del({ app, entity: "accounts", id: "a1" }); // user empties everything
    expect((await readValidatedState(app)).accounts).toHaveLength(0);
    // Still "initialised" — a reload must NOT mistake an emptied dataset for a fresh one.
    expect((await call(app, { method: "GET", url: "/api/meta" })).json()).toEqual({ hasData: true });
  });

  it("DELETE is idempotent for non-lifecycle tables (missing id still 204 when the owner is asserted)", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    expect((await del({ app, entity: "phases", id: "ghost", accountId: "a1" })).statusCode).toBe(204);
  });
}

function createCrudUpsertTests(): void {
  it("PUT upserts idempotently: first call creates, second overwrites (no conflict)", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    const c = client("c1", "a1");
    expect((await put({ app, entity: "clients", id: "c1", payload: c })).statusCode).toBe(200);
    // Replay the SAME create — must not error (the sync adapter relies on this when
    // replaying a batch after a partial failure).
    const replay = await put({ app, entity: "clients", id: "c1", payload: c });
    expect(replay.statusCode).toBe(200);
    // A changed body overwrites.
    expect(
      (
        await put({
          app,
          entity: "clients",
          id: "c1",
          payload: {
            ...c,
            updatedAt: readClientResponse(replay).updatedAt,
            name: "Renamed",
          },
        })
      ).statusCode,
    ).toBe(200);
    const s = await readValidatedState(app);
    expect(s.clients).toHaveLength(1);
    expect(readFirstClientName(s.clients)).toBe("Renamed");
  });

  it("PUT rejects a body id that disagrees with the URL id", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    expect((await put({ app, entity: "clients", id: "c1", payload: client("OTHER", "a1") })).statusCode).toBe(400);
  });

  it("PUT runs shared-core validation (rejects a dangling FK)", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    expect(
      (await put({ app, entity: "projects", id: "p1", payload: project("p1", "a1", "no-client") })).statusCode,
    ).toBe(400);
  });
}

describe("CRUD round-trip", () => {
  createCrudCreationTests();
  createCrudMutationTests();
  createCrudResourceMutationTests();
  createCrudScopingTests();
  createCrudPersistenceTests();
  createCrudUpsertTests();
});

describe("generic lifecycle deletion guard", () => {
  it("rejects deleting a client and leaves its full subtree intact", async () => {
    const { app } = freshApp();
    await scaffold(app);
    await post(app, "allocations", allocation({ id: "al1", accountId: "a1", resourceId: "r1", activityId: "t1" }));
    expect((await del({ app, entity: "clients", id: "c1", accountId: "a1" })).statusCode).toBe(400);
    const s = await readValidatedState(app);
    expect(s.clients).toHaveLength(1);
    expect(s.projects).toHaveLength(1);
    expect(s.activities).toHaveLength(1);
    expect(s.allocations).toHaveLength(1);
    expect(s.resources).toHaveLength(1);
  });

  it("deleting a discipline ungroups resources (SET NULL, not delete)", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    await post(app, "disciplines", {
      id: "d1",
      accountId: "a1",
      name: "Design",
      sortOrder: 0,
      ...meta(),
    });
    await post(app, "resources", { ...person("r1", "a1"), disciplineId: "d1" });
    await del({ app, entity: "disciplines", id: "d1", accountId: "a1" });
    const s = await readValidatedState(app);
    expect(s.disciplines).toHaveLength(0);
    expect(s.resources).toHaveLength(1);
    expect(readFirstResource(s.resources).disciplineId).toBeUndefined();
  });
});
