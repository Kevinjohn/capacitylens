import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PermissionContext } from "../../auth/permissionContext";
import { resetStoreWithAccount, WORKDAYS } from "../../test/fixtures";
import { useStore } from "../../store/useStore";
import { TimeOffForm } from "./TimeOffForm";

const resourceDraft = {
  kind: "person" as const,
  name: "Bruce Wayne",
  role: "Director",
  employmentType: "permanent" as const,
  engagement: "studio" as const,
  workingHoursPerDay: 8,
  workingDays: WORKDAYS,
  halfDays: [],
  color: "#111111",
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-15T12:00:00.000Z"));
  resetStoreWithAccount();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function renderCreateForm(startDate = "2026-01-30", endDate = startDate, onClose = vi.fn()) {
  const resource = useStore.getState().addResource(resourceDraft);
  render(<TimeOffForm defaults={{ resourceId: resource.id, startDate, endDate }} onClose={onClose} />);
  return { resource, onClose };
}

function chooseRepeat(optionName: string): void {
  const repeat = screen.getByLabelText("Repeat");
  fireEvent.keyDown(repeat, { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("option", { name: optionName }));
}

function registerTimeOffRepeatBasics(): void {
  it("offers the finite repeat choices only while creating", () => {
    const { resource } = renderCreateForm();

    expect(screen.getByTestId("timeoff-repeat")).toHaveTextContent("Doesn’t repeat");
    fireEvent.keyDown(screen.getByLabelText("Repeat"), { key: "ArrowDown" });
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Doesn’t repeat",
      "Weekly",
      "Every 2 weeks",
      "Every 3 weeks",
      "Every 4 weeks",
      "Monthly on day 30",
      "Monthly on the last Friday",
    ]);

    fireEvent.keyDown(document, { key: "Escape" });
    const existing = useStore.getState().addTimeOff({
      resourceId: resource.id,
      startDate: "2026-01-30",
      endDate: "2026-01-30",
      type: "holiday",
    });
    cleanup();
    render(<TimeOffForm timeOff={existing} onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Edit time off" })).not.toHaveTextContent("Repeat");
  });

  it("suggests the final day of the twelfth calendar month and follows start edits until manually changed", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCreateForm();
    chooseRepeat("Weekly");

    const cutoff = screen.getByTestId("timeoff-repeat-until");
    expect(cutoff).toHaveValue("2026-12-31");
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "2026-02-06" } });
    expect(cutoff).toHaveValue("2027-01-31");

    await user.clear(cutoff);
    await user.type(cutoff, "2026-10-31");
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "2026-03-06" } });
    expect(cutoff).toHaveValue("2026-10-31");
  });

  it("restores an untouched cutoff suggestion after repetition is enabled with a blank start", () => {
    renderCreateForm();
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "" } });
    chooseRepeat("Weekly");
    expect(screen.getByTestId("timeoff-repeat-until")).toHaveValue("");

    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "2026-02-06" } });
    expect(screen.getByTestId("timeoff-repeat-until")).toHaveValue("2027-01-31");
  });
}

function registerTimeOffRepeatProjection(): void {
  it("previews and saves exactly twelve last Fridays without an anniversary-window thirteenth", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { resource, onClose } = renderCreateForm();
    chooseRepeat("Monthly on the last Friday");

    const preview = screen.getByTestId("timeoff-repeat-preview");
    expect(preview).toHaveTextContent("12 entries");
    expect(preview).toHaveTextContent("25 Dec 2026");
    expect(preview).toHaveTextContent("Each entry can be edited or deleted separately.");
    const ranges = screen.getByTestId("timeoff-repeat-ranges");
    await user.click(screen.getByText("Show all dates"));
    expect(ranges).toHaveTextContent("30 Jan 2026");
    expect(ranges).toHaveTextContent("25 Dec 2026");
    expect(ranges).not.toHaveTextContent("29 Jan 2027");

    await user.click(screen.getByRole("button", { name: "Save" }));
    const saved = useStore.getState().data.timeOff.filter((entry) => entry.resourceId === resource.id);
    expect(saved).toHaveLength(12);
    expect(saved.map(({ startDate }) => startDate)).toEqual([
      "2026-01-30",
      "2026-02-27",
      "2026-03-27",
      "2026-04-24",
      "2026-05-29",
      "2026-06-26",
      "2026-07-31",
      "2026-08-28",
      "2026-09-25",
      "2026-10-30",
      "2026-11-27",
      "2026-12-25",
    ]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("preserves an inclusive multi-day calendar span and copies an authorised note", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCreateForm("2026-03-27", "2026-03-29");
    await user.type(screen.getByLabelText("Note"), "  Family trip  ");
    chooseRepeat("Monthly on the last Friday");

    expect(screen.getByTestId("timeoff-repeat-preview")).toHaveTextContent("26 Feb 2027 – 28 Feb 2027");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const saved = useStore.getState().data.timeOff;
    expect(saved).toHaveLength(12);
    expect(saved.at(-1)).toMatchObject({
      startDate: "2027-02-26",
      endDate: "2027-02-28",
      note: "Family trip",
    });
    expect(saved.every((entry) => entry.note === "Family trip")).toBe(true);
  });
}

function registerTimeOffRepeatValidation(): void {
  it("rejects a non-last-weekday anchor, then unlocks submission after correction", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCreateForm("2026-01-23");
    chooseRepeat("Monthly on the last Friday");

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/start must be the last Friday/i);
    expect(screen.getByLabelText("Start")).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(screen.getByLabelText("Start")).toHaveFocus());
    expect(useStore.getState().data.timeOff).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "2026-01-30" } });
    fireEvent.change(screen.getByLabelText("End"), { target: { value: "2026-01-30" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(useStore.getState().data.timeOff).toHaveLength(12);
  });

  it("explains a cutoff that permits only the original entry and keeps the form open", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onClose } = renderCreateForm();
    chooseRepeat("Weekly");
    const cutoff = screen.getByLabelText("Repeat until");
    await user.clear(cutoff);
    await user.type(cutoff, "2026-02-05");

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/at least two entries/i);
    expect(cutoff).toHaveAttribute("aria-invalid", "true");
    expect(onClose).not.toHaveBeenCalled();
    expect(useStore.getState().data.timeOff).toHaveLength(0);
  });

  it("rejects a cutoff after the twelve-calendar-month horizon", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCreateForm();
    chooseRepeat("Weekly");
    fireEvent.change(screen.getByLabelText("Repeat until"), { target: { value: "2027-01-01" } });

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/cannot be later than 2026-12-31/i);
    expect(screen.getByLabelText("Repeat until")).toHaveFocus();
    expect(useStore.getState().data.timeOff).toHaveLength(0);
  });

  it("rejects the whole draft when a generated multi-day end exceeds the date domain", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCreateForm("9999-11-30", "9999-12-31");
    chooseRepeat("Monthly on the last Tuesday");

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/would exceed 31 December 9999/i);
    expect(useStore.getState().data.timeOff).toHaveLength(0);
  });
}

function registerTimeOffRepeatSubmission(): void {
  it("guards re-entrant submission of one accepted batch", () => {
    const { onClose } = renderCreateForm();
    chooseRepeat("Monthly on the last Friday");
    const form = screen.getByRole("dialog", { name: "Add time off" }).querySelector("form");
    if (!form) throw new Error("Expected the time-off form element.");

    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(useStore.getState().data.timeOff).toHaveLength(12);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("releases the submit guard after a synchronous store rejection", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const addMany = vi.spyOn(useStore.getState(), "addTimeOffs");
    addMany.mockImplementationOnce(() => {
      throw new Error("Temporary store refusal");
    });
    const { onClose } = renderCreateForm();
    chooseRepeat("Monthly on the last Friday");

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Temporary store refusal");
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(useStore.getState().data.timeOff).toHaveLength(12);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
}

function registerTimeOffRepeatPrivacy(): void {
  it("never renders or copies notes for a role without note access", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const resource = useStore.getState().addResource(resourceDraft);
    render(
      <PermissionContext.Provider value={{ role: "editor" }}>
        <TimeOffForm
          defaults={{ resourceId: resource.id, startDate: "2026-01-30", endDate: "2026-01-30" }}
          onClose={() => {}}
        />
      </PermissionContext.Provider>,
    );
    expect(screen.queryByLabelText("Note")).not.toBeInTheDocument();
    chooseRepeat("Monthly on the last Friday");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(useStore.getState().data.timeOff).toHaveLength(12);
    expect(useStore.getState().data.timeOff.every((entry) => entry.note === undefined)).toBe(true);
  });
}

describe("TimeOffForm repeat creation", () => {
  registerTimeOffRepeatBasics();
  registerTimeOffRepeatProjection();
  registerTimeOffRepeatValidation();
  registerTimeOffRepeatSubmission();
  registerTimeOffRepeatPrivacy();
});
