import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SchedulerToolbar } from "./SchedulerToolbar";
import { emptyFilters, useStore } from "../../store/useStore";
import { resetStoreWithAccount } from "../../test/fixtures";

async function chooseOption(_user: ReturnType<typeof userEvent.setup>, label: string | RegExp, optionName: string) {
  const trigger = screen.getByRole("combobox", { name: label });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("option", { name: optionName }));
}

function showFilters() {
  fireEvent.click(screen.getByRole("button", { name: "Show filters" }));
}

beforeEach(() => {
  resetStoreWithAccount();
  useStore.getState().clearFilters();
  useStore.getState().setZoom(4);
});

describe("SchedulerToolbar weeks dropdown", () => {
  it("offers every zoom level in words and selects the current one", () => {
    render(<SchedulerToolbar />);

    const trigger = screen.getByRole("combobox", { name: /Weeks visible/ });
    expect(trigger).toHaveTextContent("4 weeks");
    // The visible text must live INSIDE the accessible name (WCAG 2.5.3 Label in Name), so speech
    // input can act on what the user reads: "Weeks visible" alone would not contain "4 weeks".
    expect(trigger).toHaveAccessibleName("Weeks visible, 4 weeks");

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    // Singular for 1, plural beyond it — and no leftover "4w" segment buttons.
    expect(screen.getByRole("option", { name: "1 week" })).toBeInTheDocument();
    for (const weeks of [2, 4, 6, 8]) {
      expect(screen.getByRole("option", { name: `${weeks} weeks` })).toBeInTheDocument();
    }
    expect(screen.queryByRole("radio", { name: "4w" })).not.toBeInTheDocument();
  });

  it("choosing a level sets ui.zoom (weeks visible)", async () => {
    const user = userEvent.setup();
    render(<SchedulerToolbar />);

    await chooseOption(user, /Weeks visible/, "8 weeks");
    expect(useStore.getState().ui.zoom).toBe(8);

    await chooseOption(user, /Weeks visible/, "1 week");
    expect(useStore.getState().ui.zoom).toBe(1);
  });
});

describe("SchedulerToolbar date navigation", () => {
  // Prev/Next are icon-only; the accessible name is what both users and locators rely on.
  it.each([
    ["Prev", -7],
    ["Next", 7],
  ] as const)("%s pans the window by a week", async (name, days) => {
    const user = userEvent.setup();
    const panDays = vi.fn();
    useStore.setState({ panDays });
    render(<SchedulerToolbar />);

    await user.click(screen.getByRole("button", { name }));
    expect(panDays).toHaveBeenCalledWith(days);
  });

  // The picker is hidden, not deleted — JumpToDateInput.test.tsx covers the component itself.
  it("does not render the jump-to-date picker", () => {
    render(<SchedulerToolbar />);

    expect(screen.queryByLabelText("Jump to date")).not.toBeInTheDocument();
  });
});

describe("SchedulerToolbar search filter", () => {
  it("typing in the Search field updates ui.filters.search", async () => {
    const user = userEvent.setup();
    render(<SchedulerToolbar />);
    showFilters();

    await user.type(screen.getByLabelText("Search people"), "Alice");

    // The search is debounced into the store, so the update lands shortly after typing.
    await waitFor(() => expect(useStore.getState().ui.filters.search).toBe("Alice"));
  });
});

describe("SchedulerToolbar filter panel", () => {
  it("starts collapsed and toggles the filters and draw mode below the primary toolbar", async () => {
    const user = userEvent.setup();
    render(<SchedulerToolbar />);

    const show = screen.getByRole("button", { name: "Show filters" });
    expect(show).toHaveAttribute("aria-expanded", "false");
    expect(show.querySelector("svg")).not.toBeNull();
    expect(screen.queryByLabelText("Search people")).not.toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Draw mode" })).not.toBeInTheDocument();

    await user.click(show);
    const hide = screen.getByRole("button", { name: "Hide filters" });
    expect(hide).toHaveAttribute("aria-expanded", "true");
    expect(hide).toHaveAttribute("aria-controls", "scheduler-filters");
    expect(screen.getByLabelText("Search people")).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Draw mode" })).toBeInTheDocument();

    await user.click(hide);
    expect(screen.getByRole("button", { name: "Show filters" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Search people")).not.toBeInTheDocument();
  });
});

// The Undo/Redo toolbar buttons (undo-button / redo-button) and the keyboard path
// (⌘Z / ⌘⇧Z via AppShell) are both exercised end-to-end in e2e/toolbar.spec.ts.
describe("SchedulerToolbar history errors", () => {
  it.each([
    ["Undo", "undo"],
    ["Redo", "redo"],
  ] as const)("surfaces a rejected %s action as a persistent error notice", async (buttonName, action) => {
    const user = userEvent.setup();
    const original = useStore.getState()[action];
    useStore.setState({
      [action]: () => {
        throw new Error("History is corrupt");
      },
      ...(action === "undo" ? { past: [useStore.getState().data] } : { future: [useStore.getState().data] }),
    });

    try {
      render(<SchedulerToolbar />);
      await user.click(screen.getByRole("button", { name: buttonName }));

      expect(useStore.getState().notice).toEqual({
        message: "History is corrupt",
        tone: "error",
      });
    } finally {
      useStore.setState({ [action]: original });
    }
  });
});

describe("SchedulerToolbar Clear filter button", () => {
  it("Clear button is absent when no filters are set", () => {
    render(<SchedulerToolbar />);
    showFilters();

    expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
  });

  it("Clear button appears once a filter is set", async () => {
    const user = userEvent.setup();
    render(<SchedulerToolbar />);
    showFilters();

    await user.type(screen.getByLabelText("Search people"), "Bob");

    // Clear appears once the debounced search reaches the store.
    expect(await screen.findByRole("button", { name: "Clear" })).toBeInTheDocument();
  });

  it("clicking Clear resets all filters and hides the Clear button", async () => {
    const user = userEvent.setup();
    render(<SchedulerToolbar />);
    showFilters();

    await user.type(screen.getByLabelText("Search people"), "Bob");
    expect(await screen.findByRole("button", { name: "Clear" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(useStore.getState().ui.filters.search).toBe("");
    expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
  });

  it("Clear cancels a pending search debounce so a cleared term cannot reappear", async () => {
    const user = userEvent.setup();
    // A non-search filter is active so Clear renders immediately, before the debounce.
    useStore.getState().setFilters({ disciplineId: "d1" });
    render(<SchedulerToolbar />);
    showFilters();

    await user.type(screen.getByLabelText("Search people"), "jo"); // schedules a 180ms timer
    await user.click(screen.getByRole("button", { name: "Clear" })); // must cancel it

    // Wait past the debounce window: the orphaned timer must NOT re-apply "jo".
    await new Promise((r) => setTimeout(r, 250));
    expect(useStore.getState().ui.filters.search).toBe("");
    expect((screen.getByLabelText("Search people") as HTMLInputElement).value).toBe("");
  });

  it("an EXTERNAL filters.search reset (e.g. account switch) cancels a pending search debounce", async () => {
    useStore.getState().setFilters({ search: "alice" }); // a committed search
    render(<SchedulerToolbar />);
    showFilters();

    const box = screen.getByLabelText("Search people") as HTMLInputElement;
    // Type a new term — schedules a 180ms timer to setFilters({ search: 'bob' }); filters.search
    // is still 'alice' (the debounce hasn't fired).
    fireEvent.change(box, { target: { value: "bob" } });
    // Simulate the external reset an account switch performs (filters → emptyFilters).
    useStore.getState().setFilters({ search: "" });

    // Past the debounce window: the stale 'bob' must NOT have clobbered the cleared value.
    await new Promise((r) => setTimeout(r, 250));
    expect(useStore.getState().ui.filters.search).toBe("");
  });

  it("a filters REPLACEMENT that leaves search unchanged (palette selection) still kills a pending debounce", async () => {
    render(<SchedulerToolbar />);
    showFilters();
    const box = screen.getByLabelText("Search people") as HTMLInputElement;

    // Pending term: the store's search is '' and STAYS '' through the replacement below,
    // so any logic keyed on the search VALUE cannot see this write — the race the palette
    // e2e spec kept tripping (the timer resurrected the stale term over the replacement).
    fireEvent.change(box, { target: { value: "zzz-nobody-matches-zzz" } });
    // What CommandPalette's project selection does: REPLACE the filters wholesale.
    useStore.getState().setFilters({ ...emptyFilters(), projectId: "p1" });

    await new Promise((r) => setTimeout(r, 250));
    expect(useStore.getState().ui.filters.search).toBe(""); // not resurrected
    expect(useStore.getState().ui.filters.projectId).toBe("p1"); // replacement intact
    expect(box.value).toBe(""); // stale text gone from the box too
  });

  it("commits pending search text when another toolbar filter changes", async () => {
    const client = useStore.getState().addClient({ name: "Acme", color: "#111" });
    render(<SchedulerToolbar />);
    showFilters();
    const box = screen.getByLabelText("Search people") as HTMLInputElement;

    fireEvent.change(box, { target: { value: "ali" } });
    await chooseOption(userEvent.setup(), "Filter by client", "Acme");

    expect(box.value).toBe("ali");
    expect(useStore.getState().ui.filters).toMatchObject({
      search: "ali",
      clientId: client.id,
    });
  });
});

describe("SchedulerToolbar Activities filter (standalone lens)", () => {
  // Seed one internal + one cross-project activity so the Activities dropdown renders (it covers only the
  // project-less kinds; project-specific activities are reached via the Projects dropdown).
  const seedLensActivities = () => ({
    internal: useStore.getState().addActivity({ name: "Admin", kind: "internal" }),
    repeatable: useStore.getState().addActivity({ name: "Design", kind: "repeatable" }),
  });

  it("renders the Activities dropdown with grouped Internal / Cross-project options", async () => {
    seedLensActivities();
    render(<SchedulerToolbar />);
    showFilters();
    const select = screen.getByRole("combobox", { name: "Filter by activity" });
    expect(select).toBeInTheDocument();
    fireEvent.keyDown(select, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "Internal — All" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Cross-project — All" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Admin" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Design" })).toBeInTheDocument();
  });

  it("is absent when the account has no project-less activities", () => {
    render(<SchedulerToolbar />);
    showFilters();
    expect(screen.queryByLabelText("Filter by activity")).not.toBeInTheDocument();
  });

  it("selecting a specific activity sets activityId and clears the client/project lens", async () => {
    const user = userEvent.setup();
    const { repeatable } = seedLensActivities();
    useStore.getState().setFilters({ projectId: "p1" }); // an active project lens
    render(<SchedulerToolbar />);
    showFilters();

    await chooseOption(user, "Filter by activity", "Design");

    expect(useStore.getState().ui.filters.activityId).toBe(repeatable.id);
    expect(useStore.getState().ui.filters.activityKind).toBeNull();
    expect(useStore.getState().ui.filters.projectId).toBeNull(); // standalone lens cleared it
  });

  it('selecting "Internal — All" sets activityKind and clears the client/project lens', async () => {
    const user = userEvent.setup();
    seedLensActivities();
    useStore.getState().setFilters({ clientId: "c1" });
    render(<SchedulerToolbar />);
    showFilters();

    await chooseOption(user, "Filter by activity", "Internal — All");

    expect(useStore.getState().ui.filters.activityKind).toBe("internal");
    expect(useStore.getState().ui.filters.activityId).toBeNull();
    expect(useStore.getState().ui.filters.clientId).toBeNull();
  });

  it("selecting a project clears an active activity lens (mutual exclusion both ways)", async () => {
    const user = userEvent.setup();
    const { repeatable } = seedLensActivities();
    const client = useStore.getState().addClient({ name: "Acme", color: "#111" });
    const project = useStore.getState().addProject({ name: "Lightning", clientId: client.id, color: "#222" });
    useStore.getState().setFilters({ activityId: repeatable.id });
    render(<SchedulerToolbar />);
    showFilters();

    await chooseOption(user, "Filter by project", "Acme / Lightning");

    expect(useStore.getState().ui.filters.projectId).toBe(project.id);
    expect(useStore.getState().ui.filters.activityId).toBeNull();
    expect(useStore.getState().ui.filters.activityKind).toBeNull();
  });

  it("qualifies same-named projects with their client names", () => {
    const firstClient = useStore.getState().addClient({ name: "Acme", color: "#111" });
    const secondClient = useStore.getState().addClient({ name: "Globex", color: "#222" });
    useStore.getState().addProject({ name: "Website", clientId: firstClient.id, color: "#333" });
    useStore.getState().addProject({
      name: "Website",
      clientId: secondClient.id,
      color: "#444",
    });
    render(<SchedulerToolbar />);
    showFilters();

    fireEvent.keyDown(screen.getByRole("combobox", { name: "Filter by project" }), { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "Acme / Website" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Globex / Website" })).toBeInTheDocument();
  });
});
