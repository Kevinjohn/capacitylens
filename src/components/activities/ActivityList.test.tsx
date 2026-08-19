import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActivityList } from "./ActivityList";
import { useStore } from "../../store/useStore";
import { DEFAULT_ACCOUNT_ID, makeAppData, resetStoreWithAccount } from "../../test/fixtures";

beforeEach(() => resetStoreWithAccount());

describe("ActivityList", () => {
  it("orders activity kinds from internal through project-specific while keeping the project default", async () => {
    const user = userEvent.setup();
    render(<ActivityList />);

    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([
      "Internal activities",
      "All-projects activities",
      "Project-specific activities",
    ]);

    await user.click(screen.getByRole("button", { name: "Add activity" }));
    const dialog = screen.getByRole("dialog", { name: "Add activity" });

    expect(
      within(dialog)
        .getAllByRole("radio")
        .map((radio) => radio.textContent),
    ).toEqual(["Internal", "All projects", "Project-specific"]);
    expect(within(dialog).getByRole("radio", { name: "Project-specific" })).toBeChecked();
    expect(within(dialog).getByLabelText("Project")).toBeInTheDocument();
  });

  it("focuses the activity selected by a command-palette deep link", () => {
    const client = useStore.getState().addClient({ name: "Acme", color: "#111" });
    const project = useStore.getState().addProject({ name: "Lightning", clientId: client.id, color: "#222" });
    const selected = useStore.getState().addActivity({
      name: "Selected kickoff",
      kind: "project",
      projectId: project.id,
    });
    useStore.getState().addActivity({ name: "Other work", kind: "project", projectId: project.id });

    render(<ActivityList selectedActivityId={selected.id} />);

    const row = screen.getByText("Selected kickoff").closest('[data-testid="activity-row"]');
    expect(row).toHaveAttribute("aria-current", "location");
    expect(row).toHaveFocus();
    expect(screen.getByText("Other work").closest('[data-testid="activity-row"]')).not.toHaveAttribute("aria-current");
  });

  it("saves an internal activity under the Internal activities section", async () => {
    const user = userEvent.setup();
    render(<ActivityList />);

    await user.click(screen.getByRole("button", { name: "Add activity" }));
    const dialog = screen.getByRole("dialog", { name: "Add activity" });

    await user.type(within(dialog).getByLabelText("Name"), "Internal sync");
    // Pick the Internal kind — the project picker disappears (project-less).
    await user.click(within(dialog).getByRole("radio", { name: "Internal" }));
    expect(within(dialog).queryByLabelText("Project")).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(useStore.getState().data.activities).toHaveLength(1);
    expect(useStore.getState().data.activities[0].kind).toBe("internal");
    expect(useStore.getState().data.activities[0].projectId).toBeUndefined();

    expect(screen.getByRole("heading", { name: "Internal activities" })).toBeInTheDocument();
    const row = within(screen.getByTestId("internal-activities")).getByTestId("activity-row");
    expect(row).toHaveTextContent("Internal sync");
  });

  it("saves an all-projects activity under the All-projects activities section", async () => {
    const user = userEvent.setup();
    render(<ActivityList />);

    await user.click(screen.getByRole("button", { name: "Add activity" }));
    const dialog = screen.getByRole("dialog", { name: "Add activity" });

    await user.type(within(dialog).getByLabelText("Name"), "Design");
    await user.click(within(dialog).getByRole("radio", { name: "All projects" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(useStore.getState().data.activities[0].kind).toBe("repeatable");
    expect(screen.getByRole("heading", { name: "All-projects activities" })).toBeInTheDocument();
    const row = within(screen.getByTestId("cross-project-activities")).getByTestId("activity-row");
    expect(row).toHaveTextContent("Design");
  });

  it("does not show global first-activity onboarding when only a later section has rows", () => {
    useStore.getState().addActivity({ name: "Design system", kind: "repeatable" });

    render(<ActivityList />);

    expect(screen.getByText("Design system")).toBeInTheDocument();
    expect(screen.getByText("No internal activities yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add your first activity" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Activities are the work you allocate/)).not.toBeInTheDocument();
  });

  it("gives repeated row action controls distinct contextual names", () => {
    useStore.getState().addActivity({ name: "Planning", kind: "internal" });
    useStore.getState().addActivity({ name: "Operations", kind: "internal" });

    render(<ActivityList />);

    expect(screen.getByRole("button", { name: "Edit Planning" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Operations" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Planning" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Operations" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("adds a project-specific activity under one client and project heading", async () => {
    const user = userEvent.setup();
    const client = useStore.getState().addClient({ name: "Acme", color: "#111" });
    const project = useStore.getState().addProject({ name: "Lightning", clientId: client.id, color: "#222" });
    render(<ActivityList />);

    await user.click(screen.getByRole("button", { name: "Add activity" }));
    const dialog = screen.getByRole("dialog", { name: "Add activity" });

    // 'Project-specific' is the default kind, so the project picker is shown.
    await user.type(within(dialog).getByLabelText("Name"), "My Activity");
    fireEvent.keyDown(within(dialog).getByLabelText("Project"), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: "Acme / Lightning" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(useStore.getState().data.activities[0].kind).toBe("project");
    expect(useStore.getState().data.activities[0].projectId).toBe(project.id);

    const row = within(screen.getByTestId("project-specific-activities")).getByTestId("activity-row");
    expect(row).toHaveTextContent("My Activity");
    expect(row).not.toHaveTextContent("Acme");
    expect(row).not.toHaveTextContent("Lightning");
    expect(screen.getByRole("heading", { name: "Acme", level: 3 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Lightning", level: 4 })).toBeInTheDocument();
  });

  it("groups and sorts project activities by client, project, then activity", () => {
    const zuluClient = useStore.getState().addClient({ name: "Zulu Client", color: "#111" });
    const alphaClient = useStore.getState().addClient({ name: "Alpha Client", color: "#222" });
    const zuluProject = useStore
      .getState()
      .addProject({ name: "Zulu Project", clientId: alphaClient.id, color: "#333" });
    const alphaProject = useStore
      .getState()
      .addProject({ name: "Alpha Project", clientId: alphaClient.id, color: "#444" });
    const otherProject = useStore
      .getState()
      .addProject({ name: "Other Project", clientId: zuluClient.id, color: "#555" });
    useStore.getState().addActivity({ name: "Zulu task", kind: "project", projectId: alphaProject.id });
    useStore.getState().addActivity({ name: "Alpha task", kind: "project", projectId: alphaProject.id });
    useStore.getState().addActivity({ name: "Other project task", kind: "project", projectId: zuluProject.id });
    useStore.getState().addActivity({ name: "Other client task", kind: "project", projectId: otherProject.id });

    render(<ActivityList />);

    const section = within(screen.getByTestId("project-specific-activities"));
    expect(section.getAllByRole("heading", { level: 3 }).map(({ textContent }) => textContent)).toEqual([
      "Alpha Client",
      "Zulu Client",
    ]);
    expect(section.getAllByRole("heading", { level: 4 }).map(({ textContent }) => textContent)).toEqual([
      "Alpha Project",
      "Zulu Project",
      "Other Project",
    ]);
    expect(section.getAllByTestId("activity-row").map(({ textContent }) => textContent)).toEqual([
      "Alpha task",
      "Zulu task",
      "Other project task",
      "Other client task",
    ]);
    expect(section.getAllByText("Alpha Client", { exact: true })).toHaveLength(1);
    expect(section.getAllByText("Alpha Project", { exact: true })).toHaveLength(1);
  });

  it("rejects a project-specific activity with no project chosen", async () => {
    const user = userEvent.setup();
    const client = useStore.getState().addClient({ name: "Acme", color: "#111" });
    useStore.getState().addProject({ name: "Lightning", clientId: client.id, color: "#222" });
    render(<ActivityList />);

    await user.click(screen.getByRole("button", { name: "Add activity" }));
    const dialog = screen.getByRole("dialog", { name: "Add activity" });

    // Default kind is Project-specific; leave the project unselected and Save.
    await user.type(within(dialog).getByLabelText("Name"), "Orphan");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    // The dialog stays open with a field error, and no activity is created.
    expect(screen.getByRole("dialog", { name: "Add activity" })).toBeInTheDocument();
    expect(within(dialog).getByText("A project-specific activity must be assigned to a project.")).toBeInTheDocument();
    expect(useStore.getState().data.activities).toHaveLength(0);
  });

  it("hides an activity under an archived project", () => {
    const client = useStore.getState().addClient({ name: "Acme", color: "#111" });
    const project = useStore.getState().addProject({ name: "Lightning", clientId: client.id, color: "#222" });
    useStore.getState().addActivity({ name: "My Activity", kind: "project", projectId: project.id });
    useStore.getState().archiveEntity("projects", project.id);

    render(<ActivityList />);

    expect(screen.queryByText("My Activity")).not.toBeInTheDocument();
    expect(screen.queryByTestId("project-specific-activities")).not.toBeInTheDocument();
  });

  it("hides an activity whose project belongs to an archived client", () => {
    const client = useStore.getState().addClient({ name: "Acme", color: "#111" });
    const project = useStore.getState().addProject({ name: "Lightning", clientId: client.id, color: "#222" });
    useStore.getState().addActivity({ name: "My Activity", kind: "project", projectId: project.id });
    useStore.getState().archiveEntity("clients", client.id);

    render(<ActivityList />);

    expect(screen.queryByText("My Activity")).not.toBeInTheDocument();
  });

  // An unresolvable projectId means different things per mode (mirrors ProjectList's clientName
  // tests): in SERVER mode the per-account read strips archived parents from the slice, so it
  // reads as "(archived project)"; in the DEMO build the raw slice retains archived projects, so
  // it is genuinely dangling data and must NOT be dressed up as archival.
  const seedOrphanActivity = () => {
    useStore.getState().replaceAll(
      makeAppData({
        activities: [
          {
            id: "act-orphan",
            accountId: DEFAULT_ACCOUNT_ID,
            createdAt: "t",
            updatedAt: "t",
            name: "Orphan Activity",
            kind: "project",
            projectId: "nonexistent-project",
          },
        ],
      }),
    );
    useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID);
  };

  it("server mode retains an activity whose project resolves nowhere", () => {
    vi.stubEnv("VITE_CAPACITYLENS_DEMO", ""); // server mode is any value other than '1'
    seedOrphanActivity();

    render(<ActivityList />);

    expect(screen.getByText("Orphan Activity")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Unavailable client", level: 3 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Unavailable project", level: 4 })).toBeInTheDocument();
    vi.unstubAllEnvs();
  });

  it("demo mode also retains an activity whose project resolves nowhere", () => {
    vi.stubEnv("VITE_CAPACITYLENS_DEMO", "1");
    seedOrphanActivity();

    render(<ActivityList />);

    expect(screen.getByText("Orphan Activity")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Unavailable client", level: 3 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Unavailable project", level: 4 })).toBeInTheDocument();
    vi.unstubAllEnvs();
  });

  it("confirms before deleting and removes the activity from the list", async () => {
    const user = userEvent.setup();
    const client = useStore.getState().addClient({ name: "Acme", color: "#111" });
    const project = useStore.getState().addProject({ name: "Lightning", clientId: client.id, color: "#222" });
    useStore.getState().addActivity({ name: "My Activity", kind: "project", projectId: project.id });
    render(<ActivityList />);

    expect(screen.getByTestId("activity-row")).toBeInTheDocument();

    // Click Delete on the activity row — a confirm dialog appears
    await user.click(screen.getByRole("button", { name: "Delete My Activity" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent(/Delete activity\?/i);

    // Cancel keeps the activity
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(useStore.getState().data.activities).toHaveLength(1);

    // Confirm removes the activity
    await user.click(screen.getByRole("button", { name: "Delete My Activity" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));

    expect(useStore.getState().data.activities).toHaveLength(0);
    expect(screen.queryByTestId("activity-row")).not.toBeInTheDocument();
  });

  it("keeps deletion open and surfaces a store integrity failure", async () => {
    const user = userEvent.setup();
    const activity = useStore.getState().addActivity({ name: "Internal sync", kind: "internal" });
    const originalDelete = useStore.getState().deleteActivity;
    useStore.setState({
      deleteActivity: () => {
        throw new Error("Stored activity is inconsistent.");
      },
    });
    try {
      render(<ActivityList />);
      await user.click(
        within(screen.getByTestId("activity-row")).getByRole("button", { name: "Delete Internal sync" }),
      );
      const dialog = screen.getByRole("alertdialog");

      await user.click(within(dialog).getByRole("button", { name: "Delete" }));

      expect(dialog).toBeInTheDocument();
      expect(useStore.getState().data.activities).toContainEqual(activity);
      expect(useStore.getState().notice).toMatchObject({
        message: "Stored activity is inconsistent.",
        tone: "error",
      });
    } finally {
      useStore.setState({ deleteActivity: originalDelete });
    }
  });

  it("keeps the edit form open when its activity vanished during editing", async () => {
    const user = userEvent.setup();
    const client = useStore.getState().addClient({ name: "Acme", color: "#111" });
    const project = useStore.getState().addProject({ name: "Lightning", clientId: client.id, color: "#222" });
    const activity = useStore.getState().addActivity({ name: "A1", kind: "project", projectId: project.id });
    render(<ActivityList />);

    await user.click(within(screen.getByTestId("activity-row")).getByRole("button", { name: "Edit A1" }));
    const dialog = screen.getByRole("dialog", { name: "Edit activity" });
    act(() => useStore.getState().deleteActivity(activity.id));
    await user.clear(within(dialog).getByLabelText("Name"));
    await user.type(within(dialog).getByLabelText("Name"), "Renamed");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(screen.getByRole("dialog", { name: "Edit activity" })).toBeInTheDocument();
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/changed while you were editing/i);
    expect(useStore.getState().data.activities).toHaveLength(0);
  });
});
