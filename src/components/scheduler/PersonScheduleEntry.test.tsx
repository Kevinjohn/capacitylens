import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { PersonScheduleAllocationEntry, PersonScheduleTimeOffEntry } from "./personScheduleTypes";
import { PersonScheduleEntry } from "./PersonScheduleEntry";

describe("PersonScheduleEntry", () => {
  it("leaves the year off a range that stays inside one", () => {
    // The compact entry is deliberately terse; only a range crossing a year boundary is allowed to
    // spend width on the year (#819), and this is the case that proves the rest still cannot.
    const entry: PersonScheduleAllocationEntry = {
      kind: "allocation",
      key: "allocation:a2",
      sourceId: "a2",
      activity: "Prototype discovery",
      project: "Project Gotham",
      client: "Wayne Enterprises",
      color: "#2563eb",
      status: "confirmed",
      hoursPerDay: 6.25,
      startDate: "2026-09-09",
      endDate: "2026-10-14",
    };

    render(
      <ul>
        <PersonScheduleEntry entry={entry} />
      </ul>,
    );

    const item = screen.getByTestId("person-schedule-entry");
    expect(within(item).getByText("9 Sep – 14 Oct · 6.25h/day")).toBeVisible();
    expect(within(item).queryByText(/2026/)).not.toBeInTheDocument();
  });

  it("renders compact allocation details as readable, read-only content", () => {
    const entry: PersonScheduleAllocationEntry = {
      kind: "allocation",
      key: "allocation:a1",
      sourceId: "a1",
      activity: "Prototype discovery",
      project: "Project Gotham",
      client: "Wayne Enterprises",
      color: "#2563eb",
      status: "confirmed",
      hoursPerDay: 6.25,
      startDate: "2026-12-28",
      endDate: "2027-01-08",
      seriesEnd: "2027-01-15",
      note: "Review the research\nThen prepare the workshop.",
    };

    render(
      <ul>
        <PersonScheduleEntry entry={entry} />
      </ul>,
    );

    const item = screen.getByTestId("person-schedule-entry");
    expect(item).toHaveAttribute("data-entry-id", "allocation:a1");
    expect(within(item).getByText("Prototype discovery")).toBeVisible();
    expect(within(item).getByText("Project Gotham · Wayne Enterprises")).toBeVisible();
    // The fixture crosses a year boundary, so both years show: "28 Dec – 8 Jan" would read as a
    // span of days rather than the eleven-day one it is (#819).
    expect(within(item).getByText("28 Dec 2026 – 8 Jan 2027 · 6.25h/day")).toBeVisible();
    expect(within(item).queryByText(/Confirmed|Series through/)).not.toBeInTheDocument();
    expect(within(item).getByText(/Review the research/)).toHaveClass("whitespace-pre-wrap");
    expect(within(item).getByTestId("person-schedule-colour")).toHaveAttribute("aria-hidden", "true");
    expect(item).not.toHaveClass("border-l-4");
    expect(within(item).queryByRole("button")).not.toBeInTheDocument();
    expect(within(item).queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders personal time off distinctly, including an already-authorized note", () => {
    const entry: PersonScheduleTimeOffEntry = {
      kind: "timeOff",
      key: "timeOff:t1",
      sourceId: "t1",
      type: "holiday",
      startDate: "2026-09-10",
      endDate: "2026-09-10",
      note: "Family day",
    };

    render(
      <ul>
        <PersonScheduleEntry entry={entry} />
      </ul>,
    );

    const item = screen.getByTestId("person-schedule-entry");
    expect(item).toHaveAttribute("data-entry-kind", "timeOff");
    expect(within(item).getByText("Holiday")).toBeVisible();
    expect(within(item).getByText("10 Sep")).toBeVisible();
    expect(within(item).queryByText(/2026/)).not.toBeInTheDocument();
    expect(within(item).getByText("Family day")).toHaveClass("whitespace-pre-wrap");
    expect(within(item).queryByTestId("person-schedule-timeoff-accent")).not.toBeInTheDocument();
    expect(item).not.toHaveClass("pl-6", "overflow-hidden");
    expect(within(item).queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("PersonScheduleEntry wrapping", () => {
  it("keeps long activity, attribution, and note content wrap-safe", () => {
    const entry: PersonScheduleAllocationEntry = {
      kind: "allocation",
      key: "allocation:long-content",
      sourceId: "long-content",
      activity: "A very long activity name that must wrap inside the drawer instead of widening it",
      project: "A very long project attribution that must wrap inside the drawer",
      client: "A very long client attribution that must wrap inside the drawer",
      color: "#2563eb",
      status: "tentative",
      hoursPerDay: 8,
      startDate: "2026-06-01",
      endDate: "2026-06-05",
      note: "A long note with a line break\nthat remains readable without horizontal overflow.",
      task: "Prototype review",
    };

    render(
      <ul>
        <PersonScheduleEntry entry={entry} />
      </ul>,
    );

    const item = screen.getByTestId("person-schedule-entry");
    expect(within(item).getByRole("heading")).toHaveClass("break-words");
    expect(within(item).getByText(/very long project attribution/)).toHaveClass("break-words");
    expect(within(item).getByText(/long note with a line break/)).toHaveClass("whitespace-pre-wrap", "break-words");
    expect(within(item).getByText("Prototype review")).toBeInTheDocument();
  });
});
