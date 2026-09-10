import { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { PersonScheduleModel, PersonScheduleResult } from "./personScheduleTypes";
import { PersonScheduleSheet } from "./PersonScheduleSheet";

const scheduleModel: PersonScheduleModel = {
  accountId: "account-1",
  resourceId: "resource-1",
  title: "Diana Prince",
  window: { startDate: "2026-09-07", endDate: "2026-10-04" },
  entries: [
    {
      kind: "allocation",
      key: "allocation:a1",
      sourceId: "a1",
      activity: "Prototype discovery",
      color: "#2563eb",
      status: "tentative",
      startDate: "2026-09-08",
      endDate: "2026-09-11",
    },
  ],
};

const availableSchedule: PersonScheduleResult = { kind: "available", model: scheduleModel };

function ControlledSheet({ onRestoreFocus = () => {} }: { onRestoreFocus?: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <PersonScheduleSheet
      open={open}
      schedule={availableSchedule}
      onOpenChange={setOpen}
      onRestoreFocus={onRestoreFocus}
    />
  );
}

describe("PersonScheduleSheet content", () => {
  it("renders an accessible fixed header and independently scrolling semantic list", () => {
    render(<PersonScheduleSheet open schedule={availableSchedule} onOpenChange={() => {}} onRestoreFocus={() => {}} />);

    const dialog = screen.getByRole("dialog", { name: "Diana Prince's schedule" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("data-testid", "person-schedule-sheet");
    expect(dialog).toHaveClass("w-full", "max-w-[400px]", "sm:max-w-[400px]", "gap-0", "p-0");
    expect(within(dialog).getByText("Four weeks: 7 Sep – 4 Oct 2026")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeVisible();
    expect(within(dialog).getByTestId("person-schedule-header")).toHaveClass("shrink-0");
    const list = within(dialog).getByRole("list");
    expect(list.parentElement).toHaveClass("min-h-0", "overflow-y-auto");
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(within(dialog).queryByText(/edit|delete|save|duplicate/i)).not.toBeInTheDocument();
  });

  it("renders a distinct empty state", () => {
    render(
      <PersonScheduleSheet
        open
        schedule={{ kind: "available", model: { ...scheduleModel, entries: [] } }}
        onOpenChange={() => {}}
        onRestoreFocus={() => {}}
      />,
    );

    expect(screen.getByTestId("person-schedule-empty")).toHaveTextContent("Nothing scheduled in these four weeks.");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});

describe("PersonScheduleSheet lifecycle", () => {
  it("closes with Escape", async () => {
    const user = userEvent.setup();
    render(<ControlledSheet />);

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("allows native backdrop dismissal", async () => {
    const user = userEvent.setup();
    render(<ControlledSheet />);

    const overlay = document.querySelector<HTMLElement>('[data-slot="sheet-overlay"]');
    expect(overlay).not.toBeNull();
    if (!overlay) throw new Error("Expected the Sheet overlay to render");
    await user.click(overlay);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("uses the supplied restoration callback after close auto-focus", async () => {
    const user = userEvent.setup();
    const onRestoreFocus = vi.fn();
    render(<ControlledSheet onRestoreFocus={onRestoreFocus} />);

    await user.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(onRestoreFocus).toHaveBeenCalledOnce());
  });

  it("synchronously removes safe content and requests closure when the schedule becomes unavailable", async () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <PersonScheduleSheet open schedule={availableSchedule} onOpenChange={onOpenChange} onRestoreFocus={() => {}} />,
    );
    expect(screen.getByText("Prototype discovery")).toBeVisible();

    rerender(
      <PersonScheduleSheet
        open
        schedule={{ kind: "unavailable" }}
        onOpenChange={onOpenChange}
        onRestoreFocus={() => {}}
      />,
    );

    expect(screen.queryByText("Diana Prince")).not.toBeInTheDocument();
    expect(screen.queryByText("Prototype discovery")).not.toBeInTheDocument();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
