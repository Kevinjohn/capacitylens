import { requireCreated } from "@/test/requireCreated";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { AllocationBar } from "./AllocationBar";
import { useStore } from "@/store/useStore";
import { resetStoreWithAccount, DEFAULT_ACCOUNT_ID, makeResourceDraft } from "@/test/fixtures";
import { renderWithTooltip as render, GEOM, indexAtClientX } from "./__tests__/schedulerTestKit";

import { barFor, getStoredAllocation, seedAllocation } from "./__tests__/allocationBarInteractionTestKit";

beforeEach(() => resetStoreWithAccount());

const enableDays = () => useStore.getState().updateAccount(DEFAULT_ACCOUNT_ID, { schedulingMode: "days" });

function registerDayModeResizeTests() {
  it("rescales hours/day when the end is resized by keyboard (Shift+arrow)", () => {
    enableDays();

    const a = seedAllocation();
    render(<AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);

    fireEvent.keyDown(screen.getByTestId("allocation-bar"), { key: "ArrowRight", shiftKey: true });
    const after = getStoredAllocation(a.id);

    expect(after.endDate).toBe("2026-06-04");
    expect(after.hoursPerDay).toBe(6);
  });

  it("leaves hours/day untouched on a move (span unchanged)", () => {
    enableDays();
    const a = seedAllocation();
    render(<AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);

    fireEvent.keyDown(screen.getByTestId("allocation-bar"), { key: "ArrowRight" });
    const after = getStoredAllocation(a.id);
    expect(after.hoursPerDay).toBe(8);
  });

  it("rescales hours/day when the end grip is dragged", () => {
    enableDays();
    const a = seedAllocation();
    render(<AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);

    fireEvent.pointerDown(screen.getByTestId("resize-end"), { clientX: 144, button: 0 });

    document.dispatchEvent(new MouseEvent("pointermove", { clientX: 192, bubbles: true }));
    document.dispatchEvent(new MouseEvent("pointerup", { clientX: 192, bubbles: true }));

    const after = getStoredAllocation(a.id);
    expect(after.endDate).toBe("2026-06-04");
    expect(after.hoursPerDay).toBe(6);
  });
}

function registerDayModeKeyboardNoticeTests() {
  it("surfaces a non-blocking notice when a shrink-resize clamps the work volume at the cap", async () => {
    enableDays();
    const st = useStore.getState();
    const c = requireCreated(st.addClient({ name: "Ferris", color: "#1" }));
    const p = requireCreated(st.addProject({ name: "P", clientId: c.id, color: "#2" }));
    const t = requireCreated(st.addActivity({ name: "Wires", kind: "project", projectId: p.id }));
    const r = requireCreated(st.addResource(makeResourceDraft({ name: "Ty", role: "Dev", color: "#3" })));
    // Mon 06-01..Tue 06-02 = 2 working days at 24h/day = 48h of work. Shrinking to 1 working
    // day would need 48h/day, clamped to 24, so half the volume is lost (the user must be told).
    const a = requireCreated(
      st.addAllocation({
        resourceId: r.id,
        activityId: t.id,
        startDate: "2026-06-01",
        endDate: "2026-06-02",
        hoursPerDay: 24,
        status: "confirmed",
      }),
    );
    render(<AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);

    fireEvent.keyDown(screen.getByTestId("allocation-bar"), { key: "ArrowLeft", shiftKey: true });
    const after = getStoredAllocation(a.id);
    expect(after.endDate).toBe("2026-06-01");
    expect(after.hoursPerDay).toBe(24);
    await waitFor(() => expect(useStore.getState().notice?.message).toMatch(/capped at 24h\/day/i));
    const notice = useStore.getState().notice;
    expect(notice?.message).toMatch(/capped at 24h\/day/i);
    // The truncation warning must remain until dismissed because it is the only signal of lost work volume.
    expect(notice?.tone).toBe("warning");
  });

  it("does NOT show the cap notice on a normal in-range resize", async () => {
    enableDays();

    const a = seedAllocation();
    render(<AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);

    fireEvent.keyDown(screen.getByTestId("allocation-bar"), { key: "ArrowRight", shiftKey: true });
    const after = getStoredAllocation(a.id);
    expect(after.hoursPerDay).toBe(6);

    await waitFor(() => expect(useStore.getState().srAnnouncement).not.toBeNull());
    expect(useStore.getState().notice?.message ?? "").not.toMatch(/capped/i);
  });
}

function registerDayModePointerNoticeTests() {
  it("raises the PERSISTENT warning tone when a POINTER shrink-resize clamps the work volume", async () => {
    // Pointer resize must publish the same persistent truncation warning as keyboard resize when the hours cap reduces work volume.
    enableDays();
    const st = useStore.getState();
    const c = requireCreated(st.addClient({ name: "Ferris", color: "#1" }));
    const p = requireCreated(st.addProject({ name: "P", clientId: c.id, color: "#2" }));
    const t = requireCreated(st.addActivity({ name: "Wires", kind: "project", projectId: p.id }));
    const r = requireCreated(st.addResource(makeResourceDraft({ name: "Ty", role: "Dev", color: "#3" })));

    const a = requireCreated(
      st.addAllocation({
        resourceId: r.id,
        activityId: t.id,
        startDate: "2026-06-01",
        endDate: "2026-06-02",
        hoursPerDay: 24,
        status: "confirmed",
      }),
    );
    render(<AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);

    fireEvent.pointerDown(screen.getByTestId("resize-end"), { clientX: 96, button: 0 });
    document.dispatchEvent(new MouseEvent("pointermove", { clientX: 48, bubbles: true }));
    document.dispatchEvent(new MouseEvent("pointerup", { clientX: 48, bubbles: true }));

    const after = getStoredAllocation(a.id);
    expect(after.endDate).toBe("2026-06-01");
    expect(after.hoursPerDay).toBe(24);
    await waitFor(() => expect(useStore.getState().notice?.message).toMatch(/capped at 24h\/day/i));
    const notice = useStore.getState().notice;
    expect(notice?.message).toMatch(/capped at 24h\/day/i);

    expect(notice?.tone).toBe("warning");
  });

  it("keeps the POINTER move confirmation TRANSIENT (info) when nothing is clamped", async () => {
    enableDays();

    const a = seedAllocation();
    render(<AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);

    fireEvent.pointerDown(screen.getByTestId("allocation-bar"), { clientX: 50, button: 0 });

    document.dispatchEvent(new MouseEvent("pointermove", { clientX: 98, bubbles: true }));
    document.dispatchEvent(new MouseEvent("pointerup", { clientX: 98, bubbles: true }));

    await waitFor(() => expect(useStore.getState().notice?.tone).toBe("info"));
    const notice = useStore.getState().notice;
    expect(notice?.message ?? "").not.toMatch(/capped/i);
    expect(notice?.tone).toBe("info");
  });

  it("hourly mode keeps hours/day fixed on resize (regression guard)", () => {
    const a = seedAllocation();
    render(<AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);

    fireEvent.keyDown(screen.getByTestId("allocation-bar"), { key: "ArrowRight", shiftKey: true });
    const after = getStoredAllocation(a.id);
    expect(after.endDate).toBe("2026-06-04");
    expect(after.hoursPerDay).toBe(8);
  });
}

function registerDayModeSuite() {
  describe("days mode preserves volume on resize", () => {
    registerDayModeResizeTests();
    registerDayModeKeyboardNoticeTests();
    registerDayModePointerNoticeTests();
  });
}

// Keyboard edits announce the updated visible-window conflict result through the polite live region; pointer drag feedback remains visual.

describe("AllocationBar day-mode resize interactions", registerDayModeSuite);
