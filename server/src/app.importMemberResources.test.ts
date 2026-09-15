import { describe, expect, it } from "vitest";
import { EXPORT_SCHEMA_VERSION } from "@capacitylens/shared/types/entities";
import { account, freshApp, person } from "./fixtures/appTestEntities";
import { call, post } from "./fixtures/appTestHttp";
import { clearAccountMemberResourceLink } from "./controlTables";

const linkSql = `INSERT INTO account_member_resources
  (accountId, userId, resourceId, revision, createdAt, updatedAt) VALUES ('a1', ?, ?, ?, ?, ?)`;
const now = "2026-09-14T10:00:00.000Z";
const namedPerson = (id: string) => ({ ...person(id, "a1"), name: id });

function importPayload(resources: unknown[]) {
  return {
    accountId: "a1",
    data: {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      data: {
        accounts: [],
        clients: [],
        disciplines: [],
        projects: [],
        phases: [],
        resources,
        activities: [],
        allocations: [],
        timeOff: [],
        closures: [],
      },
    },
  };
}

describe("POST /api/import member resource associations", () => {
  it("clears all person links only after a successful destructive replacement", async () => {
    const { app, db } = freshApp();
    await post(app, "accounts", account("a1"));
    for (const id of ["keep", "inactive", "removed", "non-person"]) await post(app, "resources", person(id, "a1"));
    for (const [index, id] of ["keep", "inactive", "removed", "non-person"].entries())
      db.prepare(linkSql).run(`u${index}`, id, `rev${index}`, now, now);
    const inactive = { ...namedPerson("inactive"), archivedAt: now };
    const response = await call(app, {
      method: "POST",
      url: "/api/import",
      payload: importPayload([namedPerson("keep"), inactive, { ...namedPerson("non-person"), kind: "placeholder" }]),
    });
    expect(response.statusCode).toBe(200);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM account_member_resources`).get()).toEqual({ count: 0 });
    expect(() =>
      clearAccountMemberResourceLink({ db, accountId: "a1", userId: "u0", expectedRevision: "rev0" }),
    ).toThrow(/changed/i);
  });

  it("rolls resources and links back when association cleanup fails inside the import transaction", async () => {
    const { app, db } = freshApp();
    await post(app, "accounts", account("a1"));
    await post(app, "resources", person("removed", "a1"));
    db.prepare(linkSql).run("u1", "removed", "rev1", now, now);
    db.exec(
      `CREATE TRIGGER reject_link_cleanup BEFORE DELETE ON account_member_resources BEGIN SELECT RAISE(ABORT, 'injected reconciliation failure'); END`,
    );
    const response = await call(app, {
      method: "POST",
      url: "/api/import",
      payload: importPayload([person("replacement", "a1")]),
    });
    expect(response.statusCode).toBe(500);
    expect(db.prepare(`SELECT id FROM resources WHERE accountId = 'a1' AND id = 'removed'`).get()).toEqual({
      id: "removed",
    });
    expect(db.prepare(`SELECT resourceId FROM account_member_resources`).get()).toEqual({ resourceId: "removed" });
  });
});
