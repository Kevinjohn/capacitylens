import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { migrateTimeOffResourceNullableV33 } from "./definitions";

const timeOffSchema = (resourceIdConstraint: "" | " NOT NULL") => `
  CREATE TABLE timeOff (
    id TEXT NOT NULL PRIMARY KEY,
    accountId TEXT NOT NULL,
    resourceId TEXT${resourceIdConstraint},
    startDate TEXT NOT NULL,
    endDate TEXT NOT NULL,
    type TEXT NOT NULL,
    note TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
`;

const row = {
  id: "time-off-1",
  accountId: "a-wayne",
  resourceId: "r-bruce",
  startDate: "2026-09-01",
  endDate: "2026-09-02",
  type: "holiday",
  note: "Gotham public holiday",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

function openDatabase(): DatabaseSync {
  return new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
}

function secondaryObjects(db: DatabaseSync): unknown[] {
  return db
    .prepare(
      `SELECT type, name, sql FROM sqlite_master
        WHERE tbl_name = 'timeOff' AND type IN ('index', 'trigger')
        ORDER BY type, name`,
    )
    .all();
}

function insertTimeOff(db: DatabaseSync, values: typeof row): void {
  db.prepare(
    `INSERT INTO timeOff
      (id, accountId, resourceId, startDate, endDate, type, note, createdAt, updatedAt)
     VALUES (@id, @accountId, @resourceId, @startDate, @endDate, @type, @note, @createdAt, @updatedAt)`,
  ).run(values);
}

function prepareNotNullTimeOff(db: DatabaseSync): void {
  db.exec(timeOffSchema(" NOT NULL"));
  db.exec(`
    CREATE TABLE timeOffAudit (timeOffId TEXT NOT NULL);
    CREATE INDEX timeOff_by_account_and_start ON timeOff(accountId, startDate);
    CREATE TRIGGER timeOff_insert_audit
    AFTER INSERT ON timeOff
    BEGIN
      INSERT INTO timeOffAudit (timeOffId) VALUES (NEW.id);
    END;
  `);
  insertTimeOff(db, row);
}

describe("migrateTimeOffResourceNullableV33", () => {
  it("refuses to run when timeOff has no resourceId column", () => {
    const db = openDatabase();
    try {
      db.exec("CREATE TABLE timeOff (id TEXT NOT NULL PRIMARY KEY);");

      expect(() => migrateTimeOffResourceNullableV33(db)).toThrow(
        "Cannot migrate timeOff.resourceId because the column is missing.",
      );
    } finally {
      db.close();
    }
  });

  it("leaves an already-nullable schema and its data unchanged", () => {
    const db = openDatabase();
    try {
      db.exec(timeOffSchema(""));
      db.exec("CREATE INDEX timeOff_by_account ON timeOff(accountId);");
      insertTimeOff(db, row);
      const beforeRows = db.prepare("SELECT * FROM timeOff ORDER BY id").all();
      const beforeObjects = secondaryObjects(db);

      migrateTimeOffResourceNullableV33(db);

      expect(db.prepare("SELECT * FROM timeOff ORDER BY id").all()).toEqual(beforeRows);
      expect(secondaryObjects(db)).toEqual(beforeObjects);
      expect(db.prepare("PRAGMA table_info(timeOff)").all()).toContainEqual(
        expect.objectContaining({ name: "resourceId", notnull: 0 }),
      );
    } finally {
      db.close();
    }
  });

  it("rebuilds a NOT NULL schema without losing rows, indexes, or triggers", () => {
    const db = openDatabase();
    try {
      prepareNotNullTimeOff(db);
      const beforeRows = db.prepare("SELECT * FROM timeOff ORDER BY id").all();
      const beforeObjects = secondaryObjects(db);

      migrateTimeOffResourceNullableV33(db);

      expect(db.prepare("SELECT * FROM timeOff ORDER BY id").all()).toEqual(beforeRows);
      expect(secondaryObjects(db)).toEqual(beforeObjects);
      expect(db.prepare("PRAGMA table_info(timeOff)").all()).toContainEqual(
        expect.objectContaining({ name: "resourceId", notnull: 0 }),
      );
      expect(() =>
        db
          .prepare(
            `INSERT INTO timeOff
              (id, accountId, resourceId, startDate, endDate, type, createdAt, updatedAt)
             VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
          )
          .run("time-off-company", "a-wayne", "2026-09-03", "2026-09-04", "holiday", row.createdAt, row.updatedAt),
      ).not.toThrow();
      expect(db.prepare("SELECT * FROM timeOffAudit ORDER BY timeOffId").all()).toEqual([
        { timeOffId: "time-off-1" },
        { timeOffId: "time-off-company" },
      ]);
    } finally {
      db.close();
    }
  });
});
