import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../../db";
import { bumpSecurityRevision, getSecurityRevision, removeSecurityRevision } from "../state";

describe("account security revisions", () => {
  const databases: Db[] = [];

  afterEach(() => {
    for (const db of databases) db.close();
    databases.length = 0;
  });

  it("increments and removes revisions independently for each principal and database", () => {
    const db = openDb(":memory:");
    databases.push(db);
    const otherDb = openDb(":memory:");
    databases.push(otherDb);

    expect(getSecurityRevision(db, "principal-bruce")).toBe(0);
    expect(bumpSecurityRevision(db, "principal-bruce")).toBe(1);
    expect(bumpSecurityRevision(db, "principal-bruce")).toBe(2);
    expect(bumpSecurityRevision(db, "principal-diana")).toBe(1);
    expect(getSecurityRevision(otherDb, "principal-bruce")).toBe(0);

    removeSecurityRevision(db, "principal-bruce");
    expect(getSecurityRevision(db, "principal-bruce")).toBe(0);
    expect(getSecurityRevision(db, "principal-diana")).toBe(1);
  });
});
