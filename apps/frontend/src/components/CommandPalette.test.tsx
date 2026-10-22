import { requireCreated } from "@/test/requireCreated";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within, fireEvent, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { CommandPalette } from "./CommandPalette";
import { PermissionContext } from "@/auth/permissionContext";
import { useStore, buildEmptyFilters } from "@/store/useStore";
import {
  makeResourceDraft,
  DEFAULT_ACCOUNT_ID,
  resetStoreWithAccount,
  setExternalEnabled,
  setPlaceholdersEnabled,
} from "@/test/fixtures";
import { buildInternalClient } from "@capacitylens/shared/data/internalClient";
import { m } from "@/i18n";

function renderPalette(onClose = () => {}) {
  return render(
    <MemoryRouter>
      <CommandPalette onClose={onClose} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

function renderPaletteWithPermission(role: "owner" | "admin" | "editor" | "viewer", status: "pending" | "resolved") {
  return render(
    <PermissionContext.Provider value={{ role, status }}>
      <MemoryRouter>
        <CommandPalette onClose={() => {}} />
      </MemoryRouter>
    </PermissionContext.Provider>,
  );
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-probe">{`${location.pathname}${location.hash}`}</output>;
}

async function addInternalSearchItems() {
  const data = useStore.getState().data;
  const internal =
    data.clients.find((client) => client.builtin === true) ??
    buildInternalClient(DEFAULT_ACCOUNT_ID, "2026-05-01T00:00:00.000Z");
  useStore.getState().replaceAll({
    ...data,
    clients: data.clients.some((client) => client.id === internal.id) ? data.clients : [...data.clients, internal],
  });
  useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID);
  await useStore.getState().addProject({
    name: "Obsidian Programme",
    clientId: internal.id,
    color: "#6366f1",
  });
  await useStore.getState().addActivity({ name: "Office Ritual", kind: "internal" });
}

async function addOptionalResources() {
  const client = useStore.getState().data.clients.find((candidate) => candidate.name === "Queen Consolidated");
  if (!client) throw new Error("Expected Queen Consolidated client");
  const project = await requireCreated(
    useStore.getState().addProject({
      name: "Placeholder Project",
      clientId: client.id,
      color: "#6366f1",
    }),
  );
  await useStore.getState().addResource(
    makeResourceDraft({
      kind: "placeholder",
      role: "Senior Designer",
      projectId: project.id,
    }),
  );
  await useStore.getState().addResource(
    makeResourceDraft({
      kind: "external",
      name: "Kord Industries",
      role: "Partner studio",
    }),
  );
}

beforeEach(async () => {
  await resetStoreWithAccount();
  await useStore.getState().addClient({ name: "Queen Consolidated", color: "#6366f1" });
  await useStore.getState().addResource(makeResourceDraft({ name: "Bruce Wayne", role: "Designer" }));
  await useStore.getState().addResource(makeResourceDraft({ name: "Diana Prince", role: "Copywriter" }));
});

describe("CommandPalette", () => {
  it("renders with the input focused and shows Actions + Pages sections on empty query", () => {
    renderPalette();

    const input = screen.getByTestId("command-palette-input");
    expect(input).toBeInTheDocument();
    expect(document.activeElement).toBe(input);

    expect(screen.getByText("Actions")).toBeInTheDocument();
    expect(screen.getByText("Pages")).toBeInTheDocument();

    expect(screen.getByText("Go to today")).toBeInTheDocument();

    expect(screen.getByText("Schedule")).toBeInTheDocument();
    expect(screen.getByText("Resources")).toBeInTheDocument();
    expect(screen.getByText("Team & access")).toBeInTheDocument();
  });

  it("rejects an overlong paste, keeps the 256-unit query, and clears feedback after correction", async () => {
    const user = userEvent.setup();
    renderPalette();
    const input = screen.getByTestId("command-palette-input");
    const query = "x".repeat(256);

    await user.paste(query);
    expect(input).toHaveValue(query);

    await user.paste("y");
    expect(input).toHaveValue(query);
    expect(screen.getByRole("alert")).toHaveTextContent(m.validation_text_too_long());

    await user.keyboard("{Backspace}");
    expect(input).toHaveValue(query.slice(0, -1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each(["editor", "viewer"] as const)("hides Diagnostics from a resolved %s", (role) => {
    renderPaletteWithPermission(role, "resolved");

    expect(screen.getByText("Settings", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText("Diagnostics", { exact: true })).not.toBeInTheDocument();
  });

  it.each(["owner", "admin"] as const)("lists Diagnostics for a resolved %s", (role) => {
    renderPaletteWithPermission(role, "resolved");

    expect(screen.getByText("Diagnostics", { exact: true })).toBeInTheDocument();
  });

  it("hides Overview when the resolved role cannot access it", () => {
    renderPaletteWithPermission("viewer", "resolved");

    expect(screen.queryByText("Overview", { exact: true })).not.toBeInTheDocument();
  });

  it("lists every page exactly once, including Account, with disciplines on or off", async () => {
    const expectedWithDisciplines = [
      "Overview",
      "Schedule",
      "Resources",
      "Disciplines",
      "Clients",
      "Projects",
      "Activities",
      "Time off",
      "Team & access",
      "Settings",
      "Diagnostics",
      "Help",
      "Account",
    ];
    const expectedWithoutDisciplines = [
      "Overview",
      "Schedule",
      "Resources",
      "Clients",
      "Projects",
      "Activities",
      "Time off",
      "Team & access",
      "Settings",
      "Diagnostics",
      "Help",
      "Account",
    ];
    const pageLabels = () =>
      within(screen.getByRole("group", { name: m.palette_section_pages() }))
        .getAllByTestId("command-palette-option")
        .map((option) => option.firstElementChild?.textContent);

    renderPalette();
    expect(pageLabels()).toEqual(expectedWithDisciplines);
    expect(screen.getAllByText("Account", { exact: true })).toHaveLength(1);

    await act(async () => {
      await useStore.getState().updateAccount(DEFAULT_ACCOUNT_ID, { disciplinesEnabled: false });
    });
    expect(pageLabels()).toEqual(expectedWithoutDisciplines);
    expect(screen.getAllByText("Account", { exact: true })).toHaveLength(1);
  });

  it("navigates to Account and closes the palette when its page item is selected", () => {
    let closed = false;
    renderPalette(() => {
      closed = true;
    });

    const accountOption = screen
      .getAllByTestId("command-palette-option")
      .find((option) => option.textContent.includes("Account"));
    if (!accountOption) throw new Error("Expected Account command palette option");

    fireEvent.click(accountOption);

    expect(screen.getByTestId("location-probe")).toHaveTextContent("/account");
    expect(closed).toBe(true);
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
    if (!initialOption) throw new Error("Expected an initially active command palette option");
    expect(initialOption.id).toBeTruthy();
    await waitFor(() => expect(input).toHaveAttribute("aria-activedescendant", initialOption.id));

    fireEvent.keyDown(input, { key: "ArrowDown" });
    const movedOption = screen.getAllByRole("option").find((option) => option.getAttribute("aria-selected") === "true");
    if (!movedOption) throw new Error("Expected an active command palette option after ArrowDown");
    expect(movedOption.id).toBeTruthy();
    expect(movedOption.id).not.toBe(initialOption.id);
    await waitFor(() => expect(input).toHaveAttribute("aria-activedescendant", movedOption.id));

    fireEvent.change(input, { target: { value: "xyzzyxyzzy" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    await waitFor(() => expect(input).not.toHaveAttribute("aria-activedescendant"));
  });

  it("navigates to Help from its page command", async () => {
    const user = userEvent.setup();
    renderPalette();

    await user.click(screen.getByText("Help", { exact: true }));

    expect(screen.getByTestId("location-probe")).toHaveTextContent("/help");
  });
});

describe("CommandPalette", () => {
  it("shows People section when typing a resource name", () => {
    renderPalette();

    const input = screen.getByTestId("command-palette-input");
    fireEvent.change(input, { target: { value: "Bruce" } });

    expect(screen.getByText("People")).toBeInTheDocument();
    const options = screen.getAllByTestId("command-palette-option");
    const tylerOption = options.find((o) => {
      const textContent = o.textContent;
      return textContent.includes("Bruce Wayne");
    });
    expect(tylerOption).toBeTruthy();
  });

  it("omits placeholder and external jump targets while their account settings are off", async () => {
    await addOptionalResources();
    renderPalette();
    const input = screen.getByTestId("command-palette-input");

    fireEvent.change(input, { target: { value: "Placeholder" } });
    expect(screen.queryByText("Placeholder")).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "Kord" } });
    expect(screen.queryByText(/Kord Industries/)).not.toBeInTheDocument();
  });

  it("includes enabled optional resources and labels an external jump target", async () => {
    await addOptionalResources();
    await setPlaceholdersEnabled({ on: true });
    await setExternalEnabled({ on: true });
    renderPalette();
    const input = screen.getByTestId("command-palette-input");

    fireEvent.change(input, { target: { value: "Placeholder" } });
    expect(screen.getByText("Placeholder")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "Kord" } });
    expect(screen.getByText("Kord Industries (external)")).toBeInTheDocument();
  });

  it("finds an accented resource name from its unaccented spelling", async () => {
    await useStore.getState().addResource(makeResourceDraft({ name: "José Müller", role: "Strategist" }));
    renderPalette();

    fireEvent.change(screen.getByTestId("command-palette-input"), {
      target: { value: "jose muller" },
    });

    expect(screen.getByText("People")).toBeInTheDocument();
    expect(screen.getByText("José Müller")).toBeInTheDocument();
  });
});

describe("CommandPalette", () => {
  it("keeps an Internal project searchable", async () => {
    await addInternalSearchItems();
    renderPalette();

    fireEvent.change(screen.getByTestId("command-palette-input"), {
      target: { value: "Obsidian Programme" },
    });

    expect(screen.getByText("Obsidian Programme")).toBeInTheDocument();
  });

  it("keeps an Internal activity searchable", async () => {
    await addInternalSearchItems();
    renderPalette();

    fireEvent.change(screen.getByTestId("command-palette-input"), {
      target: { value: "Office Ritual" },
    });

    expect(screen.getByText("Office Ritual")).toBeInTheDocument();
    expect(screen.getByText("Internal")).toBeInTheDocument();
  });
});

describe("CommandPalette", () => {
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
});

describe("CommandPalette", () => {
  it("ArrowDown moves highlight to next option", () => {
    renderPalette();

    const input = screen.getByTestId("command-palette-input");

    const options = screen.getAllByTestId("command-palette-option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[1]).toHaveAttribute("aria-selected", "false");

    fireEvent.keyDown(input, { key: "ArrowDown" });

    const updatedOptions = screen.getAllByTestId("command-palette-option");
    expect(updatedOptions[0]).toHaveAttribute("aria-selected", "false");
    expect(updatedOptions[1]).toHaveAttribute("aria-selected", "true");
  });

  it("ArrowUp stays clamped when already at the first option", () => {
    renderPalette();

    const input = screen.getByTestId("command-palette-input");
    const options = screen.getAllByTestId("command-palette-option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");

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
});

describe("CommandPalette", () => {
  it("mouse hover sets the active option", () => {
    renderPalette();

    const options = screen.getAllByTestId("command-palette-option");
    if (!options[0] || !options[1]) throw new Error("Expected command palette options");
    // cmdk responds to pointermove rather than mouseenter, so simulate that event to exercise hover selection.
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
});

describe("CommandPalette", () => {
  it("jumpToResource is called when a resource is selected", () => {
    renderPalette();

    const input = screen.getByTestId("command-palette-input");
    fireEvent.change(input, { target: { value: "Bruce" } });

    const options = screen.getAllByTestId("command-palette-option");
    const tylerOption = options.find((o) => {
      const textContent = o.textContent;
      return textContent.includes("Bruce Wayne");
    });
    if (!tylerOption) throw new Error("Expected Bruce Wayne command palette option");
    expect(tylerOption).toBeTruthy();

    act(() => {
      fireEvent.click(tylerOption);
    });

    const sr = useStore.getState().ui.scrollToResource;
    expect(sr).not.toBeNull();
    if (!sr) throw new Error("Expected scroll-to-resource state after selecting a resource");
    expect(sr.token).toBeGreaterThan(0);
    expect(sr.consumed).toBe(false);
  });
});

describe("CommandPalette", () => {
  it("setFilters is called with projectId when a project is selected", async () => {
    const clients = useStore.getState().data.clients;
    const client = clients[0];
    if (!client) throw new Error("Expected client");
    await useStore.getState().addProject({
      name: "Project Watchtower",
      clientId: client.id,
      color: "#6366f1",
    });

    renderPalette();

    const input = screen.getByTestId("command-palette-input");
    fireEvent.change(input, { target: { value: "Watchtower" } });

    const options = screen.getAllByTestId("command-palette-option");
    const projectOption = options.find((o) => {
      const textContent = o.textContent;
      return textContent.includes("Project Watchtower");
    });
    if (!projectOption) throw new Error("Expected Project Watchtower command palette option");
    expect(projectOption).toBeTruthy();

    act(() => {
      fireEvent.click(projectOption);
    });

    const filters = useStore.getState().ui.filters;
    expect(filters.projectId).not.toBeNull();
  });
});

describe("CommandPalette", () => {
  it("carries the selected activity identity to the complete activity list", async () => {
    const activity = await requireCreated(useStore.getState().addActivity({ name: "Kickoff", kind: "internal" }));
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
});

describe("CommandPalette", () => {
  it("project selection REPLACES stale filters with only projectId set", async () => {
    const clients = useStore.getState().data.clients;
    const client = clients[0];
    if (!client) throw new Error("Expected client");
    const p = await requireCreated(
      useStore.getState().addProject({
        name: "Project Alpha",
        clientId: client.id,
        color: "#6366f1",
      }),
    );
    const projectId = p.id;

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
    const projectOption = options.find((o) => {
      const textContent = o.textContent;
      return textContent.includes("Project Alpha");
    });
    if (!projectOption) throw new Error("Expected Project Alpha command palette option");
    expect(projectOption).toBeTruthy();

    act(() => {
      fireEvent.click(projectOption);
    });

    const filters = useStore.getState().ui.filters;
    if (!projectId) throw new Error("Expected Project Alpha id");
    expect(filters).toEqual({ ...buildEmptyFilters(), projectId });
  });
});

describe("CommandPalette", () => {
  it("client selection REPLACES stale filters with only clientId set", async () => {
    const c = await requireCreated(useStore.getState().addClient({ name: "Client Zeta", color: "#6366f1" }));
    const clientId = c.id;

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
    const clientOption = options.find((o) => {
      const textContent = o.textContent;
      return textContent.includes("Client Zeta");
    });
    if (!clientOption) throw new Error("Expected Client Zeta command palette option");
    expect(clientOption).toBeTruthy();

    act(() => {
      fireEvent.click(clientOption);
    });

    const filters = useStore.getState().ui.filters;
    if (!clientId) throw new Error("Expected Client Zeta id");
    expect(filters).toEqual({ ...buildEmptyFilters(), clientId });
  });
});
