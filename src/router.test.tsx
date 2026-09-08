import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { Outlet, RouterProvider } from "react-router-dom";
import { ActivityList } from "./components/activities/ActivityList";
import { RouteLoading, router } from "./router";

vi.mock("./components/AppShell", () => ({ AppShell: Outlet }));
vi.mock("./components/activities/ActivityList", () => ({
  ActivityList: vi.fn(() => <div data-testid="activity-list-route" />),
}));

describe("router loading boundary", () => {
  it("keeps top-level lazy routes inside a visible main landmark", () => {
    render(<RouteLoading />);

    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
  });
});

describe("activity route selection", () => {
  it.each(["/activities", "/activities#activity=%E0%A4%A"])("omits selectedActivityId for %s", async (path) => {
    await act(async () => {
      await router.navigate(path);
    });

    render(<RouterProvider router={router} />);
    await screen.findByTestId("activity-list-route");

    const props = vi.mocked(ActivityList).mock.lastCall?.[0];
    expect(props).toBeDefined();
    expect(Object.hasOwn(props ?? {}, "selectedActivityId")).toBe(false);
  });

  it("passes the decoded activity selection for a valid hash", async () => {
    await act(async () => {
      await router.navigate("/activities#activity=planning%2Freview");
    });

    render(<RouterProvider router={router} />);
    await screen.findByTestId("activity-list-route");

    expect(vi.mocked(ActivityList).mock.lastCall?.[0]).toEqual({ selectedActivityId: "planning/review" });
  });
});

describe("router not-found recovery", () => {
  it("renders the branded recovery screen for an unmatched URL", async () => {
    document.title = "CapacityLens";
    await act(async () => {
      await router.navigate("/stale-bookmark-that-does-not-exist");
    });

    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByText("That page does not exist or may have moved.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to schedule" })).toHaveAttribute("href", "/");
    expect(document.title).toBe("Page not found · CapacityLens");
  });
});
