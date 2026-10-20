import { NULLABLE_FIELDS } from "@capacitylens/shared/types/nullableFields";
import { describe, expect, it } from "vitest";
import { makeAppData } from "@/test/fixtures";
import { applyDemoRowCommands, createDemoHistoryEntry } from "./history";

const T = "2026-01-01T00:00:00.000Z";
const meta = { accountId: "account-1", createdAt: T, updatedAt: T };

describe("demo row-command history application", () => {
  it("undoes and redoes mixed cascades while preserving IDs, order, timestamps, and inputs", () => {
    const originalClient1 = { ...NULLABLE_FIELDS.clients, ...meta, id: "c1", name: "Original", color: "#111111" };
    const updatedClient1 = { ...originalClient1, name: "Updated" };
    const client2 = { ...NULLABLE_FIELDS.clients, ...meta, id: "c2", name: "Second", color: "#222222" };
    const client3 = { ...NULLABLE_FIELDS.clients, ...meta, id: "c3", name: "Third", color: "#333333" };
    const client4 = { ...NULLABLE_FIELDS.clients, ...meta, id: "c4", name: "Inserted", color: "#444444" };
    const originalProject1 = {
      ...NULLABLE_FIELDS.projects,
      ...meta,
      id: "p1",
      clientId: "c1",
      name: "Original",
      color: "#111111",
    };
    const updatedProject1 = { ...originalProject1, name: "Updated" };
    const project2 = {
      ...NULLABLE_FIELDS.projects,
      ...meta,
      id: "p2",
      clientId: "c2",
      name: "Second",
      color: "#222222",
    };
    const project3 = {
      ...NULLABLE_FIELDS.projects,
      ...meta,
      id: "p3",
      clientId: "c1",
      name: "Inserted",
      color: "#333333",
    };
    const before = makeAppData({
      clients: [originalClient1, client2, client3],
      projects: [originalProject1, project2],
    });
    const after = makeAppData({
      clients: [updatedClient1, client4, client3],
      projects: [updatedProject1, project3],
    });
    const history = createDemoHistoryEntry(before, after);
    if (!history) throw new Error("Expected a history entry for changed rows.");

    const undone = applyDemoRowCommands(after, history.inverse);
    expect(undone.clients.map(({ id }) => id)).toEqual(["c1", "c2", "c3"]);
    expect(undone.projects.map(({ id }) => id)).toEqual(["p1", "p2"]);
    expect(undone.clients[0]?.name).toBe("Original");
    expect(Date.parse(undone.clients[0]?.updatedAt ?? T)).toBeGreaterThan(Date.parse(T));
    expect(undone.clients[1]).toEqual(client2);

    const redone = applyDemoRowCommands(undone, history.forward);
    expect(redone.clients.map(({ id }) => id)).toEqual(["c1", "c4", "c3"]);
    expect(redone.projects.map(({ id }) => id)).toEqual(["p1", "p3"]);
    expect(Date.parse(redone.clients[0]?.updatedAt ?? T)).toBeGreaterThan(
      Date.parse(undone.clients[0]?.updatedAt ?? T),
    );
    expect(after.clients.map(({ id }) => id)).toEqual(["c1", "c4", "c3"]);
    expect(after.projects.map(({ id }) => id)).toEqual(["p1", "p3"]);
    expect(after.clients[0]).toBe(updatedClient1);
    expect(before.clients.map(({ id }) => id)).toEqual(["c1", "c2", "c3"]);
    expect(before.projects.map(({ id }) => id)).toEqual(["p1", "p2"]);
  });

  it("restores a large deleted group in its original order", () => {
    const clients = Array.from({ length: 20_000 }, (_, index) => ({
      ...NULLABLE_FIELDS.clients,
      ...meta,
      id: `c${index}`,
      name: `Client ${index}`,
      color: "#111111",
    }));
    const before = makeAppData({ clients });
    const after = makeAppData();
    const history = createDemoHistoryEntry(before, after);
    if (!history) throw new Error("Expected a history entry for the deleted clients.");

    const restored = applyDemoRowCommands(after, history.inverse);

    expect(restored.clients).toHaveLength(clients.length);
    expect(restored.clients[0]?.id).toBe("c0");
    expect(restored.clients.at(-1)?.id).toBe("c19999");
    expect(restored.clients.every((row, index) => row.id === `c${index}`)).toBe(true);
    expect(after.clients).toEqual([]);
    expect(before.clients).toBe(clients);
  });
});
