import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { AppData } from "@capacitylens/shared/types/entities";
import { insertAll } from "./db";
import type { Db } from "./db";

const TS = "2026-01-01T00:00:00.000Z";

const account = (id: string) => ({
  id,
  name: `Studio ${id}`,
  color: "#3b82f6",
  createdAt: TS,
  updatedAt: TS,
});

/** Seed two pre-existing accounts directly (a1 + a2, for the cross-tenant cases). */
export function seedTwo(db: Db): void {
  const d = emptyAppData() as unknown as Record<string, unknown[]>;
  d.accounts = [account("a1"), account("a2")];
  insertAll(db, d as unknown as AppData);
}
