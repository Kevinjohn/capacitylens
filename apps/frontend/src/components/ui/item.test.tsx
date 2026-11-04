import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Item } from "@/components/ui/item";
import { useStore } from "@/store/useStore";
import { emptyAppData } from "@capacitylens/shared/types/entities";

beforeEach(() => {
  useStore.getState().replaceAll(emptyAppData());
  useStore.getState().clearFilters();
  useStore.getState().setDirtyForm(false);
});

describe("Item", () => {
  it("keeps fake-table rows compact without changing the default item density", () => {
    render(
      <>
        <Item>Default row</Item>
        <Item size="sm">Compact row</Item>
      </>,
    );

    expect(screen.getByText("Default row")).toHaveClass("p-4");
    expect(screen.getByText("Compact row")).toHaveClass("px-4", "py-1");
    expect(screen.getByText("Compact row")).not.toHaveClass("py-3");
  });
});
