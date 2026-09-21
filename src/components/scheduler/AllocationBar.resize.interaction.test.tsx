import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { AllocationBar } from "./AllocationBar";
import { useStore } from "../../store/useStore";
import { resetStoreWithAccount, DEFAULT_ACCOUNT_ID, makeResourceDraft } from "../../test/fixtures";
import { renderWithTooltip as render, GEOM, indexAtClientX } from "./__tests__/schedulerTestKit";

import { barFor, getStoredAllocation, seedAllocation } from "./__tests__/allocationBarInteractionTestKit";

beforeEach(() => resetStoreWithAccount());

const enableDays = () => useStore.getState().updateAccount(DEFAULT_ACCOUNT_ID, { schedulingMode: "days" });

function registerDayModeResizeTests() {
  it("rescales hours/day when the end is resized by keyboard (Shift+arrow)", () => {
    enableDays();
    const a = seedAllocation(); // 2026-06-01 → 2026-06-03, 8h/day, Mon–Fri = 3 working days
    render(<AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);

    fireEvent.keyDown(screen.getByTestId("allocation-bar"), { key: "ArrowRight", shiftKey: true });
    const after = getStoredAllocation(a.id);
    // Span grows 3 → 4 working days; the 24h of work (8×3) now spreads over 4 → 6h/day.
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
    document.dispatchEvent(new MouseEvent("pointermove", { clientX: 192, bubbles: true })); // +48px ≈ +1 day
    document.dispatchEvent(new MouseEvent("pointerup", { clientX: 192, bubbles: true }));

    const after = getStoredAllocation(a.id);
    expect(after.endDate).toBe("2026-06-04");
    expect(after.hoursPerDay).toBe(6);
  });
}

function registerDayModeKeyboardNoticeTests() {
  it("surfaces a non-blocking notice when a shrink-resize clamps the work volume at the cap", () => {
    enableDays();
    const st = useStore.getState();
    const c = st.addClient({ name: "Acme", color: "#1" });
    const p = st.addProject({ name: "P", clientId: c.id, color: "#2" });
    const t = st.addActivity({ name: "Wires", kind: "project", projectId: p.id });
    const r = st.addResource(makeResourceDraft({ name: "Ty", role: "Dev", color: "#3" }));
    // Mon 06-01..Tue 06-02 = 2 working days at 24h/day = 48h of work. Shrinking to 1 working
    // day would need 48h/day — clamped to 24, so half the volume is lost (the user must be told).
    const a = st.addAllocation({
      resourceId: r.id,
      activityId: t.id,
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      hoursPerDay: 24,
      status: "confirmed",
    });
    render(<AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);

    // Shift+ArrowLeft resizes the END edge inward by a day → span 2 → 1 working day.
    fireEvent.keyDown(screen.getByTestId("allocation-bar"), { key: "ArrowLeft", shiftKey: true });
    const after = getStoredAllocation(a.id);
    expect(after.endDate).toBe("2026-06-01"); // collapsed to a single day
    expect(after.hoursPerDay).toBe(24); // clamped at the cap
    const notice = useStore.getState().notice;
    expect(notice?.message).toMatch(/capped at 24h\/day/i);
    // WCAG 2.2.1: the clamp truncated work, and this toast is the SOLE signal of that silent loss.
    // It must be raised with the PERSISTENT 'warning' tone (AppShell → duration: Infinity + close
    // button), NOT the transient 'info' tone that auto-dismisses on the fixed 4s timer.
    expect(notice?.tone).toBe("warning");
  });

  it("does NOT show the cap notice on a normal in-range resize", () => {
    enableDays();
    const a = seedAllocation(); // 8h over 3 days; growing to 4 days → 6h/day, well under the cap
    render(<AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);
    // No baseline needed: resetStoreWithAccount (beforeEach) already clears any leaked notice,
    // so this proves the resize itself doesn't RAISE a cap notice — order-independently.

    fireEvent.keyDown(screen.getByTestId("allocation-bar"), { key: "ArrowRight", shiftKey: true });
    const after = getStoredAllocation(a.id);
    expect(after.hoursPerDay).toBe(6); // rescaled, in range
    // No clamp → no cap notice at all here (a keyboard nudge only raises a toast on a clamp), proving
    // the persistent 'warning' treatment is scoped to the truncation case and didn't leak onto every
    // resize — transient confirmations elsewhere stay 'info' (~4s auto-dismiss).
    expect(useStore.getState().notice?.message ?? "").not.toMatch(/capped/i);
  });
}

function registerDayModePointerNoticeTests() {
  it("raises the PERSISTENT warning tone when a POINTER shrink-resize clamps the work volume", () => {
    // Mirror of the keyboard clamp test, for the POINTER path (the OTHER clamp site, in onCommit).
    // The cap advisory rides on the post-commit confirmation toast there; on a clamp that single
    // toast must persist (tone 'warning') so the truncation isn't auto-dismissed on the 4s timer.
    enableDays();
    const st = useStore.getState();
    const c = st.addClient({ name: "Acme", color: "#1" });
    const p = st.addProject({ name: "P", clientId: c.id, color: "#2" });
    const t = st.addActivity({ name: "Wires", kind: "project", projectId: p.id });
    const r = st.addResource(makeResourceDraft({ name: "Ty", role: "Dev", color: "#3" }));
    // Mon 06-01..Tue 06-02 = 2 working days at 24h/day = 48h. Dragging the end grip inward to a
    // single day needs 48h/day — clamped to 24, half the volume lost.
    const a = st.addAllocation({
      resourceId: r.id,
      activityId: t.id,
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      hoursPerDay: 24,
      status: "confirmed",
    });
    render(<AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);

    // Drag the end grip left by ~one day (96px → 48px) to collapse 2 → 1 working day.
    fireEvent.pointerDown(screen.getByTestId("resize-end"), { clientX: 96, button: 0 });
    document.dispatchEvent(new MouseEvent("pointermove", { clientX: 48, bubbles: true }));
    document.dispatchEvent(new MouseEvent("pointerup", { clientX: 48, bubbles: true }));

    const after = getStoredAllocation(a.id);
    expect(after.endDate).toBe("2026-06-01"); // collapsed to a single day
    expect(after.hoursPerDay).toBe(24); // clamped at the cap
    const notice = useStore.getState().notice;
    expect(notice?.message).toMatch(/capped at 24h\/day/i);
    expect(notice?.tone).toBe("warning"); // WCAG 2.2.1: persists, not the 4s-auto-dismiss 'info'
  });

  it("keeps the POINTER move confirmation TRANSIENT (info) when nothing is clamped", () => {
    // Guards that the 'warning' treatment is scoped to the clamp: a normal pointer move still
    // emits the "Allocation moved …" confirmation as a transient 'info' toast (~4s auto-dismiss),
    // so we didn't make every confirmation persistent.
    enableDays();
    const a = seedAllocation(); // 8h over 3 days; a plain move clamps nothing
    render(<AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />);

    fireEvent.pointerDown(screen.getByTestId("allocation-bar"), { clientX: 50, button: 0 });
    document.dispatchEvent(new MouseEvent("pointermove", { clientX: 98, bubbles: true })); // +1 day
    document.dispatchEvent(new MouseEvent("pointerup", { clientX: 98, bubbles: true }));

    const notice = useStore.getState().notice;
    expect(notice?.message ?? "").not.toMatch(/capped/i);
    expect(notice?.tone).toBe("info"); // transient confirmation — auto-dismisses on the 4s timer
  });

  it("hourly mode keeps hours/day fixed on resize (regression guard)", () => {
    // No enableDays() — the default account is hourly.
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

// WCAG 4.1.3: a keyboard nudge that changes over-capacity must announce the recomputed outcome
// for the affected resource via the store's polite live region (srAnnouncement). Pointer drags
// (sighted feedback) must NOT announce. The announced over-count reuses the per-day over-marker
// signal (allocated > available) — NOT the visible-window % or the overSoon flag.
// Resource works Mon–Fri @ 8h. June 2026: 06-01 Mon … 06-05 Fri.
// Allocation A is FIXED on Wed 06-03. Bar B starts on Mon–Tue (no overlap → 0 over days);
// ArrowRight slides B to Tue–Wed so Wed reads 16h vs 8h available = 1 over day.

describe("AllocationBar day-mode resize interactions", registerDayModeSuite);
