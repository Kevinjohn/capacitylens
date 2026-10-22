import { requireCreated } from "@/test/requireCreated";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ResourceList } from "./ResourceList";
import { useStore } from "@/store/useStore";
import {
  DEFAULT_ACCOUNT_ID,
  WORKDAYS,
  resetStoreWithAccount,
  requireValue,
  setExternalEnabled,
  setPlaceholdersEnabled,
} from "@/test/fixtures";
import { PermissionContext } from "@/auth/permissionContext";

beforeEach(async () => {
  await resetStoreWithAccount();
  useStore.getState().clearFilters();
  // Enable placeholders for this suite because the management cases require their otherwise-hidden section.
  await setPlaceholdersEnabled({ on: true });
});

const personDraft = (name: string) => ({
  kind: "person" as const,
  name,
  role: "Developer",
  employmentType: "permanent" as const,
  engagement: "studio" as const,
  workingHoursPerDay: 8,
  workingDays: WORKDAYS,
  halfDays: [],
  color: "#3b82f6",
});

const freelancerDraft = (name: string) => ({
  kind: "person" as const,
  name,
  role: "Designer",
  employmentType: "freelancer" as const,
  engagement: "studio" as const,
  workingHoursPerDay: 8,
  workingDays: WORKDAYS,
  halfDays: [],
  color: "#f59e0b",
});

describe("ResourceList display", () => {
  it("does not direct resource management to Team & access", () => {
    render(
      <PermissionContext.Provider value={{ role: "owner", status: "resolved" }}>
        <MemoryRouter>
          <ResourceList />
        </MemoryRouter>
      </PermissionContext.Provider>,
    );

    expect(screen.queryByTestId("resource-team-link")).not.toBeInTheDocument();
    expect(screen.queryByText(/manage team links/i)).not.toBeInTheDocument();
  });

  it("sorts each visible section by displayed name without changing stored resource order", async () => {
    await setExternalEnabled({ on: true });
    await useStore.getState().addResource(personDraft("Zulu"));
    await useStore.getState().addResource(personDraft("alpha"));
    await useStore.getState().addResource(personDraft("Bravo"));
    await useStore
      .getState()
      .addResource({ ...personDraft("Zeta Partners"), kind: "external", role: "Partner studio" });
    await useStore.getState().addResource({ ...personDraft("Ferris Print"), kind: "external", role: "Print partner" });
    const storedIds = useStore.getState().data.resources.map((resource) => resource.id);

    render(<ResourceList />);

    expect(screen.getAllByTestId("resource-row").map((row) => row.querySelector(".font-medium")?.textContent)).toEqual([
      "alpha",
      "Bravo",
      "Zulu",
    ]);
    expect(screen.getAllByTestId("external-row").map((row) => row.querySelector(".font-medium")?.textContent)).toEqual([
      "Ferris Print",
      "Zeta Partners",
    ]);
    expect(useStore.getState().data.resources.map((resource) => resource.id)).toEqual(storedIds);
  });

  it("puts favourites first within People and External and toggles them accessibly", async () => {
    const user = userEvent.setup();
    await setExternalEnabled({ on: true });
    await useStore.getState().addResource(personDraft("Alpha"));
    await useStore.getState().addResource({ ...personDraft("Zulu"), isFavourite: true });
    await useStore.getState().addResource({ ...personDraft("Ferris"), kind: "external", role: "Print partner" });
    await useStore
      .getState()
      .addResource({ ...personDraft("Zeta"), kind: "external", role: "Partner studio", isFavourite: true });

    render(<ResourceList />);

    expect(screen.getAllByTestId("resource-row").map((row) => row.querySelector(".font-medium")?.textContent)).toEqual([
      "Zulu",
      "Alpha",
    ]);
    expect(screen.getAllByTestId("external-row").map((row) => row.querySelector(".font-medium")?.textContent)).toEqual([
      "Zeta",
      "Ferris",
    ]);

    const favouriteAlpha = screen.getByRole("button", { name: "Add Alpha to favourites" });
    expect(favouriteAlpha).toHaveAttribute("aria-pressed", "false");
    await user.click(favouriteAlpha);

    expect(screen.getByRole("button", { name: "Remove Alpha from favourites" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getAllByTestId("resource-row").map((row) => row.querySelector(".font-medium")?.textContent)).toEqual([
      "Alpha",
      "Zulu",
    ]);
  });
});

describe("ResourceList display", () => {
  it("separates Studio and Supplementary once a Supplementary person exists, with favourites first inside each", async () => {
    await useStore.getState().addResource(personDraft("Studio Zulu"));
    await useStore.getState().addResource({ ...personDraft("Studio Alpha"), isFavourite: true });
    await useStore.getState().addResource({
      ...personDraft("Supplementary Alpha"),
      engagement: "supplementary",
    });
    await useStore.getState().addResource({
      ...personDraft("Supplementary Zulu"),
      engagement: "supplementary",
      isFavourite: true,
    });

    render(<ResourceList />);

    const studio = screen.getByRole("heading", { name: "Studio" }).closest("section");
    if (!studio) throw new Error("Studio section missing");
    const supplementary = screen.getByRole("heading", { name: "Supplementary" }).closest("section");
    if (!supplementary) throw new Error("Supplementary section missing");
    expect(
      within(studio)
        .getAllByTestId("resource-row")
        .map((row) => row.textContent),
    ).toEqual([expect.stringContaining("Studio Alpha"), expect.stringContaining("Studio Zulu")]);
    expect(
      within(supplementary)
        .getAllByTestId("resource-row")
        .map((row) => row.textContent),
    ).toEqual([expect.stringContaining("Supplementary Zulu"), expect.stringContaining("Supplementary Alpha")]);
  });

  it("keeps a Studio-only company in one favourites-first list", async () => {
    await useStore.getState().addResource(personDraft("Studio Zulu"));
    await useStore.getState().addResource({ ...personDraft("Studio Alpha"), isFavourite: true });
    await useStore.getState().addResource(personDraft("Studio Bravo"));

    render(<ResourceList />);

    expect(screen.queryByRole("heading", { name: "Studio" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Supplementary" })).not.toBeInTheDocument();
    expect(screen.getAllByTestId("resource-row").map((row) => row.querySelector(".font-medium")?.textContent)).toEqual([
      "Studio Alpha",
      "Studio Bravo",
      "Studio Zulu",
    ]);
  });
});

describe("ResourceList display", () => {
  it("hides direct section create actions from viewers", async () => {
    await useStore.getState().addResource(personDraft("Alice"));
    render(
      <PermissionContext.Provider value={{ role: "viewer" }}>
        <ResourceList />
      </PermissionContext.Provider>,
    );

    expect(screen.queryByRole("button", { name: "Add resource" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add placeholder" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Alice to favourites" })).not.toBeInTheDocument();
  });

  it("shows an empty state when no resources exist", () => {
    render(<ResourceList />);
    expect(screen.getByText(/No resources yet/i)).toBeInTheDocument();
  });
});

describe("ResourceList display", () => {
  it("shows the name of a person resource", async () => {
    await useStore.getState().addResource(personDraft("Alice"));
    render(<ResourceList />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("omits both fixed hours text and dangling metadata separators", async () => {
    await useStore.getState().updateAccount(DEFAULT_ACCOUNT_ID, { disciplinesEnabled: false });
    await useStore.getState().addResource({ ...personDraft("Alice"), role: "" });
    render(<ResourceList />);

    const row = screen.getByTestId("resource-row");
    expect(row).not.toHaveTextContent(/\d+h\/day/);
    expect(row).not.toHaveTextContent("·");
  });

  it("omits missing and dangling disciplines without losing valid role or discipline metadata", async () => {
    const discipline = await requireCreated(
      useStore.getState().addDiscipline({ name: "Design", color: "#123456", sortOrder: 0 }),
    );
    await useStore.getState().addResource(personDraft("Role only"));
    await useStore.getState().addResource({ ...personDraft("Discipline only"), role: "", disciplineId: discipline.id });
    await useStore.getState().addResource({ ...personDraft("No metadata"), role: "" });
    const dangling = await requireCreated(
      useStore.getState().addResource({ ...personDraft("Dangling discipline"), role: "Researcher" }),
    );
    // Ordinary writes reject dangling references. Inject one at the view boundary to prove a
    // malformed/legacy slice still renders safely rather than exposing a placeholder glyph.
    useStore.setState((state) => ({
      data: {
        ...state.data,
        resources: state.data.resources.map((resource) =>
          resource.id === dangling.id ? { ...resource, disciplineId: "deleted-discipline" } : resource,
        ),
      },
    }));

    render(<ResourceList />);

    const rows = new Map(
      screen
        .getAllByTestId("resource-row")
        .map((row) => [
          row.querySelector(".font-medium")?.textContent,
          row.querySelector("span.text-sm.text-muted-foreground")?.textContent,
        ]),
    );
    expect(rows.get("Role only")).toBe(" · Developer");
    expect(rows.get("Discipline only")).toBe(" · Design");
    expect(rows.get("No metadata")).toBeUndefined();
    expect(rows.get("Dangling discipline")).toBe(" · Researcher");
    expect(screen.getAllByTestId("resource-row").every((row) => !row.textContent.includes("—"))).toBe(true);
  });
});

describe("ResourceList display", () => {
  it("gives repeated resource edit controls distinct contextual names", async () => {
    await useStore.getState().addResource(personDraft("Alice"));
    await useStore.getState().addResource(personDraft("Bob"));
    render(<ResourceList />);

    expect(screen.getByRole("button", { name: "Edit Alice" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Bob" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("gives repeated external-party edit controls distinct contextual names", async () => {
    await setExternalEnabled({ on: true });
    await useStore
      .getState()
      .addResource({ ...personDraft("Kord Industries"), kind: "external", role: "Partner studio" });
    await useStore.getState().addResource({ ...personDraft("Pixel Forge"), kind: "external", role: "Print partner" });
    render(<ResourceList />);

    expect(screen.getByRole("button", { name: "Edit Kord Industries" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Pixel Forge" })).toBeInTheDocument();
  });
});

describe("ResourceList display", () => {
  it("keeps the External explainer behind the section's labelled help action", async () => {
    const user = userEvent.setup();
    await setExternalEnabled({ on: true });
    await useStore
      .getState()
      .addResource({ ...personDraft("Kord Industries"), kind: "external", role: "Partner studio" });
    render(<ResourceList />);

    expect(screen.queryByText(/never count toward your team’s capacity or utilisation/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "About External" }));
    const dialog = screen.getByRole("dialog", { name: "External" });
    expect(within(dialog).getByText(/never count toward your team’s capacity or utilisation/i)).toBeInTheDocument();
  });

  it('does not show a "placeholder" tag or "Temp" tag for a permanent person', async () => {
    await useStore.getState().addResource(personDraft("Alice"));
    render(<ResourceList />);
    const rows = screen.getAllByTestId("resource-row");
    expect(rows).toHaveLength(1);
    const row = requireValue(rows[0], "resource row");
    expect(within(row).queryByText("placeholder")).not.toBeInTheDocument();
    expect(within(row).queryByText("Temp")).not.toBeInTheDocument();
  });
});

describe("ResourceList display", () => {
  it("renders a freelancer with no employment-type badge", async () => {
    await useStore.getState().addResource(freelancerDraft("Bob"));
    render(<ResourceList />);
    const rows = screen.getAllByTestId("resource-row");
    expect(rows).toHaveLength(1);
    const row = requireValue(rows[0], "resource row");
    expect(within(row).queryByText("Temp")).not.toBeInTheDocument();
    expect(within(row).queryByText("placeholder")).not.toBeInTheDocument();
  });

  it('shows a "placeholder" tag for a placeholder resource and its role as its label', async () => {
    const client = await requireCreated(useStore.getState().addClient({ name: "Ferris", color: "#111" }));
    const project = await requireCreated(
      useStore.getState().addProject({ name: "ProjectX", clientId: client.id, color: "#222" }),
    );
    await useStore.getState().addResource({
      kind: "placeholder",
      role: "Senior Designer",
      employmentType: "permanent" as const,
      engagement: "studio" as const,
      workingHoursPerDay: 8,
      workingDays: WORKDAYS,
      halfDays: [],
      color: "#a855f7",
      projectId: project.id,
    });
    render(<ResourceList />);
    const rows = screen.getAllByTestId("resource-row");
    expect(rows).toHaveLength(1);
    const row = requireValue(rows[0], "resource row");
    expect(within(row).getByText("placeholder")).toBeInTheDocument();

    expect(within(row).getByText("Placeholder")).toBeInTheDocument();
    expect(within(row).getByText(/Senior Designer/)).toBeInTheDocument();

    expect(within(row).queryByText("Temp")).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /favourites/i })).not.toBeInTheDocument();
  });
});

describe("ResourceList display", () => {
  it("does not show global first-resource onboarding when only a visible later section has rows", async () => {
    const client = await requireCreated(useStore.getState().addClient({ name: "Ferris", color: "#111" }));
    const project = await requireCreated(
      useStore.getState().addProject({ name: "ProjectX", clientId: client.id, color: "#222" }),
    );
    await useStore.getState().addResource({
      kind: "placeholder",
      role: "Senior Designer",
      employmentType: "permanent",
      engagement: "studio" as const,
      workingHoursPerDay: 8,
      workingDays: WORKDAYS,
      halfDays: [],
      color: "#a855f7",
      projectId: project.id,
    });

    render(<ResourceList />);

    expect(screen.getByText("Placeholder")).toBeInTheDocument();
    expect(screen.getByText(/No resources yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add your first resource" })).not.toBeInTheDocument();
    expect(screen.queryByText("Resources are the people you schedule work for.")).not.toBeInTheDocument();
  });

  it("hides the Placeholders section + its placeholders when the pref is OFF (default)", async () => {
    const client = await requireCreated(useStore.getState().addClient({ name: "Ferris", color: "#111" }));
    const project = await requireCreated(
      useStore.getState().addProject({ name: "ProjectX", clientId: client.id, color: "#222" }),
    );
    await useStore.getState().addResource(personDraft("Alice"));
    await useStore.getState().addResource({
      kind: "placeholder",
      role: "Senior Designer",
      employmentType: "permanent" as const,
      engagement: "studio" as const,
      workingHoursPerDay: 8,
      workingDays: WORKDAYS,
      halfDays: [],
      color: "#a855f7",
      projectId: project.id,
    });

    await setPlaceholdersEnabled({ on: false });
    render(<ResourceList />);

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.queryByText("Placeholders")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add placeholder/i })).not.toBeInTheDocument();
    expect(screen.queryByText("placeholder")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("resource-row")).toHaveLength(1);
  });
});

describe("ResourceList display", () => {
  it("renders all three resource types together", async () => {
    const client = await requireCreated(useStore.getState().addClient({ name: "Ferris", color: "#111" }));
    const project = await requireCreated(
      useStore.getState().addProject({ name: "ProjectX", clientId: client.id, color: "#222" }),
    );

    await useStore.getState().addResource(personDraft("Alice"));
    await useStore.getState().addResource(freelancerDraft("Bob"));
    await useStore.getState().addResource({
      kind: "placeholder",
      role: "Senior Designer",
      employmentType: "permanent" as const,
      engagement: "studio" as const,
      workingHoursPerDay: 8,
      workingDays: WORKDAYS,
      halfDays: [],
      color: "#a855f7",
      projectId: project.id,
    });

    render(<ResourceList />);

    const rows = screen.getAllByTestId("resource-row");
    expect(rows).toHaveLength(3);

    const aliceRow = requireValue(
      rows.find((r) => within(r).queryByText("Alice")),
      "Alice row",
    );
    expect(aliceRow).toBeDefined();
    expect(within(aliceRow).queryByText("placeholder")).not.toBeInTheDocument();
    expect(within(aliceRow).queryByText("Temp")).not.toBeInTheDocument();

    const bobRow = requireValue(
      rows.find((r) => within(r).queryByText("Bob")),
      "Bob row",
    );
    expect(bobRow).toBeDefined();
    expect(within(bobRow).queryByText("Temp")).not.toBeInTheDocument();
    expect(within(bobRow).queryByText("placeholder")).not.toBeInTheDocument();

    const slotRow = requireValue(
      rows.find((r) => within(r).queryByText(/Senior Designer/)),
      "placeholder row",
    );
    expect(slotRow).toBeDefined();
    expect(within(slotRow).getByText("placeholder")).toBeInTheDocument();
    expect(within(slotRow).getByText("Placeholder")).toBeInTheDocument();
    expect(within(slotRow).queryByText("Temp")).not.toBeInTheDocument();
  });
});

// Archive hides a resource from active views while retaining it for restoration. The demo fixture exercises local state without requests.
describe("ResourceList archive flow", () => {
  beforeEach(() => vi.stubEnv("VITE_CAPACITYLENS_DEMO", "1"));
  afterEach(() => vi.unstubAllEnvs());

  it("shows an Archive confirm dialog and cancelling keeps the resource visible", async () => {
    const user = userEvent.setup();
    await useStore.getState().addResource(personDraft("Alice"));
    render(<ResourceList />);

    expect(screen.getByText("Alice")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Archive Alice" }));

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent(/Archive resource\?/i);
    expect(dialog).toHaveTextContent(/Alice/i);

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(useStore.getState().data.resources).toHaveLength(1);
    expect(requireValue(useStore.getState().data.resources[0], "active resource")).toHaveProperty("archivedAt", null);
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("archives a resource after confirming and shows it below the active sections", async () => {
    const user = userEvent.setup();
    await useStore.getState().addResource(personDraft("Alice"));
    render(<ResourceList />);

    await user.click(screen.getByRole("button", { name: "Archive Alice" }));
    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Archive" }));

    expect(useStore.getState().data.resources).toHaveLength(1);
    expect(useStore.getState().data.resources[0]?.archivedAt).toBeTruthy();
    expect(screen.queryByTestId("resource-row")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("archived-resources-section")).getByText("Alice")).toBeInTheDocument();
  });
});

describe("ResourceList archived grouping", () => {
  beforeEach(() => vi.stubEnv("VITE_CAPACITYLENS_DEMO", "1"));
  afterEach(() => vi.unstubAllEnvs());

  it("groups archived resources by kind and engagement, hides empty groups, and preserves placeholders", async () => {
    const studio = await requireCreated(useStore.getState().addResource(personDraft("Bruce Wayne")));
    const supplementary = await requireCreated(
      useStore.getState().addResource({ ...personDraft("Barry Allen"), engagement: "supplementary" }),
    );
    const external = await requireCreated(
      useStore.getState().addResource({ ...personDraft("Kord Industries"), kind: "external", engagement: "studio" }),
    );
    const placeholder = await requireCreated(
      useStore.getState().addResource({
        kind: "placeholder",
        role: "Senior Designer",
        employmentType: "permanent" as const,
        engagement: "studio" as const,
        workingHoursPerDay: 8,
        workingDays: WORKDAYS,
        halfDays: [],
        color: "#a855f7",
      }),
    );
    for (const id of [studio.id, supplementary.id, external.id, placeholder.id]) {
      await useStore.getState().archiveEntity("resources", id);
    }

    render(<ResourceList />);

    const archived = screen.getByTestId("archived-resources-section");
    const headings = within(archived)
      .getAllByRole("heading")
      .map((heading) => heading.textContent);
    expect(headings).toEqual([
      "Archived Studio (1)",
      "Archived Supplementary (1)",
      "Archived External (1)",
      "Archived placeholders (1)",
    ]);
    expect(within(screen.getByTestId("archived-resources-studio-group")).getByText("Bruce Wayne")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("archived-resources-supplementary-group")).getByText("Barry Allen"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("archived-resources-external-group")).getByText("Kord Industries"),
    ).toBeInTheDocument();
    const placeholders = screen.getByTestId("archived-resources-placeholders-group");
    expect(within(placeholders).getByTestId("archived-row").querySelector(".font-medium")).toHaveTextContent(
      "Senior Designer",
    );
  });

  it("omits empty archived resource groups", async () => {
    const studio = await requireCreated(useStore.getState().addResource(personDraft("Bruce Wayne")));
    await useStore.getState().archiveEntity("resources", studio.id);

    render(<ResourceList />);

    const archived = screen.getByTestId("archived-resources-section");
    expect(within(archived).getByRole("heading", { name: "Archived Studio (1)" })).toBeInTheDocument();
    expect(within(archived).queryByRole("heading", { name: "Archived Supplementary (0)" })).not.toBeInTheDocument();
    expect(within(archived).queryByRole("heading", { name: "Archived External (0)" })).not.toBeInTheDocument();
    expect(within(archived).queryByRole("heading", { name: "Archived placeholders (0)" })).not.toBeInTheDocument();
  });
});

describe("ResourceList archive flow", () => {
  beforeEach(() => vi.stubEnv("VITE_CAPACITYLENS_DEMO", "1"));
  afterEach(() => vi.unstubAllEnvs());

  it("archives the correct resource when multiple exist", async () => {
    const user = userEvent.setup();
    await useStore.getState().addResource(personDraft("Alice"));
    await useStore.getState().addResource(personDraft("Bob"));
    render(<ResourceList />);

    const rows = screen.getAllByTestId("resource-row");
    const bobRow = requireValue(
      rows.find((r) => within(r).queryByText("Bob")),
      "Bob row",
    );
    await user.click(within(bobRow).getByRole("button", { name: "Archive Bob" }));

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent(/Bob/i);
    await user.click(within(dialog).getByRole("button", { name: "Archive" }));

    const bob = requireValue(
      useStore.getState().data.resources.find((r) => r.name === "Bob"),
      "Bob resource",
    );
    expect(bob.archivedAt).toBeTruthy();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getAllByTestId("resource-row")).toHaveLength(1);
    expect(within(screen.getByTestId("archived-resources-section")).getByText("Bob")).toBeInTheDocument();
  });
});

describe("ResourceList archive flow", () => {
  beforeEach(() => vi.stubEnv("VITE_CAPACITYLENS_DEMO", "1"));
  afterEach(() => vi.unstubAllEnvs());

  it("archives a freelancer resource", async () => {
    const user = userEvent.setup();
    await useStore.getState().addResource(freelancerDraft("Bob"));
    render(<ResourceList />);

    expect(screen.getByText("Bob")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Archive Bob" }));
    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Archive" }));

    expect(useStore.getState().data.resources[0]?.archivedAt).toBeTruthy();
    expect(screen.queryByTestId("resource-row")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("archived-resources-section")).getByText("Bob")).toBeInTheDocument();
  });

  it("archives a placeholder resource", async () => {
    const user = userEvent.setup();
    const client = await requireCreated(useStore.getState().addClient({ name: "Ferris", color: "#111" }));
    const project = await requireCreated(
      useStore.getState().addProject({ name: "ProjectX", clientId: client.id, color: "#222" }),
    );
    await useStore.getState().addResource({
      kind: "placeholder",
      role: "Senior Designer",
      employmentType: "permanent" as const,
      engagement: "studio" as const,
      workingHoursPerDay: 8,
      workingDays: WORKDAYS,
      halfDays: [],
      color: "#a855f7",
      projectId: project.id,
    });
    render(<ResourceList />);

    // Match the secondary role label separately from the fixed Placeholder display name.
    expect(screen.getByText("Placeholder")).toBeInTheDocument();
    expect(screen.getByText(/Senior Designer/)).toBeInTheDocument();
    expect(screen.getByText("placeholder")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Archive Placeholder" }));
    const dialog = screen.getByRole("alertdialog");
    // The confirmation uses the same Placeholder display identity as the row so the target remains recognizable.
    expect(dialog).toHaveTextContent(/Archive "Placeholder"/i);
    await user.click(within(dialog).getByRole("button", { name: "Archive" }));

    expect(useStore.getState().data.resources[0]?.archivedAt).toBeTruthy();
    const archived = screen.getByTestId("archived-resources-section");
    expect(within(archived).getByTestId("archived-row").querySelector(".font-medium")).toHaveTextContent(
      "Senior Designer",
    );
    expect(screen.queryByText("placeholder")).not.toBeInTheDocument();
  });
});
