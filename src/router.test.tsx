import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Outlet, Route, RouterProvider, Routes } from "react-router-dom";
import { ActivityList } from "./components/activities/ActivityList";
import { CapacityOverviewRoute, RouteLoading, router } from "./router";
import { PermissionContext } from "./auth/permissionContext";
import { resetStoreWithAccount } from "./test/fixtures";
import { useStore } from "./store/useStore";
import { STATIC_SPA_ROUTES } from "../scripts/static-spa-routes.mjs";

vi.mock("./components/AppShell", () => ({ AppShell: Outlet }));
vi.mock("./components/activities/ActivityList", () => ({
  ActivityList: vi.fn(() => <div data-testid="activity-list-route" />),
}));
vi.mock("./components/capacity-overview/CapacityOverviewView", () => ({
  CapacityOverviewView: () => <div>Overview content</div>,
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

describe("Overview route access", () => {
  function renderRoute(role: "owner" | "admin" | "editor" | "viewer", status: "pending" | "resolved" | "unavailable") {
    return render(
      <PermissionContext.Provider value={{ role, status }}>
        <MemoryRouter initialEntries={["/overview"]}>
          <Routes>
            <Route path="/" element={<div>Schedule content</div>} />
            <Route path="/overview" element={<CapacityOverviewRoute />} />
          </Routes>
        </MemoryRouter>
      </PermissionContext.Provider>,
    );
  }

  it("allows a viewer when the company setting allows everyone", async () => {
    resetStoreWithAccount();
    const accountId = useStore.getState().activeAccountId;
    if (!accountId) throw new Error("Expected an active account");
    useStore.getState().updateAccount(accountId, { capacityOverviewAccess: "everyone" });
    renderRoute("viewer", "resolved");

    expect(await screen.findByText("Overview content")).toBeInTheDocument();
  });

  it("redirects a viewer under the default policy", () => {
    resetStoreWithAccount();
    renderRoute("viewer", "resolved");

    expect(screen.getByText("Schedule content")).toBeInTheDocument();
  });

  it("waits for role resolution before deciding", () => {
    resetStoreWithAccount();
    renderRoute("viewer", "pending");

    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
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

describe("static SPA route manifest", () => {
  it("includes every fixed AppShell child route", () => {
    const appShellRoute = router.routes.find((route) => route.children);
    const fixedChildRoutes = (appShellRoute?.children ?? [])
      .filter((route) => !route.index && route.path && !route.path.includes(":"))
      .map((route) => route.path as string)
      .sort();

    expect(fixedChildRoutes).toEqual([...STATIC_SPA_ROUTES].sort());
  });
});
