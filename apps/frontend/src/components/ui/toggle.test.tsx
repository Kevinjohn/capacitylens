import { loadPlanningData } from "@/test/fixtures";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Toggle } from "@/components/ui/toggle";
import { useStore } from "@/store/useStore";
import { emptyAppData } from "@capacitylens/shared/types/entities";

beforeEach(() => {
  loadPlanningData(emptyAppData());
  useStore.getState().clearFilters();
  useStore.getState().setDirtyForm(false);
});

describe("Toggle", () => {
  it("shares the transient pressed feedback without replacing persistent selection", () => {
    render(
      <Toggle pressed aria-label="Work mode">
        Work
      </Toggle>,
    );

    const toggle = screen.getByRole("button", { name: "Work mode" });
    expect(toggle).toHaveClass(
      "enabled:active:scale-95",
      "data-[state=on]:bg-accent",
      "data-[state=on]:text-accent-foreground",
    );
    expect(toggle).toHaveAttribute("data-state", "on");
  });

  it("gates pressed feedback when disabled", () => {
    render(
      <Toggle disabled aria-label="Unavailable mode">
        Unavailable
      </Toggle>,
    );

    const toggle = screen.getByRole("button", { name: "Unavailable mode" });
    expect(toggle).toHaveClass(
      "enabled:active:scale-95",
      "disabled:pointer-events-none",
    );
    expect(toggle).not.toHaveClass("active:scale-95");
  });
});
