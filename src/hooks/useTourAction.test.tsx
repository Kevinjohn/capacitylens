import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, useEffect } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionContext } from "@/auth/permissionContext";
import type { Role } from "@capacitylens/shared/domain/access";
import { useTourAction } from "./useTourAction";

const tourMock = vi.hoisted(() => ({
  startTour:
    vi.fn<
      (options: {
        role: "owner" | "admin" | "editor" | "viewer" | null;
        navigate: (path: string) => void;
        serverMode: boolean;
      }) => Promise<void>
    >(),
}));
const apiMode = vi.hoisted(() => ({ demo: false }));
const offlineMode = vi.hoisted(() => ({ readOnly: false }));
vi.mock("@/lib/tour", () => ({ startTour: tourMock.startTour }));
vi.mock("@/data/apiConfig", () => ({ isDemoMode: () => apiMode.demo }));
vi.mock("@/data/useOfflineState", () => ({ useOfflineState: () => offlineMode }));

const setNotice = vi.fn();
const actionRef = createRef<() => Promise<void>>();

function Harness() {
  const { canShowTour, tourBusy, showTour } = useTourAction(setNotice);
  useEffect(() => {
    actionRef.current = showTour;
  }, [showTour]);
  return (
    <button disabled={!canShowTour || tourBusy} aria-busy={tourBusy || undefined} onClick={() => void showTour()}>
      Tour
    </button>
  );
}

function renderHarness({
  role,
  status,
  path = "/",
}: {
  role: Role | null;
  status: "not-applicable" | "pending" | "resolved" | "unavailable";
  path?: string;
}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PermissionContext.Provider value={{ role, status }}>
        <Harness />
      </PermissionContext.Provider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  tourMock.startTour.mockReset().mockResolvedValue(undefined);
  apiMode.demo = false;
  offlineMode.readOnly = false;
  setNotice.mockReset();
  actionRef.current = undefined;
});
afterEach(() => vi.restoreAllMocks());

describe("useTourAction", () => {
  it.each(["pending", "unavailable"] as const)("disables the launcher while permissions are %s", (status) => {
    renderHarness({ role: "viewer", status });
    expect(screen.getByRole("button", { name: "Tour" })).toBeDisabled();
    expect(tourMock.startTour).not.toHaveBeenCalled();
  });

  it("disables the launcher for a read-only offline snapshot", () => {
    offlineMode.readOnly = true;
    renderHarness({ role: "owner", status: "resolved" });
    expect(screen.getByRole("button", { name: "Tour" })).toBeDisabled();
  });

  it.each([
    { role: "viewer" as const, status: "resolved" as const },
    { role: null, status: "not-applicable" as const },
  ])("passes the resolved role and navigation callback to the tour", async ({ role, status }) => {
    renderHarness({ role, status, path: "/settings" });
    await act(async () => actionRef.current?.());
    const options = tourMock.startTour.mock.calls[0]?.[0];
    expect(options).toMatchObject({ role, serverMode: true });
    expect(typeof options?.navigate).toBe("function");
  });

  it("keeps duplicate calls from starting another tour while the first one is active", async () => {
    let finishTour!: () => void;
    tourMock.startTour.mockReturnValueOnce(new Promise<void>((resolve) => (finishTour = resolve)));
    const user = userEvent.setup();
    renderHarness({ role: "editor", status: "resolved" });
    const button = screen.getByRole("button", { name: "Tour" });
    await user.click(button);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    await act(async () => {
      const showTour = actionRef.current;
      if (!showTour) throw new Error("tour action was not registered");
      await showTour();
      expect(tourMock.startTour).toHaveBeenCalledOnce();
      finishTour();
    });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("aria-busy");
  });

  it("surfaces the existing tour failure notice", async () => {
    tourMock.startTour.mockRejectedValueOnce(new Error("driver failed"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderHarness({ role: "admin", status: "resolved" });
    await act(async () => actionRef.current?.());
    expect(setNotice).toHaveBeenCalledWith("The tour could not start. Check your connection and try again.", "error");
  });
});
