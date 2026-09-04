import { afterEach, expect, it } from "vitest";
import { openDb, type Db } from "../../db";
import { cachedStatement } from "./runtime";

const databases: Db[] = [];

afterEach(() => {
  for (const db of databases) db.close();
  databases.length = 0;
});

it("keeps each statement closure's cache independent and keyed by database handle", () => {
  const db = openDb(":memory:");
  databases.push(db);
  const otherDb = openDb(":memory:");
  databases.push(otherDb);
  const first = cachedStatement("SELECT 1 AS value");
  const second = cachedStatement("SELECT 1 AS value");

  expect(first(db)).toBe(first(db));
  expect(first(otherDb)).not.toBe(first(db));
  expect(second(db)).not.toBe(first(db));
  expect(first(db).get()).toEqual({ value: 1 });
  expect(first(otherDb).get()).toEqual({ value: 1 });
});
