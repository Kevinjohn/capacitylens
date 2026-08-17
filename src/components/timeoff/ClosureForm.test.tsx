import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { resetStoreWithAccount } from "../../test/fixtures";
import { useStore } from "../../store/useStore";
import { ClosureForm } from "./ClosureForm";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-03T12:00:00.000Z"));
  resetStoreWithAccount();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ClosureForm", () => {
  it("rejects an empty required name", () => {
    render(<ClosureForm onClose={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Enter a closure name.");
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    expect(useStore.getState().data.closures).toHaveLength(0);
  });

  it("rejects an end date before the start date", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<ClosureForm onClose={() => {}} />);

    await user.type(screen.getByLabelText("Name"), "Summer shutdown");
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "2026-08-10" } });
    fireEvent.change(screen.getByLabelText("End"), { target: { value: "2026-08-08" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert")).toHaveTextContent("End date cannot be before the start date.");
    expect(screen.getByLabelText("Start")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("End")).toHaveAttribute("aria-invalid", "true");
    expect(useStore.getState().data.closures).toHaveLength(0);
  });

  it("stores only the trimmed name and inclusive dates", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    render(<ClosureForm onClose={onClose} />);

    await user.type(screen.getByLabelText("Name"), "  Christmas shutdown  ");
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "2026-12-24" } });
    fireEvent.change(screen.getByLabelText("End"), { target: { value: "2026-12-27" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(useStore.getState().data.closures[0]).toMatchObject({
      name: "Christmas shutdown",
      startDate: "2026-12-24",
      endDate: "2026-12-27",
    });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
