import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { tx } from "./txn";

const databases: DatabaseSync[] = [];

function testDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE events (name TEXT NOT NULL) STRICT");
  databases.push(db);
  return db;
}

afterEach(() => {
  databases.splice(0).forEach((db) => db.close());
});

describe("synchronous transaction boundary", () => {
  it("rolls back a top-level callback that returns a thenable", () => {
    const db = testDb();
    const callback = (() => {
      db.prepare("INSERT INTO events (name) VALUES (?)").run("not-committed");
      return Promise.resolve();
    }) as unknown as () => void;

    expect(() => tx(db, callback)).toThrow(/callback must be synchronous/i);
    expect(db.prepare("SELECT COUNT(*) AS count FROM events").get()).toEqual({ count: 0 });
    expect(db.isTransaction).toBe(false);
  });

  it("rolls back nested thenable work to its savepoint without discarding outer work", () => {
    const db = testDb();
    tx(db, () => {
      db.prepare("INSERT INTO events (name) VALUES (?)").run("outer-before");
      const callback = (() => {
        db.prepare("INSERT INTO events (name) VALUES (?)").run("nested-rolled-back");
        return Promise.resolve();
      }) as unknown as () => void;

      expect(() => tx(db, callback)).toThrow(/callback must be synchronous/i);
      db.prepare("INSERT INTO events (name) VALUES (?)").run("outer-after");
    });

    expect(db.prepare("SELECT name FROM events ORDER BY rowid").all()).toEqual([
      { name: "outer-before" },
      { name: "outer-after" },
    ]);
    expect(db.isTransaction).toBe(false);
  });

  it("rejects a nested immediate request under a deferred outer transaction", () => {
    const db = testDb();
    let nestedRan = false;

    expect(() =>
      tx(db, () => {
        tx(
          db,
          () => {
            nestedRan = true;
          },
          "immediate",
        );
      }),
    ).toThrow(/immediate.*enclosing.*immediate/i);

    expect(nestedRan).toBe(false);
    expect(db.isTransaction).toBe(false);
  });

  it("allows a nested immediate requirement when the outer transaction is immediate", () => {
    const db = testDb();

    tx(
      db,
      () => {
        tx(
          db,
          () => {
            db.prepare("INSERT INTO events (name) VALUES (?)").run("nested");
          },
          "immediate",
        );
      },
      "immediate",
    );

    expect(db.prepare("SELECT name FROM events").all()).toEqual([{ name: "nested" }]);
  });
});

function compileOnlyAsyncCallbackRejection(db: DatabaseSync): void {
  // @ts-expect-error Transaction callbacks must complete synchronously.
  void tx(db, async () => undefined);
  const maybeAsync = (): void | Promise<void> => undefined;
  // @ts-expect-error A callback that can return a Promise is not synchronously atomic.
  void tx(db, maybeAsync);
}
void compileOnlyAsyncCallbackRejection;
