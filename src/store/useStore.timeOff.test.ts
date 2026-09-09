import { beforeEach, describe, expect, it } from "vitest";
import type { Draft } from "./useStore";
import type { Resource, TimeOff } from "@capacitylens/shared/types/entities";
import { DEFAULT_ACCOUNT_ID, makeResource, makeResourceDraft, resetStoreWithAccount } from "../test/fixtures";
import { useStore } from "./useStore";

const state = () => useStore.getState();

beforeEach(() => resetStoreWithAccount());

function timeOffSetup() {
  const resource = state().addResource(makeResourceDraft());
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
  it("creates a batch with unique ids, account stamps, copied notes, and one publication", () => {
    const { draft } = timeOffSetup();
    let publications = 0;
    const unsubscribe = useStore.subscribe(() => {
      publications += 1;
    });

    const created = state().addTimeOffs([
      draft({ note: "First note" }),
      draft({ startDate: "2026-06-08", endDate: "2026-06-10", note: "Second note" }),
    ]);
    unsubscribe();

    expect(publications).toBe(1);
    expect(created).toHaveLength(2);
    expect(new Set(created.map((timeOff) => timeOff.id)).size).toBe(2);
    expect(created.every((timeOff) => timeOff.accountId === DEFAULT_ACCOUNT_ID)).toBe(true);
    expect(created.map((timeOff) => timeOff.note)).toEqual(["First note", "Second note"]);
    expect(created.every((timeOff) => !Object.hasOwn(timeOff, "seriesId"))).toBe(true);
    expect(state().data.timeOff).toEqual(created);
    expect(state().past).toHaveLength(1);
  });
});

describe("atomic time-off creation: atomic validation", () => {
  it("rejects an empty batch and an invalid middle row atomically", () => {
    const { draft } = timeOffSetup();

    expect(() => state().addTimeOffs([])).toThrow(/at least one time off/i);
    expect(state().data.timeOff).toHaveLength(0);

    let publications = 0;
    const unsubscribe = useStore.subscribe(() => {
      publications += 1;
    });
    expect(() =>
      state().addTimeOffs([
        draft(),
        draft({ startDate: "2026-07-10", endDate: "2026-07-01" }),
        draft({ startDate: "2026-08-01", endDate: "2026-08-02" }),
      ]),
    ).toThrow(/end date cannot be before/i);
    unsubscribe();

    expect(publications).toBe(0);
    expect(state().data.timeOff).toHaveLength(0);
    expect(state().past).toHaveLength(0);
  });
});

describe("atomic time-off creation: resource validation", () => {
  it("rejects dangling, cross-account, and external resources before publication", () => {
    const { draft, resource } = timeOffSetup();
    const foreignResource: Resource = makeResource({ id: "foreign-resource", accountId: "foreign-account" });
    useStore.setState({
      data: { ...state().data, resources: [...state().data.resources, foreignResource] },
      past: [],
      future: [],
    });

    expect(() => state().addTimeOffs([draft(), draft({ resourceId: "missing-resource" })])).toThrow(
      /existing resource in this company/i,
    );
    expect(() => state().addTimeOffs([draft(), draft({ resourceId: foreignResource.id })])).toThrow(
      /existing resource in this company/i,
    );

    const external = state().addResource({ ...makeResourceDraft(), kind: "external", name: "Partner" });
    expect(() => state().addTimeOffs([draft(), draft({ resourceId: external.id })])).toThrow(/external.*3rd-party/i);

    expect(state().data.timeOff).toHaveLength(0);
    expect(state().data.resources.map(({ id }) => id)).toContain(resource.id);
  });
});

describe("atomic time-off creation: history", () => {
  it("uses one undo/redo step for the complete batch and keeps addTimeOff working", () => {
    const { draft } = timeOffSetup();
    const created = state().addTimeOffs([draft(), draft({ startDate: "2026-06-08", endDate: "2026-06-10" })]);
    expect(state().past).toHaveLength(1);

    state().undo();
    expect(state().data.timeOff).toHaveLength(0);
    state().redo();
    expect(state().data.timeOff).toEqual(created);

    const single = state().addTimeOff(draft({ startDate: "2026-06-15", endDate: "2026-06-15" }));
    expect(state().data.timeOff.at(-1)).toEqual(single);
    expect(state().past).toHaveLength(2);
  });
});

describe("atomic time-off creation: viewer guard", () => {
  it("applies the Viewer guard to the whole batch without data or history mutation", () => {
    const { draft } = timeOffSetup();
    state().setActiveRole("viewer");
    const returned = state().addTimeOffs([draft(), draft({ startDate: "2026-06-08", endDate: "2026-06-10" })]);

    expect(returned).toHaveLength(2);
    expect(state().data.timeOff).toHaveLength(0);
    expect(state().past).toHaveLength(0);
    expect(state().future).toHaveLength(0);
    expect(state().notice).toMatchObject({ tone: "error" });
  });
});
