import { NULLABLE_FIELDS } from "@capacitylens/shared/types/nullableFields";
import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from "./useStore";
import {
  DEFAULT_ACCOUNT_ID,
  makeAppData,
  makeResource,
  requireValue,
  resetStoreWithAccount,
  WORKDAYS,
} from "@/test/fixtures";

const T = "2026-01-01T00:00:00.000Z";
const OLD = "2020-01-01T00:00:00.000Z";
const meta = { accountId: DEFAULT_ACCOUNT_ID, createdAt: T, updatedAt: T };

beforeEach(() => resetStoreWithAccount());

describe("demo row-command history", () => {
  it("re-stamps an undo of unchanged content and keeps only the changed row", () => {
    useStore.getState().replaceAll(
      makeAppData({
        clients: [{ ...NULLABLE_FIELDS.clients, ...meta, id: "c1", name: "Client", color: "#111111" }],
      }),
    );
    useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID);

    useStore.getState().updateClient("c1", { name: "Client" });
    const afterNoOpUpdate = useStore.getState().data;
    const savedRevision = requireValue(afterNoOpUpdate.clients[0], "saved client").updatedAt;
    const entry = requireValue(useStore.getState().past.at(-1), "update history entry");

    expect(entry.forward).toHaveLength(1);
    expect(entry.inverse).toHaveLength(1);
    expect(entry.forward[0]).toMatchObject({ operation: "upsert", entity: "clients", row: { id: "c1" } });

    useStore.getState().undo();
    const restored = requireValue(useStore.getState().data.clients[0], "restored client");
    expect(restored).toMatchObject({ name: "Client", color: "#111111" });
    expect(Date.parse(restored.updatedAt)).toBeGreaterThan(Date.parse(savedRevision));

    const undoRevision = restored.updatedAt;
    useStore.getState().redo();
    expect(Date.parse(requireValue(useStore.getState().data.clients[0], "redone client").updatedAt)).toBeGreaterThan(
      Date.parse(undoRevision),
    );
  });

  it("keeps history proportional to changed rows in a large demo company", () => {
    const clients = Array.from({ length: 75_000 }, (_, index) => ({
      ...NULLABLE_FIELDS.clients,
      ...meta,
      id: `client-${index}`,
      name: `Client ${index}`,
      color: "#111111",
    }));
    useStore.getState().replaceAll(makeAppData({ clients }));
    useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID);
    useStore.getState().addClient({ name: "Last client", color: "#222222" });

    const entry = requireValue(useStore.getState().past.at(-1), "create history entry");
    expect(entry.forward).toHaveLength(1);
    expect(entry.inverse).toHaveLength(1);
    expect(() => useStore.getState().undo()).not.toThrow();
    expect(useStore.getState().data.clients).toHaveLength(75_000);
  });

  it("rejects legacy store writes when production planning is attached", () => {
    const client = useStore.getState().addClient({ name: "Client", color: "#111111" });
    if (client.kind !== "created") throw new Error("Expected the demo client to be created.");
    useStore.setState((state) => ({
      planning: { ...state.planning, context: { identity: "actor-1", companyId: DEFAULT_ACCOUNT_ID } },
    }));
    const before = useStore.getState().data;
    const history = useStore.getState().past;

    expect(() => useStore.getState().updateClient(client.value.id, { name: "Production bypass" })).toThrow(
      /production planning writes must use typed actions/i,
    );
    expect(useStore.getState().data).toBe(before);
    expect(useStore.getState().past).toBe(history);
    useStore.setState((state) => ({ planning: { ...state.planning, context: null } }));
  });

  it("restores a deleted phase and its activity binding without changing IDs", () => {
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

    useStore.getState().deletePhase("ph1");
    const afterDelete = useStore.getState().data;
    const changed = requireValue(useStore.getState().past.at(-1), "delete history entry");
    expect(changed.forward).toHaveLength(2);
    expect(requireValue(afterDelete.activities[0], "activity").phaseId).toBeNull();

    useStore.getState().undo();
    expect(useStore.getState().data.phases.map(({ id }) => id)).toContain("ph1");
    expect(useStore.getState().data.activities[0]).toMatchObject({ id: "act1", phaseId: "ph1" });
    expect(useStore.getState().data.activities[0]?.updatedAt).not.toBe(T);
  });

  it("restores a resource discipline binding when undoing a discipline delete", () => {
    useStore.getState().replaceAll(
      makeAppData({
        disciplines: [{ ...NULLABLE_FIELDS.disciplines, ...meta, id: "d1", name: "Design", sortOrder: 0 }],
        resources: [makeResource({ ...meta, id: "r1", name: "Person", disciplineId: "d1", color: "#333333" })],
      }),
    );
    useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID);

    useStore.getState().deleteDiscipline("d1");
    expect(requireValue(useStore.getState().data.resources[0], "resource").disciplineId).toBeNull();
    useStore.getState().undo();

    expect(useStore.getState().data.disciplines.map(({ id }) => id)).toContain("d1");
    expect(useStore.getState().data.resources[0]).toMatchObject({ id: "r1", disciplineId: "d1" });
  });

  it("keeps purged placeholder links erased because purge clears demo history", () => {
    useStore.getState().replaceAll(
      makeAppData({
        clients: [
          {
            ...NULLABLE_FIELDS.clients,
            ...meta,
            id: "c1",
            name: "Client",
            color: "#111111",
            archivedAt: OLD,
            deletedAt: OLD,
          },
        ],
        projects: [
          { ...NULLABLE_FIELDS.projects, ...meta, id: "p1", clientId: "c1", name: "Project", color: "#222222" },
        ],
        resources: [
          {
            ...NULLABLE_FIELDS.resources,
            ...meta,
            id: "placeholder",
            kind: "placeholder",
            role: "Designer",
            projectId: "p1",
            employmentType: "permanent",
            engagement: "studio" as const,
            workingHoursPerDay: 8,
            workingDays: WORKDAYS,
            halfDays: [],
            color: "#333333",
          },
        ],
      }),
    );
    useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID);

    useStore.getState().purgeEntity("clients", "c1");
    const afterPurge = useStore.getState().data;
    expect(requireValue(afterPurge.resources[0], "resource").projectId).toBeNull();
    expect(useStore.getState().past).toEqual([]);
    useStore.getState().undo();
    useStore.getState().redo();
    expect(useStore.getState().data).toBe(afterPurge);
    expect(requireValue(useStore.getState().data.resources[0], "resource").projectId).toBeNull();
  });
});
