import { NULLABLE_FIELDS } from "@capacitylens/shared/types/nullableFields";
import { beforeEach, describe, expect, it } from "vitest";
import { diffOps } from "@/data/syncOps";
import { useStore } from "./useStore";
import { DEFAULT_ACCOUNT_ID, makeAppData, makeResource, requireValue, resetStoreWithAccount } from "@/test/fixtures";
import type { AppData } from "@capacitylens/shared/types/entities";

const T = "2026-01-01T00:00:00.000Z";
const meta = { accountId: DEFAULT_ACCOUNT_ID, createdAt: T, updatedAt: T };

beforeEach(() => resetStoreWithAccount());

async function undoOps(afterDelete: AppData) {
  await useStore.getState().undoPlanning();
  return diffOps(afterDelete, useStore.getState().data);
}

function registerUndoSyncPart1(): void {
  it("re-stamps an undo whose content is identical but stored revision changed", async () => {
    useStore.getState().replaceAll(
      makeAppData({
        clients: [{ ...NULLABLE_FIELDS.clients, ...meta, id: "c1", name: "Client", color: "#111111" }],
      }),
    );
    useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID);
    await useStore.getState().refreshPlanning();

    await useStore.getState().updateClient("c1", { name: "Changed" });
    const afterNoOpSave = useStore.getState().data;
    const savedRevision = requireValue(afterNoOpSave.clients[0], "saved client").updatedAt;
    expect(afterNoOpSave.clients[0]?.name).toBe("Changed");
    const ops = await undoOps(afterNoOpSave);

    expect(useStore.getState().data.clients[0]).toMatchObject({ name: "Client", color: "#111111" });
    expect(Date.parse(requireValue(useStore.getState().data.clients[0], "restored client").updatedAt)).toBeGreaterThan(
      Date.parse(savedRevision),
    );
    expect(ops).toContainEqual(expect.objectContaining({ method: "PUT", table: "clients", id: "c1" }));
  });

  it("re-timestamps a tenant larger than the engine argument limit without throwing", async () => {
    const clients = Array.from({ length: 75_000 }, (_, index) => ({
      ...NULLABLE_FIELDS.clients,
      ...meta,
      id: `client-${index}`,
      name: `Client ${index}`,
      color: "#111111",
    }));
    useStore.getState().replaceAll(makeAppData({ clients }));
    useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID);
    await useStore.getState().refreshPlanning();
    await useStore.getState().addClient({ name: "Last client", color: "#222222" });
    const addedClient = requireValue(useStore.getState().data.clients.at(-1), "last client");

    await useStore.getState().undoPlanning();
    expect(useStore.getState().data.clients).toHaveLength(75_001);
    const archivedClient = requireValue(
      useStore.getState().data.clients.find((client) => client.id === addedClient.id),
      "archived client",
    );
    expect(typeof archivedClient.archivedAt).toBe("string");
  });
}

function registerUndoSyncPart2(): void {
  it("restores an activity phaseId with an activity PUT", async () => {
    useStore.getState().replaceAll(
      makeAppData({
        clients: [{ ...NULLABLE_FIELDS.clients, ...meta, id: "c1", name: "Client", color: "#111111" }],
        projects: [
          { ...NULLABLE_FIELDS.projects, ...meta, id: "p1", clientId: "c1", name: "Project", color: "#222222" },
        ],
        phases: [{ ...meta, id: "ph1", projectId: "p1", name: "Phase" }],
        activities: [
          {
            ...NULLABLE_FIELDS.activities,
            ...meta,
            id: "act1",
            projectId: "p1",
            phaseId: "ph1",
            kind: "project",
            name: "Work",
          },
        ],
      }),
    );
    useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID);
    await useStore.getState().refreshPlanning();

    await useStore.getState().deletePhase("ph1");
    const afterDelete = useStore.getState().data;
    expect(requireValue(afterDelete.activities[0], "activity")).toHaveProperty("phaseId", null);
    const ops = await undoOps(afterDelete);

    expect(ops).toContainEqual(
      expect.objectContaining({
        method: "PUT",
        table: "activities",
        id: "act1",
      }),
    );
    expect(useStore.getState().data.activities[0]?.phaseId).toBe("ph1");
  });

  it("restores a resource disciplineId with a resource PUT", async () => {
    useStore.getState().replaceAll(
      makeAppData({
        disciplines: [{ ...NULLABLE_FIELDS.disciplines, ...meta, id: "d1", name: "Design", sortOrder: 0 }],
        resources: [makeResource({ ...meta, id: "r1", name: "Person", disciplineId: "d1", color: "#333333" })],
      }),
    );
    useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID);
    await useStore.getState().refreshPlanning();

    await useStore.getState().deleteDiscipline("d1");
    const afterDelete = useStore.getState().data;
    expect(requireValue(afterDelete.resources[0], "resource")).toHaveProperty("disciplineId", null);
    const ops = await undoOps(afterDelete);

    expect(ops).toContainEqual(expect.objectContaining({ method: "PUT", table: "resources", id: "r1" }));
    expect(useStore.getState().data.resources[0]?.disciplineId).toBe("d1");
  });
}

describe("undo emits synchronization revisions for cascade-restored bindings", () => {
  registerUndoSyncPart1();
  registerUndoSyncPart2();
});
