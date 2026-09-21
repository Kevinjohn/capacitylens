import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { GettingStarted } from "./GettingStarted";
import { resetStoreWithAccount } from "../test/fixtures";
import { useStore } from "../store/useStore";
import { PermissionContext } from "../auth/permissionContext";
import type { Role } from "@capacitylens/shared/domain/access";
import indexCss from "../index.css?raw";

const tourMock = vi.hoisted(() => ({ startTour: vi.fn<() => Promise<void>>() }));
const apiMode = vi.hoisted(() => ({ demo: true }));
vi.mock("../lib/tour", () => ({ startTour: tourMock.startTour }));
vi.mock("../data/apiConfig", () => ({ API_BASE: "", isDemoMode: () => apiMode.demo }));

beforeEach(() => {
  resetStoreWithAccount();
  apiMode.demo = true;
  tourMock.startTour.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderChecklist(role: Role | null, path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PermissionContext.Provider value={{ role, status: role ? "resolved" : "not-applicable" }}>
        <GettingStarted />
      </PermissionContext.Provider>
    </MemoryRouter>,
  );
}

describe("Getting started", () => {
  it("shows all five milestones immediately and a zero progress bar", async () => {
    renderChecklist("owner");
    expect(await screen.findByTestId("getting-started")).toBeVisible();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByRole("link", { name: "Add someone to the schedule" })).toHaveAttribute("href", "/resources");
    expect(screen.getByRole("link", { name: "Add a client" })).toHaveAttribute("href", "/clients");
    expect(screen.getByRole("link", { name: "Add a project to the client" })).toHaveAttribute("href", "/projects");
    expect(screen.getByRole("link", { name: "Add an Activity" })).toHaveAttribute("href", "/activities");
    expect(screen.getByRole("link", { name: "Schedule the first piece of work" })).toHaveAttribute("href", "/");
    expect(screen.queryByText("Set up manually")).not.toBeInTheDocument();
  });

  it("opens from another page and lets an editor hide the card", async () => {
    const user = userEvent.setup();
    renderChecklist("editor", "/settings");
    expect(await screen.findByTestId("getting-started-progress")).toBeVisible();
    expect(screen.queryByTestId("getting-started")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show checklist" }));
    expect(screen.getByTestId("getting-started")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Hide checklist", expanded: true }));
    expect(screen.queryByTestId("getting-started")).not.toBeInTheDocument();
    expect(screen.queryByTestId("getting-started-dismiss")).not.toBeInTheDocument();
  });

  it("requires confirmation before an owner dismisses incomplete setup", async () => {
    const user = userEvent.setup();
    renderChecklist("owner");
    await screen.findByTestId("getting-started-progress");
    await user.click(screen.getByTestId("getting-started-dismiss"));
    expect(screen.getByText("Do you really want to hide this forever?")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "No" }));
    expect(screen.getByTestId("getting-started-progress")).toBeVisible();
    await user.click(screen.getByTestId("getting-started-dismiss"));
    await user.click(screen.getByRole("button", { name: "Yes" }));
    expect(screen.queryByTestId("getting-started-progress")).not.toBeInTheDocument();
  });

  it("keeps the completed bar until dismissal and skips the warning at 5/5", async () => {
    resetStoreWithAccount("acct-complete-checklist");
    const store = useStore.getState();
    const person = store.addResource({
      kind: "person",
      name: "Bruce Wayne",
      role: "Designer",
      employmentType: "permanent",
      engagement: "studio",
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      color: "#2d75da",
    });
    const client = store.addClient({ name: "Wayne Enterprises", color: "#2d75da" });
    store.addProject({ name: "Wayne redesign", clientId: client.id, color: "#2d75da" });
    const activity = store.addActivity({ name: "Planning", kind: "internal" });
    store.addAllocation({
      resourceId: person.id,
      activityId: activity.id,
      startDate: "2026-06-03",
      endDate: "2026-06-03",
      hoursPerDay: 0,
      status: "tentative",
    });
    const user = userEvent.setup();
    renderChecklist("owner");
    expect(await screen.findByRole("progressbar", { name: "Getting started" })).toHaveAttribute("aria-valuenow", "5");
    expect(screen.queryByTestId("getting-started")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("getting-started-dismiss"));
    expect(screen.queryByText("Do you really want to hide this forever?")).not.toBeInTheDocument();
    expect(screen.queryByTestId("getting-started-progress")).not.toBeInTheDocument();
  });

  it("excludes viewers", () => {
    renderChecklist("viewer");
    expect(screen.queryByTestId("getting-started-progress")).not.toBeInTheDocument();
  });

  it("ignores the legacy device flag and keeps guidance after a failed server save", async () => {
    apiMode.demo = false;
    localStorage.setItem("capacitylens/gettingStartedDismissed", "on");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ dismissed: false }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    renderChecklist("owner");
    expect(await screen.findByTestId("getting-started-progress")).toBeVisible();
    await user.click(screen.getByTestId("getting-started-dismiss"));
    await user.click(screen.getByRole("button", { name: "Yes" }));
    expect(await screen.findByTestId("getting-started-progress")).toBeVisible();
    expect(useStore.getState().notice?.tone).toBe("error");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/accounts\/[^/]+\/getting-started$/),
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ dismissed: true }) }),
    );
    expect(console.error).toHaveBeenCalledWith("GettingStarted: dismissal could not be saved");
  });

  it("shows guidance after a read failure and retries without logging error details", async () => {
    apiMode.demo = false;
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("sensitive server detail"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ dismissed: false }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderChecklist("owner");
    expect(await screen.findByTestId("getting-started-progress")).toBeVisible();
    expect(screen.getByTestId("getting-started")).toBeVisible();
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
    expect(errorLog).toHaveBeenCalledWith("GettingStarted: company state could not be loaded");
    expect(errorLog.mock.calls.flat().join(" ")).not.toContain("sensitive server detail");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await vi.waitFor(() => expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not restore the bar when an earlier navigation read finishes after dismissal", async () => {
    apiMode.demo = false;
    let finishRead!: (response: Response) => void;
    const pendingRead = new Promise<Response>((resolve) => {
      finishRead = resolve;
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ dismissed: false }), { status: 200 }))
      .mockReturnValueOnce(pendingRead)
      .mockResolvedValueOnce(new Response(JSON.stringify({ dismissed: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderChecklist("owner");
    await screen.findByTestId("getting-started-progress");
    await user.click(screen.getByRole("link", { name: "Add a client" }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await user.click(screen.getByTestId("getting-started-dismiss"));
    await user.click(screen.getByRole("button", { name: "Yes" }));
    await vi.waitFor(() => expect(screen.queryByTestId("getting-started-progress")).not.toBeInTheDocument());
    await act(async () => finishRead(new Response(JSON.stringify({ dismissed: false }), { status: 200 })));
    expect(screen.queryByTestId("getting-started-progress")).not.toBeInTheDocument();
  });

  it("keeps the card bounded and pointer interactive", () => {
    expect(indexCss).toMatch(/\.getting-started-popover\s*\{[^}]*overflow-y:\s*auto;[^}]*pointer-events:\s*auto;/);
  });
});
