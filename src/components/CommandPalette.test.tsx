import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { CommandPalette } from "./CommandPalette";
import { useStore, emptyFilters } from "../store/useStore";
import {
  makeAppData,
  makeAccount,
  makeResourceDraft,
  DEFAULT_ACCOUNT_ID,
  setExternalEnabled,
  setPlaceholdersEnabled,
} from "../test/fixtures";
import { buildInternalClient } from "@capacitylens/shared/data/internalClient";

function renderPalette(onClose = () => {}) {
  return render(
    <MemoryRouter>
      <CommandPalette onClose={onClose} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-probe">{`${location.pathname}${location.hash}`}</output>;
}

function addInternalSearchItems({
  showInternalProjects,
  showInternalActivities,
}: {
  showInternalProjects: boolean;
  showInternalActivities: boolean;
}) {
  const data = useStore.getState().data;
  const internal =
    data.clients.find((client) => client.builtin === true) ??
    buildInternalClient(DEFAULT_ACCOUNT_ID, "2026-05-01T00:00:00.000Z");
  useStore.getState().replaceAll({
    ...data,
    accounts: data.accounts.map((account) => ({
      ...account,
      showInternalProjects,
      showInternalActivities,
    })),
    clients: data.clients.some((client) => client.id === internal.id) ? data.clients : [...data.clients, internal],
  });
  useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID);
  useStore.getState().addProject({
    name: "Obsidian Programme",
    clientId: internal.id,
    color: "#6366f1",
  });
  useStore.getState().addActivity({ name: "Office Ritual", kind: "internal" });
}

function addOptionalResources() {
  const client = useStore.getState().data.clients.find((candidate) => candidate.name === "Acme Inc.")!;
  const project = useStore.getState().addProject({
    name: "Placeholder Project",
    clientId: client.id,
    color: "#6366f1",
  });
  useStore.getState().addResource(
    makeResourceDraft({
      kind: "placeholder",
      name: undefined,
      role: "Senior Designer",
      projectId: project.id,
    }),
  );
  useStore.getState().addResource(
    makeResourceDraft({
      kind: "external",
      name: "Northstar Partners",
      role: "Partner studio",
    }),
  );
}

beforeEach(() => {
  useStore.getState().replaceAll(
    makeAppData({
      accounts: [makeAccount()],
    }),
  );
  useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID);
  // Add some resources, clients, projects for search tests
  useStore.getState().addClient({ name: "Acme Inc.", color: "#6366f1" });
  useStore.getState().addResource(makeResourceDraft({ name: "Tyler Nix", role: "Designer" }));
  useStore.getState().addResource(makeResourceDraft({ name: "Pam Gonzalez", role: "Copywriter" }));
});

describe("CommandPalette", () => {
  it("renders with the input focused and shows Actions + Pages sections on empty query", () => {
    renderPalette();

    const input = screen.getByTestId("command-palette-input");
    expect(input).toBeInTheDocument();
    expect(document.activeElement).toBe(input);

    // Should show Actions and Pages by default
    expect(screen.getByText("Actions")).toBeInTheDocument();
    expect(screen.getByText("Pages")).toBeInTheDocument();

    // Go to today action
    expect(screen.getByText("Go to today")).toBeInTheDocument();

    // All page entries
    expect(screen.getByText("Schedule")).toBeInTheDocument();
    expect(screen.getByText("Resources")).toBeInTheDocument();
    expect(screen.getByText("Team & access")).toBeInTheDocument();
  });

  it("has correct ARIA attributes for combobox pattern", async () => {
    renderPalette();

    const input = screen.getByTestId("command-palette-input");
    expect(input).toHaveAttribute("role", "combobox");
    expect(input).toHaveAttribute("aria-autocomplete", "list");

    const list = screen.getByRole("listbox");
    expect(list).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-controls", list.id);

    const initialOption = screen
      .getAllByRole("option")
      .find((option) => option.getAttribute("aria-selected") === "true");
    expect(initialOption?.id).toBeTruthy();
    await waitFor(() => expect(input).toHaveAttribute("aria-activedescendant", initialOption?.id));

    fireEvent.keyDown(input, { key: "ArrowDown" });
    const movedOption = screen.getAllByRole("option").find((option) => option.getAttribute("aria-selected") === "true");
    expect(movedOption?.id).toBeTruthy();
    expect(movedOption?.id).not.toBe(initialOption?.id);
    await waitFor(() => expect(input).toHaveAttribute("aria-activedescendant", movedOption?.id));

    fireEvent.change(input, { target: { value: "xyzzyxyzzy" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    await waitFor(() => expect(input).not.toHaveAttribute("aria-activedescendant"));
  });

  it("shows People section when typing a resource name", () => {
    renderPalette();

    const input = screen.getByTestId("command-palette-input");
    fireEvent.change(input, { target: { value: "Tyler" } });

    expect(screen.getByText("People")).toBeInTheDocument();
    const options = screen.getAllByTestId("command-palette-option");
    const tylerOption = options.find((o) => o.textContent?.includes("Tyler Nix"));
    expect(tylerOption).toBeTruthy();
  });

  it("omits placeholder and external jump targets while their account settings are off", () => {
    addOptionalResources();
    renderPalette();
    const input = screen.getByTestId("command-palette-input");

    fireEvent.change(input, { target: { value: "Placeholder" } });
    expect(screen.queryByText("Placeholder")).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "Northstar" } });
    expect(screen.queryByText(/Northstar Partners/)).not.toBeInTheDocument();
  });

  it("includes enabled optional resources and labels an external jump target", () => {
    addOptionalResources();
    setPlaceholdersEnabled(true);
    setExternalEnabled(true);
    renderPalette();
    const input = screen.getByTestId("command-palette-input");

    fireEvent.change(input, { target: { value: "Placeholder" } });
    expect(screen.getByText("Placeholder")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "Northstar" } });
    expect(screen.getByText("Northstar Partners (external)")).toBeInTheDocument();
  });

  it("finds an accented resource name from its unaccented spelling", () => {
    useStore.getState().addResource(makeResourceDraft({ name: "José Müller", role: "Strategist" }));
    renderPalette();

    fireEvent.change(screen.getByTestId("command-palette-input"), {
      target: { value: "jose muller" },
    });

    expect(screen.getByText("People")).toBeInTheDocument();
    expect(screen.getByText("José Müller")).toBeInTheDocument();
  });

  it("omits an Internal project whose destination bars are hidden from the schedule", () => {
    addInternalSearchItems({
      showInternalProjects: false,
      showInternalActivities: false,
    });
    renderPalette();

    fireEvent.change(screen.getByTestId("command-palette-input"), {
      target: { value: "Obsidian Programme" },
    });

    expect(screen.queryByText("Obsidian Programme")).not.toBeInTheDocument();
  });

  it("keeps an Internal project searchable when its destination bars are shown", () => {
    addInternalSearchItems({
      showInternalProjects: true,
      showInternalActivities: false,
    });
    renderPalette();

    fireEvent.change(screen.getByTestId("command-palette-input"), {
      target: { value: "Obsidian Programme" },
    });

    expect(screen.getByText("Obsidian Programme")).toBeInTheDocument();
  });

  it("keeps an Internal activity searchable when its schedule bars are hidden", () => {
    addInternalSearchItems({
      showInternalProjects: false,
      showInternalActivities: false,
    });
    renderPalette();

    fireEvent.change(screen.getByTestId("command-palette-input"), {
      target: { value: "Office Ritual" },
    });

    expect(screen.getByText("Office Ritual")).toBeInTheDocument();
    expect(screen.getByText("Internal")).toBeInTheDocument();
  });

  it("shows no results message for unmatched query", () => {
    renderPalette();

    const input = screen.getByTestId("command-palette-input");
    fireEvent.change(input, { target: { value: "xyzzyxyzzy" } });

    expect(screen.getByText(/No results for/)).toBeInTheDocument();
  });

  it('shows "Go to date" action when query is a valid ISO date', () => {
    renderPalette();

    const input = screen.getByTestId("command-palette-input");
    fireEvent.change(input, { target: { value: "2026-06-03" } });

    expect(screen.getByText("Go to date 2026-06-03")).toBeInTheDocument();
  });

  it('does NOT show "Go to date" action for non-date query', () => {
    renderPalette();

    const input = screen.getByTestId("command-palette-input");
    fireEvent.change(input, { target: { value: "2026-99-99" } });

    expect(screen.queryByText(/Go to date/)).not.toBeInTheDocument();
  });

  it("ArrowDown moves highlight to next option", () => {
    renderPalette();

    const input = screen.getByTestId("command-palette-input");
    // Initially first option is active (aria-selected="true")
    const options = screen.getAllByTestId("command-palette-option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[1]).toHaveAttribute("aria-selected", "false");

    fireEvent.keyDown(input, { key: "ArrowDown" });

    const updatedOptions = screen.getAllByTestId("command-palette-option");
    expect(updatedOptions[0]).toHaveAttribute("aria-selected", "false");
    expect(updatedOptions[1]).toHaveAttribute("aria-selected", "true");
  });

  it("ArrowUp wraps to first when already at first option", () => {
    renderPalette();

    const input = screen.getByTestId("command-palette-input");
    const options = screen.getAllByTestId("command-palette-option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");

    // ArrowUp from first should stay at first (clamped)
    fireEvent.keyDown(input, { key: "ArrowUp" });

    const updatedOptions = screen.getAllByTestId("command-palette-option");
    expect(updatedOptions[0]).toHaveAttribute("aria-selected", "true");
  });

  it("Enter selects the active option and closes the palette", () => {
    let closed = false;
    renderPalette(() => {
      closed = true;
    });

    const input = screen.getByTestId("command-palette-input");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(closed).toBe(true);
  });

  it("Escape closes the palette", () => {
    let closed = false;
    renderPalette(() => {
      closed = true;
    });

    const input = screen.getByTestId("command-palette-input");
    fireEvent.keyDown(input, { key: "Escape" });

    expect(closed).toBe(true);
  });

  it("mouse hover sets the active option", () => {
    renderPalette();

    const options = screen.getAllByTestId("command-palette-option");
    // Hover the second option. cmdk activates on its native onPointerMove (not mouseEnter), so the
    // interaction fires pointerMove — the assertion (hovering a row makes it the active option) is
    // unchanged.
    fireEvent.pointerMove(options[1]);

    expect(options[0]).toHaveAttribute("aria-selected", "false");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
  });

  it("backdrop click closes the palette", () => {
    let closed = false;
    renderPalette(() => {
      closed = true;
    });

    const overlay = screen.getByTestId("command-palette-overlay");
    act(() => {
      fireEvent.mouseDown(overlay);
    });

    expect(closed).toBe(true);
  });

  it("jumpToResource is called when a resource is selected", () => {
    renderPalette();

    const input = screen.getByTestId("command-palette-input");
    fireEvent.change(input, { target: { value: "Tyler" } });

    const options = screen.getAllByTestId("command-palette-option");
    const tylerOption = options.find((o) => o.textContent?.includes("Tyler Nix"));
    expect(tylerOption).toBeTruthy();

    // Click it — should call jumpToResource (store action). cmdk's onSelect fires on click (and
    // Enter), so the pointer pick is a click; the assertion (selecting the row runs its action) holds.
    act(() => {
      fireEvent.click(tylerOption!);
    });

    // The scrollToResource state should be set in the store
    const sr = useStore.getState().ui.scrollToResource;
    expect(sr).not.toBeNull();
    expect(sr?.token).toBeGreaterThan(0);
    expect(sr?.consumed).toBe(false);
  });

  it("setFilters is called with projectId when a project is selected", () => {
    // Add a project first
    const clients = useStore.getState().data.clients;
    const client = clients[0];
    act(() => {
      useStore.getState().addProject({
        name: "Project Lightning",
        clientId: client.id,
        color: "#6366f1",
      });
    });

    renderPalette();

    const input = screen.getByTestId("command-palette-input");
    fireEvent.change(input, { target: { value: "Lightning" } });

    const options = screen.getAllByTestId("command-palette-option");
    const projectOption = options.find((o) => o.textContent?.includes("Project Lightning"));
    expect(projectOption).toBeTruthy();

    act(() => {
      fireEvent.click(projectOption!);
    });

    // The filters should be updated
    const filters = useStore.getState().ui.filters;
    expect(filters.projectId).not.toBeNull();
  });

  it("carries the selected activity identity to the complete activity list", () => {
    const activity = useStore.getState().addActivity({ name: "Kickoff", kind: "internal" });
    renderPalette();

    fireEvent.change(screen.getByTestId("command-palette-input"), { target: { value: "Kickoff" } });
    fireEvent.click(screen.getByText("Kickoff"));

    expect(screen.getByTestId("location-probe")).toHaveTextContent(
      `/activities#activity=${encodeURIComponent(activity.id)}`,
    );
  });

  it('does NOT show "Go to date" for an impossible date (2026-02-31)', () => {
    renderPalette();

    const input = screen.getByTestId("command-palette-input");
    fireEvent.change(input, { target: { value: "2026-02-31" } });

    expect(screen.queryByText(/Go to date/)).not.toBeInTheDocument();
  });

  it("project selection REPLACES stale filters with only projectId set", () => {
    const clients = useStore.getState().data.clients;
    const client = clients[0];
    let projectId: string;
    act(() => {
      const p = useStore.getState().addProject({
        name: "Project Alpha",
        clientId: client.id,
        color: "#6366f1",
      });
      projectId = p.id;
    });

    // Pre-set stale filters that should be wiped on project select
    act(() => {
      useStore.getState().setFilters({
        search: "stale-search",
        disciplineId: "disc-stale",
        clientId: "client-stale",
        hideTentative: true,
        showUnmatched: true,
      });
    });

    renderPalette();

    const input = screen.getByTestId("command-palette-input");
    fireEvent.change(input, { target: { value: "Alpha" } });

    const options = screen.getAllByTestId("command-palette-option");
    const projectOption = options.find((o) => o.textContent?.includes("Project Alpha"));
    expect(projectOption).toBeTruthy();

    act(() => {
      fireEvent.click(projectOption!);
    });

    // Filters must deep-equal { ...emptyFilters(), projectId } — no stale fields survive
    const filters = useStore.getState().ui.filters;
    expect(filters).toEqual({ ...emptyFilters(), projectId: projectId! });
  });

  it("client selection REPLACES stale filters with only clientId set", () => {
    let clientId: string;
    act(() => {
      const c = useStore.getState().addClient({ name: "Client Zeta", color: "#6366f1" });
      clientId = c.id;
    });

    // Pre-set stale filters
    act(() => {
      useStore.getState().setFilters({
        search: "stale",
        disciplineId: "disc-stale",
        projectId: "proj-stale",
        hideTentative: true,
        showUnmatched: true,
      });
    });

    renderPalette();

    const input = screen.getByTestId("command-palette-input");
    fireEvent.change(input, { target: { value: "Zeta" } });

    const options = screen.getAllByTestId("command-palette-option");
    const clientOption = options.find((o) => o.textContent?.includes("Client Zeta"));
    expect(clientOption).toBeTruthy();

    act(() => {
      fireEvent.click(clientOption!);
    });

    // Filters must deep-equal { ...emptyFilters(), clientId } — no stale fields survive
    const filters = useStore.getState().ui.filters;
    expect(filters).toEqual({ ...emptyFilters(), clientId: clientId! });
  });
});
