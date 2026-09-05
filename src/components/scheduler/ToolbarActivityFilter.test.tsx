import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { makeActivity } from "../../test/fixtures";
import { ToolbarActivityFilter } from "./ToolbarActivityFilter";

const admin = makeActivity({ id: "act-admin", name: "Admin", kind: "internal", projectId: undefined });
const design = makeActivity({ id: "act-design", name: "Design", kind: "repeatable", projectId: undefined });

function renderFilter(props: Partial<React.ComponentProps<typeof ToolbarActivityFilter>> = {}) {
  const onChange = vi.fn();
  render(
    <ToolbarActivityFilter
      internalActivities={[admin]}
      repeatableActivities={[design]}
      activityId={null}
      activityKind={null}
      onChange={onChange}
      {...props}
    />,
  );
  return onChange;
}

function openActivityFilter() {
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Filter by activity" }), { key: "ArrowDown" });
}

describe("ToolbarActivityFilter", () => {
  it('selects the "Internal — All" activity group', () => {
    const onChange = renderFilter();
    openActivityFilter();

    fireEvent.click(screen.getByRole("option", { name: "Internal — All" }));

    expect(onChange).toHaveBeenCalledWith({ activityKind: "internal", activityId: null });
  });

  it("selects a specific activity", () => {
    const onChange = renderFilter();
    openActivityFilter();

    fireEvent.click(screen.getByRole("option", { name: "Admin" }));

    expect(onChange).toHaveBeenCalledWith({ activityId: "act-admin", activityKind: null });
  });

  it('clears a specific activity by selecting "All activities"', () => {
    const onChange = renderFilter({ activityId: "act-admin" });
    openActivityFilter();

    fireEvent.click(screen.getByRole("option", { name: "All activities" }));

    expect(onChange).toHaveBeenCalledWith({ activityId: null, activityKind: null });
  });

  it('displays "All projects — All" for the repeatable activity group', () => {
    renderFilter({ activityKind: "repeatable" });

    expect(screen.getByRole("combobox", { name: "Filter by activity" })).toHaveTextContent("All projects — All");
  });
});
