import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SegmentedControl } from "./SegmentedControl";

// The rest of this control's behaviour is covered with the other shared controls in ui.test.tsx.
// Variant interaction lives here because it is about how two presentation options combine.
describe("SegmentedControl variants", () => {
  const options = [
    { value: "first", label: "First" },
    { value: "middle", label: "Middle" },
  ];

  it("drops the connected separators and keeps the lift on a recessed track", () => {
    render(
      <SegmentedControl
        value="first"
        onChange={vi.fn()}
        options={options}
        ariaLabel="Recessed positions"
        geometry="connected"
        variant="recessed"
      />,
    );

    // The separators are inset shadows on every item after the first, and they come with a reset
    // that would cancel the selected item's drop shadow.
    const middle = screen.getByRole("radio", { name: "Middle" });
    expect(middle.className).not.toContain("not-first:shadow-[inset_1px_0_0_var(--color-line)]");
    expect(middle.className).not.toContain("data-[state=on]:shadow-none");
    expect(screen.getByRole("radio", { name: "First" }).className).toContain(
      "data-[state=on]:shadow-[0_1px_2px_rgba(20,22,26,0.10)]",
    );
  });

  it("keeps the connected separators on the outline treatment", () => {
    render(
      <SegmentedControl
        value="first"
        onChange={vi.fn()}
        options={options}
        ariaLabel="Outline positions"
        geometry="connected"
      />,
    );

    expect(screen.getByRole("radio", { name: "Middle" }).className).toContain(
      "not-first:shadow-[inset_1px_0_0_var(--color-line)]",
    );
  });
});
