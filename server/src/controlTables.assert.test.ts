import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { assertControlTablesCurrent, ensureControlTables } from "./controlTables";

describe("assertControlTablesCurrent", () => {
  // The invitation-proposal tables arrive with v44. A database that claims that version but lacks
  // them is the failed-migration case this assertion exists to catch, so it must not pass.
  it("rejects a current database whose invitation-proposal control tables are missing", () => {
    const db = new DatabaseSync(":memory:");
    ensureControlTables(db);
    expect(() => assertControlTablesCurrent(db)).not.toThrow();
    db.exec("PRAGMA user_version = 44");
    db.exec("DROP TABLE invitation_person_proposals; DROP TABLE member_resource_link_exceptions");
    expect(() => assertControlTablesCurrent(db)).toThrow(/invitation_person_proposals/i);
  });
});
