import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from "./useStore";
import { makeClient, makeResourceDraft, resetStoreWithAccount } from "@/test/fixtures";
import { requireCreated } from "@/test/requireCreated";

beforeEach(async () => {
  await resetStoreWithAccount();
  useStore.setState({ activeAccountLoadFailed: null });
});

describe("typed planning domain rejections", () => {
  it("refuses a write while the active company's load failed", async () => {
    useStore.setState({ activeAccountLoadFailed: useStore.getState().activeAccountId });
    await expect(useStore.getState().addClient({ name: "Wayne Enterprises", color: "#2d75da" })).rejects.toThrow(
      /not loaded/i,
    );
  });

  it("refuses a foreign row while treating an absent id as stale", async () => {
    const foreign = makeClient({ id: "foreign-client", accountId: "a2" });
    useStore.setState((state) => ({ data: { ...state.data, clients: [...state.data.clients, foreign] } }));
    await expect(useStore.getState().updateClient(foreign.id, { name: "Changed" })).rejects.toMatchObject({
      code: "record_wrong_account",
    });
    await expect(useStore.getState().updateClient("missing", { name: "Changed" })).resolves.toBeUndefined();
    expect(useStore.getState().data.clients.find((row) => row.id === foreign.id)).toBe(foreign);
  });

  it("rejects an empty company working week before normalization", async () => {
    const account = useStore.getState().data.accounts[0];
    if (!account) throw new Error("Expected account fixture.");
    await expect(useStore.getState().updateAccount(account.id, { workingDays: [] })).rejects.toThrow(
      /at least one working day/i,
    );
    expect(useStore.getState().data.accounts[0]?.workingDays).toEqual(account.workingDays);
  });

  it("restores the previous working week when the latest settings change is undone", async () => {
    const account = useStore.getState().data.accounts[0];
    if (!account) throw new Error("Expected account fixture.");
    await useStore.getState().updateAccount(account.id, { workingDays: [1, 3, 5] });
    useStore.getState().addAccount({ name: "Stark Industries", color: "#2d75da", weekStartsOn: 0 });
    expect(useStore.getState().data.accounts.find((row) => row.id === account.id)?.workingDays).toEqual([1, 3, 5]);
    await useStore.getState().updateAccount(account.id, { workingDays: [2, 4] });
    expect(useStore.getState().planning.history.past.at(-1)?.inverse).toMatchObject({
      operation: "settings.update",
      changes: { workingDays: [1, 3, 5] },
    });
    await useStore.getState().undoPlanning();
    expect(useStore.getState().data.accounts.find((row) => row.id === account.id)?.workingDays).toEqual([1, 3, 5]);
  });

  it("rejects project attribution supplied for an internal activity", async () => {
    await expect(
      useStore.getState().addActivity({ name: "Operations", kind: "internal", projectId: "project-not-allowed" }),
    ).rejects.toMatchObject({ code: "activity_project_forbidden" });
    expect(useStore.getState().data.activities).toHaveLength(0);
  });

  it("rejects supplied placeholder fields outside the ordinary-write defaults", async () => {
    const client = await requireCreated(useStore.getState().addClient({ name: "Wayne Enterprises", color: "#2d75da" }));
    const project = await requireCreated(
      useStore.getState().addProject({ name: "Batcave", clientId: client.id, color: "#2d75da" }),
    );
    const draft = makeResourceDraft({ kind: "placeholder", projectId: project.id });
    await expect(useStore.getState().addResource({ ...draft, engagement: "supplementary" })).rejects.toThrow();
    const placeholder = await requireCreated(useStore.getState().addResource(draft));
    await expect(useStore.getState().updateResource(placeholder.id, { engagement: "supplementary" })).rejects.toThrow();
    await expect(
      useStore.getState().updateResource(placeholder.id, { workingDays: [0, 6], halfDays: [6] }),
    ).rejects.toThrow();
    expect(useStore.getState().data.resources.find((row) => row.id === placeholder.id)).toMatchObject({
      engagement: "studio",
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
    });
  });

  it("keeps the dangling time-off resource reason before a command is sent", async () => {
    await expect(
      useStore.getState().addTimeOff({
        resourceId: "missing-resource",
        startDate: "2026-06-01",
        endDate: "2026-06-02",
        type: "holiday",
      }),
    ).rejects.toMatchObject({ code: "time_off_resource_invalid" });
    expect(useStore.getState().data.timeOff).toHaveLength(0);
  });

  it("keeps the closure-name code after a typed command is rejected", async () => {
    await expect(
      useStore.getState().addClosure({ name: "  ", startDate: "2026-12-24", endDate: "2026-12-25" }),
    ).rejects.toMatchObject({ code: "closure_name_required" });
    expect(useStore.getState().data.closures).toHaveLength(0);
  });
});
