import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAllocationCommands } from "./allocationSubmit";

vi.mock("./allocationDraft", () => ({
  resolveEndDate: () => "2026-06-03",
  validateAllocationDraft: () => true,
}));

function commandInput(overrides: Record<string, unknown> = {}) {
  return {
    data: { activities: [], allocations: [], closures: [], timeOff: [] },
    create: { resourceId: "r1", startDate: "2026-06-01", endDate: "2026-06-03" },
    editing: undefined,
    mode: "hourly",
    resourceId: "r1",
    activityId: "a1",
    selectedResource: undefined,
    selectedActivity: undefined,
    selectedEffectiveProjectId: undefined,
    attributedProjectId: undefined,
    selectedEffectiveWeek: undefined,
    startDate: "2026-06-01",
    endDate: "2026-06-03",
    effEndDate: "2026-06-03",
    hoursPerDay: 8,
    effHoursPerDay: 8,
    daysOver: 0,
    initialDaysOver: 0,
    daysOfWork: 3,
    ignoreWeekends: false,
    status: "confirmed",
    note: "",
    noteEdited: false,
    task: "",
    repeat: "none",
    repeatUntil: "2026-06-03",
    repeatToday: "2026-06-01",
    repeatUntilMaximum: undefined,
    isBlocks: false,
    isDays: false,
    isExternal: false,
    usesTypedDateRange: false,
    typedDateSpanTooLong: false,
    validDaysOver: true,
    spanFitsDateDomain: true,
    spanLimitedByDateDomain: false,
    maximumDaysOver: 30,
    fail: vi.fn(),
    canEdit: true,
    onClose: vi.fn(),
    setConfirmDelete: vi.fn(),
    addAllocation: vi.fn(),
    duplicateAllocation: vi.fn(),
    addAllocations: vi.fn(),
    updateAllocation: vi.fn(),
    deleteAllocation: vi.fn(),
    deleteAllocationSeriesFrom: vi.fn(),
    ...overrides,
  } as unknown as Parameters<typeof createAllocationCommands>[0];
}

describe("allocation submission acknowledgement", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("keeps the dialog open until the create is acknowledged", async () => {
    let acknowledge!: (result: { kind: "created" }) => void;
    const addAllocation = vi.fn(() => new Promise<{ kind: "created" }>((resolve) => (acknowledge = resolve)));
    const input = commandInput({ addAllocation });
    const commands = createAllocationCommands(input);

    const submission = commands.submit();
    expect(input.onClose).not.toHaveBeenCalled();

    acknowledge({ kind: "created" });
    await submission;
    expect(input.onClose).toHaveBeenCalledOnce();
  });

  it("surfaces a refused create and leaves the dialog open", async () => {
    const fail = vi.fn();
    const input = commandInput({
      fail,
      addAllocation: vi.fn().mockRejectedValue(new Error("write refused")),
    });
    const commands = createAllocationCommands(input);

    await commands.submit();

    expect(input.onClose).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith(null, "write refused");
  });

  it("keeps a duplicate open until its create is acknowledged", async () => {
    let acknowledge!: (result: { kind: "created" }) => void;
    const duplicateAllocation = vi.fn(() => new Promise<{ kind: "created" }>((resolve) => (acknowledge = resolve)));
    const input = commandInput({
      create: undefined,
      editing: { id: "allocation-1", resourceId: "r1" },
      duplicateAllocation,
    });
    const commands = createAllocationCommands(input);

    const duplication = commands.onDuplicate();
    expect(input.onClose).not.toHaveBeenCalled();

    acknowledge({ kind: "created" });
    await duplication;
    expect(duplicateAllocation).toHaveBeenCalledWith("allocation-1", expect.any(Object));
    expect(input.onClose).toHaveBeenCalledOnce();
  });
});
