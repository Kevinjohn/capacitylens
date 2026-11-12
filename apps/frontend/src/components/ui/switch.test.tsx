import { loadPlanningData } from "@/test/fixtures";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Switch } from "@/components/ui/switch";
import { useStore } from "@/store/useStore";
import { emptyAppData } from "@capacitylens/shared/types/entities";

beforeEach(() => {
  loadPlanningData(emptyAppData());
  useStore.getState().clearFilters();
  useStore.getState().setDirtyForm(false);
});

describe("Switch", () => {
  it("uses the semantic non-text-contrast tokens instead of theme-specific overrides", () => {
    render(<Switch aria-label="Availability" />);

    const control = screen.getByRole("switch", { name: "Availability" });
    expect(control).toHaveClass("data-[state=unchecked]:bg-switch-track");
    expect(control).not.toHaveClass("data-[state=unchecked]:bg-input");
    expect(control.firstElementChild).toHaveClass("bg-switch-thumb");
  });

  it("preserves the deliberate default and small track/thumb geometry", () => {
    render(
      <>
        <Switch aria-label="Default size" />
        <Switch aria-label="Small size" size="sm" />
      </>,
    );

    const defaultSwitch = screen.getByRole("switch", { name: "Default size" });
    expect(defaultSwitch).toHaveClass(
      "data-[size=default]:h-6",
      "data-[size=default]:w-10",
      "data-[size=default]:p-0.5",
    );
    expect(defaultSwitch.firstElementChild).toHaveClass(
      "group-data-[size=default]/switch:size-5",
      "group-data-[size=default]/switch:data-[state=checked]:translate-x-4",
    );

    const smallSwitch = screen.getByRole("switch", { name: "Small size" });
    expect(smallSwitch).toHaveAttribute("data-size", "sm");
    expect(smallSwitch).toHaveClass(
      "data-[size=sm]:h-4",
      "data-[size=sm]:w-7",
      "data-[size=sm]:p-px",
    );
    expect(smallSwitch.firstElementChild).toHaveClass(
      "group-data-[size=sm]/switch:size-3",
      "group-data-[size=sm]/switch:data-[state=checked]:translate-x-3",
    );
  });
});
