import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { GettingStarted, GettingStartedShortcut } from "./GettingStarted";
import { resetStoreWithAccount } from "../test/fixtures";
import { useStore } from "../store/useStore";
import { PermissionContext } from "../auth/permissionContext";
import type { Role } from "@capacitylens/shared/domain/access";
import indexCss from "../index.css?raw";

const tourMock = vi.hoisted(() => ({ startTour: vi.fn<() => Promise<void>>() }));
vi.mock("../lib/tour", () => ({ startTour: tourMock.startTour }));

beforeEach(() => {
  tourMock.startTour.mockReset().mockResolvedValue(undefined);
  localStorage.clear();
  resetStoreWithAccount();
  useStore.getState().setGettingStartedDismissed(false);
});
afterEach(() => vi.restoreAllMocks());

function renderChecklist(role: Role | null, path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PermissionContext.Provider value={{ role, status: role ? "resolved" : "not-applicable" }}>
        {path === "/" ? <GettingStarted /> : <GettingStartedShortcut />}
      </PermissionContext.Provider>
    </MemoryRouter>,
  );
}

function progressKey(): string {
  return `capacitylens/gettingStartedProgress/${useStore.getState().activeAccountId}`;
}

describe("GettingStarted first-use outcomes", () => {
  it("starts with a concise choice and reveals the three outcomes after manual setup is chosen", async () => {
    const user = userEvent.setup();
    renderChecklist("owner");

    expect(screen.getByText("Add a person and some work, then schedule them together.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Import CapacityLens data" })).toHaveAttribute(
      "href",
      "/settings#getting-started-import",
    );
    expect(screen.queryByText("Add someone to the schedule")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Set up manually" }));

    expect(screen.getByRole("link", { name: "Add someone to the schedule" })).toHaveAttribute("href", "/resources");
    expect(screen.getByRole("link", { name: "Add work to schedule" })).toHaveAttribute("href", "/activities");
    expect(screen.getByText("Schedule the first piece of work")).toBeVisible();
    expect(screen.getByRole("link", { name: "Add a client" })).toHaveAttribute("href", "/clients");
    expect(screen.getByRole("link", { name: "Add a project" })).toHaveAttribute("href", "/projects");
  });

  it("explains schedule people, work hierarchy, scheduling, import, settings and sign-in access", async () => {
    const user = userEvent.setup();
    renderChecklist("owner");
    expect(
      screen.getByText("Restore a CapacityLens JSON export. Importing replaces this company’s planning data."),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Set up manually" }));
    expect(
      screen.getByText(
        "People on the schedule are the people whose capacity you plan. Adding someone here does not give them sign-in access.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Activities are the work you schedule. For client work, add the client and project first. Internal work only needs an activity.",
      ),
    ).toBeVisible();
    expect(screen.getByText("Click or drag across a person’s row, then choose an activity.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Adjust company settings" })).toHaveAttribute(
      "href",
      "/settings#getting-started-settings",
    );
    expect(
      screen.getByText("Inviting someone gives them access to CapacityLens; it does not add them to the schedule."),
    ).toBeVisible();
  });

  it("shows milestones immediately for partial active data, including supporting client data", () => {
    useStore.getState().addClient({ name: "Wayne Enterprises", color: "#2d75da" });
    renderChecklist("editor");
    expect(screen.getByRole("link", { name: "Add someone to the schedule" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Set up manually" })).not.toBeInTheDocument();
  });

  it("legacy choice and Settings markers reveal milestones but never add completion", () => {
    localStorage.setItem(
      progressKey(),
      JSON.stringify({ started: true, importChosen: true, scratchChosen: false, settingsReviewed: true }),
    );
    renderChecklist("editor", "/clients");
    expect(screen.getByRole("link", { name: "Getting started: 0 of 3 complete" })).toBeVisible();
  });

  it("tracks progress from zero through three and hides once all useful outcomes exist", () => {
    const view = renderChecklist("editor", "/clients");
    expect(screen.getByRole("link", { name: "Getting started: 0 of 3 complete" })).toBeVisible();
    view.unmount();

    const person = useStore.getState().addResource({
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
    const work = useStore.getState().addActivity({ name: "Planning", kind: "internal" });
    const two = renderChecklist("editor", "/clients");
    expect(screen.getByRole("link", { name: "Getting started: 2 of 3 complete" })).toBeVisible();
    two.unmount();

    useStore.getState().addAllocation({
      resourceId: person.id,
      activityId: work.id,
      startDate: "2026-06-03",
      endDate: "2026-06-03",
      hoursPerDay: 0,
      status: "tentative",
    });
    renderChecklist("editor", "/clients");
    expect(screen.queryByTestId("getting-started-shortcut")).not.toBeInTheDocument();
  });
});

describe("GettingStarted role gates", () => {
  it.each(["owner", null] as const)("offers import to %s", (role) => {
    renderChecklist(role);
    expect(screen.getByRole("link", { name: "Import CapacityLens data" })).toBeVisible();
  });

  it.each(["admin", "editor"] as const)("does not offer import to %s", (role) => {
    renderChecklist(role);
    expect(screen.queryByRole("link", { name: "Import CapacityLens data" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set up manually" })).toBeVisible();
  });

  it.each(["owner", "admin"] as const)("offers %s the optional sign-in invitation", async (role) => {
    const user = userEvent.setup();
    renderChecklist(role);
    await user.click(screen.getByRole("button", { name: "Set up manually" }));
    expect(screen.getByRole("link", { name: "Invite people to sign in" })).toHaveAttribute("href", "/team");
  });

  it("does not offer an Editor import or invitations", async () => {
    const user = userEvent.setup();
    renderChecklist("editor");
    await user.click(screen.getByRole("button", { name: "Set up manually" }));
    expect(screen.queryByRole("link", { name: "Import CapacityLens data" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Invite people to sign in" })).not.toBeInTheDocument();
  });

  it("renders no write-oriented card for a Viewer", () => {
    renderChecklist("viewer");
    expect(screen.queryByTestId("getting-started")).not.toBeInTheDocument();
  });
});

describe("GettingStarted supporting behavior", () => {
  it("clicking import opens its destination but does not record success", async () => {
    const user = userEvent.setup();
    renderChecklist("owner");
    await user.click(screen.getByRole("link", { name: "Import CapacityLens data" }));
    const saved = JSON.parse(localStorage.getItem(progressKey()) ?? "{}") as { importChosen?: boolean };
    expect(saved.importChosen).toBe(true);
    expect(screen.getByRole("link", { name: "Add someone to the schedule" })).toBeVisible();
    expect(screen.queryAllByText(/^Done:/)).toHaveLength(0);
  });

  it("keeps the bounded card pointer-interactive for narrow and short layouts", () => {
    expect(indexCss).toMatch(/\.getting-started-popover\s*\{[^}]*overflow-y:\s*auto;[^}]*pointer-events:\s*auto;/);
  });

  it("starts one tour at a time and surfaces failures", async () => {
    let finish!: () => void;
    tourMock.startTour.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const user = userEvent.setup();
    renderChecklist("editor");
    const action = screen.getByRole("button", { name: "Show me around" });
    await user.dblClick(action);
    expect(tourMock.startTour).toHaveBeenCalledOnce();
    expect(action).toBeDisabled();
    finish();
    await vi.waitFor(() => expect(action).toBeEnabled());
  });

  it("dismisses the card with the existing device-global preference", async () => {
    const user = userEvent.setup();
    renderChecklist("editor");
    await user.click(screen.getByTestId("getting-started-dismiss"));
    expect(useStore.getState().gettingStartedDismissed).toBe(true);
    expect(localStorage.getItem("capacitylens/gettingStartedDismissed")).toBe("on");
  });
});
