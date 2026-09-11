import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { makeClosure } from "../../test/fixtures";
import { GEOM } from "./__tests__/schedulerTestKit";
import { ClosureBand } from "./ClosureBand";
import { buildColumnGeometry } from "./columnGeometry";
import { eachDayISO } from "@capacitylens/shared/lib/dateMath";
import { buildVisibleSpanInsets } from "./visibleSpanInsets";

describe("ClosureBand", () => {
  it("renders a weekend-spanning closure as one literal inclusive band", () => {
    render(
      <ClosureBand
        closure={makeClosure({
          name: "Long weekend",
          startDate: "2026-06-05",
          endDate: "2026-06-08",
        })}
        visibleStart="2026-06-01"
        visibleEnd="2026-06-30"
        geom={GEOM}
        leftOffset={256}
        height={180}
      />,
    );

    const band = screen.getByTestId("scheduler-closure-band");
    expect(screen.getByTestId("scheduler-closure-label-layer")).toHaveTextContent("Long weekend");
    expect(band.style.left).toBe(`${256 + GEOM.xForDateInGeom("2026-06-05")}px`);
    expect(band.style.width).toBe(`${GEOM.widthForDates("2026-06-05", "2026-06-08")}px`);
    expect(screen.getAllByTestId("scheduler-closure-band")).toHaveLength(1);
    // Styling hook for the time-off draw-mode highlight (see src/index.css
    // `[data-draw-mode="timeoff"] .scheduler-closure-band`, #787). The band itself is mode-agnostic;
    // the ancestor grid publishes `data-draw-mode`, so this class is the only thing a later,
    // closure-specific style needs to key off.
    expect(band).toHaveClass("scheduler-closure-band");
  });

  // #788: with many people the band is taller than the screen and with a long closure it is wider,
  // so a label pinned to the band's own top-left disappears as soon as the schedule is scrolled.
  it("keeps the closure name centred in whatever part of the band is on screen", () => {
    const width = GEOM.widthForDates("2026-06-05", "2026-06-08");
    render(
      <ClosureBand
        closure={makeClosure({ name: "Long weekend", startDate: "2026-06-05", endDate: "2026-06-08" })}
        visibleStart="2026-06-01"
        visibleEnd="2026-06-30"
        geom={GEOM}
        leftOffset={256}
        height={180}
      />,
    );

    // The clamp is expressed in timeline coordinates, so the published start omits the frozen
    // resource column that the band's own `left` includes.
    const band = screen.getByTestId("scheduler-closure-band");
    expect(band.style.getPropertyValue("--band-left")).toBe(`${GEOM.xForDateInGeom("2026-06-05")}px`);
    expect(band.style.getPropertyValue("--band-width")).toBe(`${width}px`);
    expect(band.style.getPropertyValue("--band-height")).toBe("180px");

    // The name rides on a sibling layer, not inside the band: `z-0` on the band is a stacking
    // context, so a nested name would be buried by the group headers the band sits under (#766).
    const labelLayer = screen.getByTestId("scheduler-closure-label-layer");
    expect(band.contains(labelLayer)).toBe(false);
    expect(labelLayer.parentElement).toBe(band.parentElement);
    expect(labelLayer.getAttribute("style")).toContain("z-index: var(--z-index-scheduler-closure-label)");
    // Both layers are placed from one geometry, so the name cannot drift from its shading.
    expect(labelLayer.style.left).toBe(band.style.left);
    expect(labelLayer.style.width).toBe(band.style.width);
    expect(labelLayer.style.height).toBe(band.style.height);
    // Readable on the hatch: the standard foreground, not the muted grey it used to carry.
    expect(labelLayer).toHaveClass("text-foreground");
    expect(labelLayer).not.toHaveClass("text-muted-foreground");
    // Styling hook for #787's time-off ink, which no longer reaches the name by inheritance.
    expect(labelLayer).toHaveClass("scheduler-closure-label-layer");

    const horizontal = buildVisibleSpanInsets("x", "var(--band-left)", "var(--band-width)");
    const vertical = buildVisibleSpanInsets("y", "0px", "var(--band-height)");
    const labelBox = screen.getByTestId("scheduler-closure-label-box");
    expect(labelBox.style.left).toBe(horizontal.leading);
    expect(labelBox.style.right).toBe(horizontal.trailing);
    expect(labelBox.style.top).toBe(vertical.leading);
    expect(labelBox.style.bottom).toBe(vertical.trailing);
    expect(labelBox).toHaveClass("items-center", "justify-center");
  });

  it("keeps the vertical label on a band too narrow to read across", () => {
    // A single day zoomed out below the 44px threshold — the case the sideways label exists for.
    const narrow = buildColumnGeometry(eachDayISO("2026-06-01", "2026-06-30"), 20, {
      minimiseWeekends: false,
      weekendWidth: 12,
    });
    render(
      <ClosureBand
        closure={makeClosure({ name: "Founders Day", startDate: "2026-06-05", endDate: "2026-06-05" })}
        visibleStart="2026-06-01"
        visibleEnd="2026-06-30"
        geom={narrow}
        leftOffset={256}
        height={180}
      />,
    );

    expect(screen.getByTestId("scheduler-closure-label")).toHaveClass("[writing-mode:vertical-rl]");
  });
});
