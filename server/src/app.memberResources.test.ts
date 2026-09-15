/* eslint-disable max-lines-per-function -- one end-to-end route story keeps auth, CAS and privacy assertions together. */
import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { createAuthFromEnvironment, runAuthMigrations } from "./auth";
import { upsertMember } from "./controlTables";
import { emptyAppData, type AppData } from "@capacitylens/shared/types/entities";
import { insertAll, openDb } from "./db";
import { call, PASSWORD_ENV, signUp } from "./testHelpers";

const TS = "2026-01-01T00:00:00.000Z";

describe("member resource links", () => {
  it("authorizes administration and returns only the narrow active avatar projection", async () => {
    const db = openDb(":memory:");
    const { mode, auth } = createAuthFromEnvironment(db, PASSWORD_ENV);
    if (!auth) throw new Error("Expected auth configuration.");
    await runAuthMigrations(auth);
    const app = createApp(db, { authMode: mode, auth });
    const data = emptyAppData();
    data.accounts = [
      { id: "a1", name: "Wayne Enterprises", color: "#6366f1", createdAt: TS, updatedAt: TS },
      { id: "a2", name: "Stark Industries", color: "#6366f1", createdAt: TS, updatedAt: TS },
    ];
    insertAll(db, data as AppData);
    const owner = await signUp(app, "bruce-wayne@capacitylens.dev");
    const viewer = await signUp(app, "clark-kent@capacitylens.dev");
    upsertMember(db, { accountId: "a1", userId: owner.userId, role: "owner", status: "active", createdAt: TS });
    upsertMember(db, { accountId: "a1", userId: viewer.userId, role: "viewer", status: "active", createdAt: TS });
    db.prepare(`UPDATE user SET image = ? WHERE id = ?`).run(" https://images.example/bruce.png ", owner.userId);
    db.prepare(
      `INSERT INTO resources
       (id, accountId, kind, name, role, color, employmentType, engagement,
        workingHoursPerDay, workingDays, halfDays, createdAt, updatedAt)
       VALUES ('bruce', 'a1', 'person', 'Bruce Wayne', 'Owner', '#6366f1', 'permanent', 'studio', 8,
        '[1,2,3,4,5]', '[]', ?, ?)`,
    ).run(TS, TS);
    const viewerWrite = await call(app, {
      method: "PUT",
      url: `/api/accounts/a1/members/${owner.userId}/resource-link`,
      headers: { cookie: viewer.cookie },
      payload: { resourceId: "bruce", expectedRevision: null },
    });
    expect(viewerWrite.statusCode).toBe(403);
    const linked = await call(app, {
      method: "PUT",
      url: `/api/accounts/a1/members/${owner.userId}/resource-link`,
      headers: { cookie: owner.cookie },
      payload: { resourceId: "bruce", expectedRevision: null },
    });
    expect(linked.statusCode).toBe(200);
    expect(Object.keys(linked.json()).sort()).toEqual(["resourceId", "revision"]);
    const projection = await call(app, {
      method: "GET",
      url: "/api/accounts/a1/resource-avatars",
      headers: { cookie: viewer.cookie },
    });
    expect(projection.statusCode).toBe(200);
    expect(projection.json()).toEqual({
      avatars: [{ resourceId: "bruce", imageUrl: "https://images.example/bruce.png" }],
    });
    expect(JSON.stringify(projection.json())).not.toContain(owner.userId);
    expect(
      (
        await call(app, {
          method: "GET",
          url: "/api/accounts/a2/resource-avatars",
          headers: { cookie: owner.cookie },
        })
      ).statusCode,
    ).toBe(403);
    db.prepare(
      `INSERT INTO resources
       (id, accountId, kind, name, role, color, employmentType, engagement,
        workingHoursPerDay, workingDays, halfDays, createdAt, updatedAt)
       VALUES ('clark', 'a1', 'person', 'Clark Kent', 'Designer', '#6366f1', 'permanent', 'studio', 8,
        '[1,2,3,4,5]', '[]', ?, ?)`,
    ).run(TS, TS);
    expect(
      (
        await call(app, {
          method: "PUT",
          url: `/api/accounts/a1/members/${owner.userId}/resource-link`,
          headers: { cookie: owner.cookie },
          payload: { resourceId: "bruce", expectedRevision: "stale-revision" },
        })
      ).statusCode,
    ).toBe(409);
    const converted = await call(app, {
      method: "PATCH",
      url: "/api/resources/bruce",
      headers: { cookie: owner.cookie },
      payload: { kind: "external" },
    });
    expect(converted.statusCode, converted.body).toBe(400);
    expect(
      (
        await call(app, { method: "GET", url: "/api/accounts/a1/resource-avatars", headers: { cookie: viewer.cookie } })
      ).json(),
    ).toEqual({ avatars: [{ resourceId: "bruce", imageUrl: "https://images.example/bruce.png" }] });
    const revision = (linked.json() as { revision: string }).revision;
    db.prepare(`UPDATE resources SET archivedAt = ? WHERE accountId = 'a1' AND id = 'bruce'`).run(TS);
    const rejectedChange = await call(app, {
      method: "PUT",
      url: `/api/accounts/a1/members/${owner.userId}/resource-link`,
      headers: { cookie: owner.cookie },
      payload: { resourceId: "clark", expectedRevision: revision },
    });
    expect(rejectedChange.statusCode).toBe(409);
    expect(
      (
        await call(app, {
          method: "DELETE",
          url: `/api/accounts/a1/members/${owner.userId}/resource-link`,
          headers: { cookie: owner.cookie },
          payload: { expectedRevision: revision },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await call(app, { method: "GET", url: "/api/accounts/a1/resource-avatars", headers: { cookie: viewer.cookie } })
      ).json(),
    ).toEqual({ avatars: [] });
    await app.close();
    db.close();
  });
});
