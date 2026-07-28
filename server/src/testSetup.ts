import { afterAll } from "vitest";
import {
  setDatabaseOpenObserverForTests,
  type Db,
} from "./db";

const openDatabases = new Set<Db>();

setDatabaseOpenObserverForTests((db) => {
  openDatabases.add(db);
});

afterAll(() => {
  for (const db of openDatabases) {
    if (db.isOpen) db.close();
  }
  openDatabases.clear();
  setDatabaseOpenObserverForTests(undefined);
});
