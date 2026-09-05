import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DateHeader } from "./DateHeader";
import { buildColumnGeometry } from "./columnGeometry";
import type { WeeksZoom } from "../../lib/schedulerConfig";

const DAYS = ["2026-06-01", "2026-06-02", "2026-06-06"];
const DEFAULT_PROPS = { weekStartsOn: 1 as 0 | 1, today: "2026-06-01" };

// Uniform geometry (minimise off): widths are all `dayWidth`, so weekend labels still read
// "Sat". The narrow-weekend / "S"-label behaviour is exercised separately (commit 2).
const renderHeader = (dayWidth: number, visibleWeeks: WeeksZoom = 2) =>
  render(
    <DateHeader
      days={DAYS}
      geom={buildColumnGeometry(DAYS, dayWidth, {
        minimiseWeekends: false,
        weekendWidth: 22,
      })}
      visibleWeeks={visibleWeeks}
      {...DEFAULT_PROPS}
    />,
  );

describe("DateHeader", () => {
  it("always shows the month tier", () => {
    renderHeader(48);
    expect(screen.getByText("Jun 2026")).toBeInTheDocument();
  });

  it("left-aligns wide-view labels in the visible month segment", () => {
    renderHeader(48);
    const label = screen.getByText("Jun 2026");
    const placement = label.parentElement;

    expect(placement).toHaveAttribute("data-month-placement", "visible-segment");
    expect(placement).toHaveClass("absolute", "items-center", "justify-start", "overflow-hidden");
    expect(label).toHaveClass("max-w-full", "truncate");
    expect(label).not.toHaveClass("sticky", "bg-surface");
  });

  it("keeps compact-view labels sticky and bounded", () => {
    renderHeader(35);
    const label = screen.getByText("Jun 2026");

    expect(label).toHaveAttribute("data-month-placement", "sticky-start");
    expect(label).toHaveClass("sticky", "max-w-full", "truncate", "bg-scheduler-header");
    expect(label).toHaveStyle({ left: "256px" });
  });

  it("keeps 4-week labels compact even when the columns are wide", () => {
    renderHeader(48, 4);
    expect(screen.getByText("Jun 2026")).toHaveAttribute("data-month-placement", "sticky-start");
  });

  it("switches horizontal placement modes at the weekday-label threshold", () => {
    const below = renderHeader(35);
    expect(screen.getByText("Jun 2026")).toHaveAttribute("data-month-placement", "sticky-start");
    below.unmount();

    renderHeader(36);
    expect(screen.getByText("Jun 2026").parentElement).toHaveAttribute("data-month-placement", "visible-segment");
  });

  describe("at a coarse zoom (dayWidth < 18)", () => {
    it("shows week-start labels instead of day numbers", () => {
      const { container } = renderHeader(17);
      expect(screen.getByText("1 Jun")).toBeInTheDocument();
      expect(screen.queryByText("2")).not.toBeInTheDocument();
      expect(container.querySelectorAll(".flex.flex-auto > div")).toHaveLength(1);
    });
  });

  it("switches from week blocks to day cells exactly at the day threshold", () => {
    const below = renderHeader(17);
    expect(screen.queryByText("2")).not.toBeInTheDocument();
    below.unmount();

    renderHeader(18);
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
  });

  it("switches weekday labels on exactly at the weekday threshold", () => {
    const below = renderHeader(35);
    expect(screen.queryByText("Mon")).not.toBeInTheDocument();
    below.unmount();

    renderHeader(36);
    expect(screen.getByText("Mon")).toBeInTheDocument();
    expect(screen.getByText("Tue")).toBeInTheDocument();
    expect(screen.getByText("Sat")).toBeInTheDocument();
  });

  it("groups a cross-month window into correctly sized month spans", () => {
    const days = ["2026-05-31", "2026-06-01", "2026-06-02"];
    const { container } = render(
      <DateHeader
        days={days}
        geom={buildColumnGeometry(days, 20, {
          minimiseWeekends: false,
          weekendWidth: 10,
        })}
        visibleWeeks={2}
        {...DEFAULT_PROPS}
      />,
    );

    expect(screen.getByText("May 2026").parentElement).toHaveStyle({
      width: "20px",
    });
    expect(screen.getByText("Jun 2026").parentElement).toHaveStyle({
      width: "40px",
    });
    expect(container.querySelectorAll(":scope > div:first-child > div")).toHaveLength(2);
  });

  it("marks today independently from ordinary and weekend cells", () => {
    renderHeader(48);
    const todayCell = screen.getByText("1").parentElement;
    const ordinaryCell = screen.getByText("2").parentElement;
    expect(todayCell).toHaveClass("bg-brand-soft", "font-semibold", "text-ink");
    expect(ordinaryCell).not.toHaveClass("bg-brand-soft");
  });

  describe("with dayWidth={48} (>= 36)", () => {
    it("shows day numbers 1, 2, and 6", () => {
      renderHeader(48);
      expect(screen.getByText("1")).toBeInTheDocument();
      expect(screen.getByText("2")).toBeInTheDocument();
      expect(screen.getByText("6")).toBeInTheDocument();
    });

    it("shows weekday abbreviations for each day", () => {
      renderHeader(48);
      // 2026-06-01 is a Monday → Mon
      expect(screen.getByText("Mon")).toBeInTheDocument();
      // 2026-06-02 is a Tuesday → Tue
      expect(screen.getByText("Tue")).toBeInTheDocument();
      // 2026-06-06 is a Saturday → Sat
      expect(screen.getByText("Sat")).toBeInTheDocument();
    });
  });

  describe("with dayWidth={20} (< 36)", () => {
    it("still shows day numbers 1, 2, and 6", () => {
      renderHeader(20);
      expect(screen.getByText("1")).toBeInTheDocument();
      expect(screen.getByText("2")).toBeInTheDocument();
      expect(screen.getByText("6")).toBeInTheDocument();
    });

    it("does NOT show weekday abbreviations", () => {
      renderHeader(20);
      expect(screen.queryByText("Mon")).not.toBeInTheDocument();
      expect(screen.queryByText("Tue")).not.toBeInTheDocument();
      expect(screen.queryByText("Sat")).not.toBeInTheDocument();
    });
  });

  describe("with minimise weekends ON (narrowed weekend columns)", () => {
    // Fri, Sat, Sun, Mon — a window straddling a full weekend.
    const WEEKEND_DAYS = ["2026-06-05", "2026-06-06", "2026-06-07", "2026-06-08"];
    const renderMinimised = (dayWidth: number) =>
      render(
        <DateHeader
          days={WEEKEND_DAYS}
          geom={buildColumnGeometry(WEEKEND_DAYS, dayWidth, {
            minimiseWeekends: true,
            weekendWidth: 22,
          })}
          visibleWeeks={2}
          weekStartsOn={1}
          today="2026-06-05"
        />,
      );

    it('shows "S" for BOTH Saturday and Sunday, and keeps the weekday letters either side', () => {
      renderMinimised(48);
      expect(screen.getByText("Fri")).toBeInTheDocument();
      expect(screen.getByText("Mon")).toBeInTheDocument();
      expect(screen.getAllByText("S")).toHaveLength(2); // Sat + Sun both collapse to "S"
      expect(screen.queryByText("Sat")).not.toBeInTheDocument();
      expect(screen.queryByText("Sun")).not.toBeInTheDocument();
    });

    it("still shows the date number in each narrowed weekend column", () => {
      renderMinimised(48);
      expect(screen.getByText("6")).toBeInTheDocument(); // Sat 06-06
      expect(screen.getByText("7")).toBeInTheDocument(); // Sun 06-07
    });

    it("renders weekend cells at the narrow width and weekdays at dayWidth", () => {
      const { container } = renderMinimised(48);
      const cells = container.querySelectorAll(".flex.flex-auto > div");
      // Fri(48), Sat(22), Sun(22), Mon(48) — widths come straight from the geometry.
      expect(Array.from(cells).map((c) => (c as HTMLElement).style.width)).toEqual(["48px", "22px", "22px", "48px"]);
    });
  });
});
