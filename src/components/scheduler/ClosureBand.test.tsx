import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { makeClosure } from "../../test/fixtures";
import { GEOM } from "./__tests__/schedulerTestKit";
import { ClosureBand } from "./ClosureBand";

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
    expect(band).toHaveTextContent("Long weekend");
    expect(band.style.left).toBe(`${256 + GEOM.xForDateInGeom("2026-06-05")}px`);
    expect(band.style.width).toBe(`${GEOM.widthForDates("2026-06-05", "2026-06-08")}px`);
    expect(screen.getAllByTestId("scheduler-closure-band")).toHaveLength(1);
  });
});
