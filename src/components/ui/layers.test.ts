import { describe, expect, it } from "vitest";
import alertDialogSource from "./alert-dialog.tsx?raw";
import dialogSource from "./dialog.tsx?raw";
import popoverSource from "./popover.tsx?raw";
import selectSource from "./select.tsx?raw";
import sheetSource from "./sheet.tsx?raw";
import tooltipSource from "./tooltip.tsx?raw";
import css from "../../index.css?raw";

const sources: Record<string, string> = {
  "alert-dialog": alertDialogSource,
  dialog: dialogSource,
  popover: popoverSource,
  select: selectSource,
  sheet: sheetSource,
  tooltip: tooltipSource,
};

describe("global UI layer tokens", () => {
  it.each([
    ["dialog", "modal"],
    ["alert-dialog", "modal"],
    ["sheet", "modal"],
    ["popover", "popover"],
    ["select", "popover"],
    ["tooltip", "tooltip"],
  ])("uses the %s primitive's approved %s tier", (component, tier) => {
    const componentSource = sources[component];
    expect(componentSource).toContain(`z-(--z-index-${tier})`);
    expect(componentSource).not.toMatch(/\bz-(?:\d+|\[[^\]]+\])/);
  });

  it("orders sticky, drag, modal, popover, tooltip and skip-link tiers", () => {
    const values = ["sticky", "drag", "modal", "popover", "tooltip", "skip-link"].map((tier) => {
      const match = css.match(new RegExp(`--z-index-${tier}:\\s*(\\d+)`));
      expect(match, `missing --z-index-${tier}`).not.toBeNull();
      return Number(match?.[1]);
    });

    expect(values).toEqual([...values].sort((left, right) => left - right));
    expect(new Set(values).size).toBe(values.length);
  });
});
