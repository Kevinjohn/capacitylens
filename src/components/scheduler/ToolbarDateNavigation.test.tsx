import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ToolbarDateNavigation } from "./ToolbarDateNavigation";

const props = () => ({
  zoom: 4 as const,
  onZoomChange: vi.fn(),
  onPanDays: vi.fn(),
  onToday: vi.fn(),
});

describe("ToolbarDateNavigation", () => {
  it("pans to the previous week", () => {
    const navigationProps = props();
    render(<ToolbarDateNavigation {...navigationProps} />);

    fireEvent.click(screen.getByRole("button", { name: "Prev" }));

    expect(navigationProps.onPanDays).toHaveBeenCalledWith(-7);
  });

  it("pans to the next week", () => {
    const navigationProps = props();
    render(<ToolbarDateNavigation {...navigationProps} />);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(navigationProps.onPanDays).toHaveBeenCalledWith(7);
  });

  it("returns to today", () => {
    const navigationProps = props();
    render(<ToolbarDateNavigation {...navigationProps} />);

    fireEvent.click(screen.getByRole("button", { name: "Today" }));

    expect(navigationProps.onToday).toHaveBeenCalledOnce();
  });

  it("names the weeks-visible control with its current value", () => {
    render(<ToolbarDateNavigation {...props()} />);

    expect(screen.getByRole("combobox", { name: "Weeks visible, 4 weeks" })).toBeInTheDocument();
  });

  it("changes the visible week count", () => {
    const navigationProps = props();
    render(<ToolbarDateNavigation {...navigationProps} />);
    const combobox = screen.getByRole("combobox", { name: "Weeks visible, 4 weeks" });

    fireEvent.keyDown(combobox, { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: "8 weeks" }));

    expect(navigationProps.onZoomChange).toHaveBeenCalledWith(8);
  });

  it("keeps the jump-to-date picker hidden", () => {
    render(<ToolbarDateNavigation {...props()} />);

    expect(screen.queryByLabelText("Jump to date")).toBeNull();
  });
});
