import { requireCreated } from "@/test/requireCreated";
import { beforeEach, describe, expect, it } from "vitest";
import type { Draft } from "./useStore";
import type { Resource, TimeOff } from "@capacitylens/shared/types/entities";
import { DEFAULT_ACCOUNT_ID, makeResource, makeResourceDraft, resetStoreWithAccount } from "@/test/fixtures";
import { useStore } from "./useStore";

const state = () => useStore.getState();

beforeEach(async () => resetStoreWithAccount());

async function timeOffSetup() {
  const resource = await requireCreated(state().addResource(makeResourceDraft()));
  const draft = (overrides: Partial<Draft<TimeOff>> = {}): Draft<TimeOff> => ({
    resourceId: resource.id,
    startDate: "2026-06-01",
    endDate: "2026-06-02",
    type: "holiday",
    ...overrides,
  });
  useStore.setState({ past: [], future: [] });
  return { resource, draft };
}

describe("atomic time-off creation: happy path", () => {
  it("creates a complete batch with unique ids, account stamps, and copied notes", async () => {
    const { draft } = await timeOffSetup();
    const publishedBatchSizes: number[] = [];
    let data = state().data;
    const unsubscribe = useStore.subscribe(() => {
      if (state().data !== data) {
        publishedBatchSizes.push(state().data.timeOff.length);
        data = state().data;
      }
    });

    const created = await requireCreated(
      state().addTimeOffs([
        draft({ note: "First note" }),
        draft({ startDate: "2026-06-08", endDate: "2026-06-10", note: "Second note" }),
      ]),
    );
    unsubscribe();

    expect(publishedBatchSizes.length).toBeGreaterThan(0);
    expect(publishedBatchSizes.every((size) => size === 2)).toBe(true);
    expect(created).toHaveLength(2);
    expect(new Set(created.map((timeOff) => timeOff.id)).size).toBe(2);
    expect(created.every((timeOff) => timeOff.accountId === DEFAULT_ACCOUNT_ID)).toBe(true);
    expect(created.map((timeOff) => timeOff.note)).toEqual(["First note", "Second note"]);
    expect(created.every((timeOff) => !Object.hasOwn(timeOff, "seriesId"))).toBe(true);
    expect(state().data.timeOff).toEqual(created);
    expect(state().planning.history.past).toHaveLength(2);
  });
});

describe("atomic time-off creation: atomic validation", () => {
  it("rejects an empty batch and an invalid middle row atomically", async () => {
    const { draft } = await timeOffSetup();

    await expect(requireCreated(state().addTimeOffs([]))).rejects.toThrow(/at least one time-off entry/i);
    expect(state().data.timeOff).toHaveLength(0);

    let dataPublications = 0;
    let data = state().data;
    const unsubscribe = useStore.subscribe(() => {
      if (state().data !== data) {
        dataPublications += 1;
        data = state().data;
      }
    });
    await expect(
      requireCreated(
        state().addTimeOffs([
          draft(),
          draft({ startDate: "2026-07-10", endDate: "2026-07-01" }),
          draft({ startDate: "2026-08-01", endDate: "2026-08-02" }),
        ]),
      ),
    ).rejects.toThrow(/end date cannot be before/i);
    unsubscribe();

    expect(dataPublications).toBe(0);
    expect(state().data.timeOff).toHaveLength(0);
    expect(state().planning.history.past).toHaveLength(1);
  });
});

describe("atomic time-off creation: resource validation", () => {
  it("rejects dangling, cross-account, and external resources before publication", async () => {
    const { draft, resource } = await timeOffSetup();
    const foreignResource: Resource = makeResource({ id: "foreign-resource", accountId: "foreign-account" });
    useStore.setState({
      data: { ...state().data, resources: [...state().data.resources, foreignResource] },
      past: [],
      future: [],
    });

    await expect(
      requireCreated(state().addTimeOffs([draft(), draft({ resourceId: "missing-resource" })])),
    ).rejects.toThrow(/existing resource in this company/i);
    await expect(
      requireCreated(state().addTimeOffs([draft(), draft({ resourceId: foreignResource.id })])),
    ).rejects.toThrow(/existing resource in this company/i);

    const external = await requireCreated(
      state().addResource({ ...makeResourceDraft(), kind: "external", name: "Partner" }),
    );
    await expect(requireCreated(state().addTimeOffs([draft(), draft({ resourceId: external.id })]))).rejects.toThrow(
      /external.*3rd-party/i,
    );

    expect(state().data.timeOff).toHaveLength(0);
    expect(state().data.resources.map(({ id }) => id)).toContain(resource.id);
  });
});

describe("atomic time-off creation: history", () => {
  it("uses one undo/redo step for the complete batch and keeps addTimeOff working", async () => {
    const { draft } = await timeOffSetup();
    const historyBeforeBatch = state().planning.history.past.length;
    const created = await requireCreated(
      state().addTimeOffs([draft(), draft({ startDate: "2026-06-08", endDate: "2026-06-10" })]),
    );
    expect(state().planning.history.past).toHaveLength(historyBeforeBatch + 1);

    await state().undoPlanning();
    expect(state().data.timeOff).toHaveLength(0);
    await state().redoPlanning();
    const redone = state().data.timeOff;
    expect(redone.map((timeOff) => ({ ...timeOff, updatedAt: null }))).toEqual(
      created.map((timeOff) => ({ ...timeOff, updatedAt: null })),
    );
    expect(
      redone.every((timeOff, index) => Date.parse(timeOff.updatedAt) > Date.parse(created[index]?.updatedAt ?? "")),
    ).toBe(true);

    const single = await requireCreated(state().addTimeOff(draft({ startDate: "2026-06-15", endDate: "2026-06-15" })));
    expect(state().data.timeOff.at(-1)).toEqual(single);
    expect(state().planning.history.past).toHaveLength(historyBeforeBatch + 2);
  });
});

describe("atomic time-off creation: viewer guard", () => {
  it("applies the Viewer guard to the whole batch without data or history mutation", async () => {
    const { draft } = await timeOffSetup();
    const pastBefore = state().planning.history.past;
    const futureBefore = state().planning.history.future;
    state().setActiveRole("viewer");
    const returned = await state().addTimeOffs([draft(), draft({ startDate: "2026-06-08", endDate: "2026-06-10" })]);

    expect(returned).toEqual({ kind: "blocked" });
    expect(state().data.timeOff).toHaveLength(0);
    expect(state().planning.history.past).toBe(pastBefore);
    expect(state().planning.history.future).toBe(futureBefore);
    expect(state().notice).toMatchObject({ tone: "error" });
  });
});
