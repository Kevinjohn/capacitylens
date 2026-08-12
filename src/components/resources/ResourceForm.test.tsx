import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResourceForm } from "./ResourceForm";
import { useStore } from "../../store/useStore";
import { resetStoreWithAccount } from "../../test/fixtures";

beforeEach(() => resetStoreWithAccount());

describe("ResourceForm placeholder binding", () => {
  it("rejects a stale person edit instead of overwriting a concurrent change", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const resource = useStore.getState().addResource({
      kind: "person",
      name: "Alice",
      role: "Designer",
      employmentType: "permanent",
      engagement: "studio" as const,
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      color: "#737373",
    });
    render(<ResourceForm resource={resource} onClose={onClose} />);

    useStore.getState().updateResource(resource.id, { role: "Design lead" });
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Alice renamed");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/resource changed while you were editing/i);
    expect(onClose).not.toHaveBeenCalled();
    expect(useStore.getState().data.resources[0]).toMatchObject({ name: "Alice", role: "Design lead" });
  });

  it("requires a placeholder to be bound to a project", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ResourceForm kind="placeholder" onClose={onClose} />);

    expect(screen.queryByLabelText("Employment")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Engagement")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Role"), "Senior Designer");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/bound to a project/i);
    expect(onClose).not.toHaveBeenCalled();
    expect(useStore.getState().data.resources).toHaveLength(0);
  });

  it("saves a placeholder once a bound project is chosen", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const client = useStore.getState().addClient({ name: "Acme", color: "#111" });
    const project = useStore.getState().addProject({ name: "Lightning", clientId: client.id, color: "#222" });
    render(<ResourceForm kind="placeholder" onClose={onClose} />);

    await user.type(screen.getByLabelText("Role"), "Senior Designer");
    fireEvent.keyDown(screen.getByLabelText("Bound project"), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: "Acme / Lightning" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onClose).toHaveBeenCalled();
    const resources = useStore.getState().data.resources;
    expect(resources).toHaveLength(1);
    expect(resources[0].kind).toBe("placeholder");
    expect(resources[0].projectId).toBe(project.id);
    expect(resources[0].engagement).toBe("studio");
  });

  // Editing a placeholder whose bound project is ARCHIVED (hidden from the active-only picker): the
  // current project must appear as a disabled-but-selected option so an unrelated edit (role) can
  // save the unchanged projectId instead of silently blanking the select and sending a changed
  // projectId. Mirrors ProjectForm's archived-client round-trip.
  it("edits a placeholder bound to an archived project without forcing a reassignment", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const client = useStore.getState().addClient({ name: "Acme", color: "#111" });
    const project = useStore.getState().addProject({ name: "Lightning", clientId: client.id, color: "#222" });
    const placeholder = useStore.getState().addResource({
      kind: "placeholder",
      role: "Designer",
      employmentType: "permanent",
      engagement: "studio" as const,
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      projectId: project.id,
      color: "#333",
    });
    useStore.getState().archiveEntity("projects", project.id);
    render(<ResourceForm resource={placeholder} onClose={onClose} />);

    // The archived project renders as a disabled option, still selected as the current value.
    const select = screen.getByLabelText("Bound project");
    expect(select).toHaveTextContent("Acme / Lightning (archived)");
    fireEvent.keyDown(select, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "Acme / Lightning (archived)" })).toHaveAttribute("data-disabled");
    fireEvent.keyDown(document, { key: "Escape" });

    await user.clear(screen.getByLabelText("Role"));
    await user.type(screen.getByLabelText("Role"), "Senior Designer");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onClose).toHaveBeenCalled();
    const saved = useStore.getState().data.resources[0];
    expect(saved.role).toBe("Senior Designer");
    expect(saved.projectId).toBe(project.id); // unchanged, round-tripped
  });
});

describe("ResourceForm engagement", () => {
  it("defaults new people to Studio and saves Supplementary without showing Employment", async () => {
    const user = userEvent.setup();
    render(<ResourceForm kind="person" onClose={vi.fn()} />);

    expect(screen.queryByLabelText("Employment")).not.toBeInTheDocument();
    const engagement = screen.getByLabelText("Engagement");
    expect(engagement).toHaveTextContent("Studio");

    await user.type(screen.getByLabelText("Name"), "Selina Kyle");
    fireEvent.keyDown(engagement, { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: "Supplementary" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(useStore.getState().data.resources[0]).toMatchObject({
      employmentType: "permanent",
      engagement: "supplementary",
    });
  });

  it("preserves hidden employment data when engagement is edited", async () => {
    const user = userEvent.setup();
    const resource = useStore.getState().addResource({
      kind: "person",
      name: "Barry Allen",
      role: "Developer",
      employmentType: "freelancer",
      engagement: "studio",
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      color: "#737373",
    });
    render(<ResourceForm resource={resource} onClose={vi.fn()} />);

    const engagement = screen.getByLabelText("Engagement");
    fireEvent.keyDown(engagement, { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: "Supplementary" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(useStore.getState().data.resources[0]).toMatchObject({
      employmentType: "freelancer",
      engagement: "supplementary",
    });
  });
});

describe("ResourceForm working days", () => {
  it("opens legacy working days as full days and unselected weekdays as not working", () => {
    render(<ResourceForm kind="person" onClose={vi.fn()} />);

    expect(
      within(screen.getByRole("row", { name: /Monday/ })).getByRole("radio", { name: "Monday Full day" }),
    ).toBeChecked();
    expect(
      within(screen.getByRole("row", { name: /Saturday/ })).getByRole("radio", { name: "Saturday Not working" }),
    ).toBeChecked();
  });

  it("persists a mutually exclusive mixed full, half and non-working pattern", async () => {
    const user = userEvent.setup();
    render(<ResourceForm kind="person" onClose={vi.fn()} />);

    await user.type(screen.getByLabelText("Name"), "Barbara Gordon");
    await user.click(
      within(screen.getByRole("row", { name: /Tuesday/ })).getByRole("radio", { name: "Tuesday Half day" }),
    );
    await user.click(
      within(screen.getByRole("row", { name: /Friday/ })).getByRole("radio", { name: "Friday Not working" }),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(useStore.getState().data.resources[0]).toMatchObject({
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4],
      halfDays: [2],
    });
  });

  it("hides working hours and normalises a legacy custom value to eight on edit", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const resource = useStore.getState().addResource({
      kind: "person",
      name: "Alice",
      role: "Designer",
      employmentType: "permanent",
      engagement: "studio" as const,
      workingHoursPerDay: 6,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      color: "#737373",
    });
    render(<ResourceForm resource={resource} onClose={onClose} />);

    expect(screen.queryByLabelText("Working hours / day")).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText("Role"));
    await user.type(screen.getByLabelText("Role"), "Design lead");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onClose).toHaveBeenCalled();
    expect(useStore.getState().data.resources[0]).toMatchObject({
      role: "Design lead",
      workingHoursPerDay: 8,
    });
  });

  it("blocks saving a resource with no working days selected", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ResourceForm kind="person" onClose={onClose} />);

    await user.type(screen.getByLabelText("Name"), "Alice");
    // Mark the default full Monday–Friday set as non-working.
    for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]) {
      await user.click(
        within(screen.getByRole("row", { name: new RegExp(day) })).getByRole("radio", {
          name: `${day} Not working`,
        }),
      );
    }
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/at least one working day/i);
    expect(onClose).not.toHaveBeenCalled();
    expect(useStore.getState().data.resources).toHaveLength(0);
  });
});
