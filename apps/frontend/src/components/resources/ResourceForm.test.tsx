import { requireCreated } from "@/test/requireCreated";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResourceForm } from "./ResourceForm";
import { useStore } from "@/store/useStore";
import { requireValue, resetStoreWithAccount } from "@/test/fixtures";
import { PlanningControllerError } from "@/data/planning/planningCacheController";

const addResource = useStore.getState().addResource;
const updateResource = useStore.getState().updateResource;

beforeEach(() => resetStoreWithAccount());

afterEach(async () => {
  useStore.setState({ addResource, updateResource });
  cleanup();
  // Radix dispatches its unmount autofocus event on the next timer turn, while this jsdom realm is still alive.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
});

describe("ResourceForm layout", () => {
  it("uses compact label-control rows while leaving working days full width", async () => {
    await useStore.getState().addDiscipline({ name: "Design", color: "#737373", sortOrder: 0 });
    render(<ResourceForm kind="person" onClose={vi.fn()} />);

    for (const label of ["Name", "Role", "Discipline", "Engagement"]) {
      expect(screen.getByLabelText(label).closest('[data-slot="field"]')).toHaveAttribute(
        "data-product-layout",
        "label-control",
      );
    }
    expect(screen.getByRole("group", { name: "Working days" })).not.toHaveAttribute("data-product-layout");
  });

  it("uses the compact row for a placeholder's bound project", () => {
    render(<ResourceForm kind="placeholder" onClose={vi.fn()} />);

    expect(screen.getByLabelText("Bound project").closest('[data-slot="field"]')).toHaveAttribute(
      "data-product-layout",
      "label-control",
    );
  });

  it("shows simple availability dates with separators for people only", () => {
    const person = render(<ResourceForm kind="person" onClose={vi.fn()} />);

    expect(screen.queryByLabelText("Avatar URL")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Start date")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("End date")).toHaveAttribute("type", "date");
    const startField = screen.getByLabelText("Start date").closest('[data-slot="field"]');
    const endField = screen.getByLabelText("End date").closest('[data-slot="field"]');
    expect(startField).not.toHaveAttribute("data-product-layout");
    expect(endField).not.toHaveAttribute("data-product-layout");
    expect(startField?.parentElement).toBe(endField?.parentElement);
    expect(startField?.parentElement).toHaveAttribute("data-resource-availability-date-row");
    expect(startField?.parentElement).toHaveClass("grid", "min-w-0", "grid-cols-1", "gap-2", "sm:grid-cols-2");
    expect(screen.queryByText(/leave blank for no boundary/i)).not.toBeInTheDocument();
    const separators = document.body.querySelectorAll('[data-slot="separator"]');
    expect(separators).toHaveLength(2);
    for (const separator of separators) expect(separator).toHaveClass("my-4");

    person.unmount();
    const placeholder = render(<ResourceForm kind="placeholder" onClose={vi.fn()} />);
    expect(screen.queryByLabelText("Start date")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("End date")).not.toBeInTheDocument();

    placeholder.unmount();
    render(<ResourceForm kind="external" onClose={vi.fn()} />);
    expect(screen.queryByLabelText("Start date")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("End date")).not.toBeInTheDocument();
  });
});

describe("ResourceForm availability dates", () => {
  it("preserves an existing avatar URL when a manager edits resource metadata", async () => {
    const user = userEvent.setup();
    const resource = await requireCreated(
      useStore.getState().addResource({
        kind: "person",
        name: "Barbara Gordon",
        role: "Designer",
        avatarUrl: "https://images.example/barbara.png",
        employmentType: "permanent",
        engagement: "studio",
        workingHoursPerDay: 8,
        workingDays: [1, 2, 3, 4, 5],
        halfDays: [],
        color: "#737373",
      }),
    );
    render(<ResourceForm resource={resource} onClose={vi.fn()} />);

    expect(screen.queryByLabelText("Avatar URL")).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText("Role"));
    await user.type(screen.getByLabelText("Role"), "Design lead");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(useStore.getState().data.resources[0]).toMatchObject({
      role: "Design lead",
      avatarUrl: "https://images.example/barbara.png",
    });
  });

  it("saves equal inclusive boundaries", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ResourceForm kind="person" onClose={onClose} />);

    await user.type(screen.getByLabelText("Name"), "Barbara Gordon");
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-09-10" } });
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-09-10" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(useStore.getState().data.resources[0]).toMatchObject({
      firstAvailableDate: "2026-09-10",
      lastAvailableDate: "2026-09-10",
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("clears one existing boundary while preserving the other and metadata", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const resource = await requireCreated(
      useStore.getState().addResource({
        kind: "person",
        name: "Dinah Lance",
        role: "Designer",
        employmentType: "permanent",
        engagement: "studio",
        workingHoursPerDay: 8,
        workingDays: [1, 2, 3, 4, 5],
        halfDays: [],
        color: "#737373",
        firstAvailableDate: "2026-09-01",
        lastAvailableDate: "2026-09-30",
      }),
    );
    render(<ResourceForm resource={resource} onClose={onClose} />);

    await user.clear(screen.getByLabelText("Start date"));
    await user.clear(screen.getByLabelText("Role"));
    await user.type(screen.getByLabelText("Role"), "Design lead");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const updated = requireValue(useStore.getState().data.resources[0], "updated resource");
    expect(updated).toHaveProperty("firstAvailableDate", null);
    expect(updated).toMatchObject({ lastAvailableDate: "2026-09-30", role: "Design lead" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("rejects a reversed availability range accessibly", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ResourceForm kind="person" onClose={onClose} />);

    await user.type(screen.getByLabelText("Name"), "Barbara Gordon");
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-09-11" } });
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-09-10" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/end date.*start date/i);
    expect(screen.getByLabelText("End date")).toHaveAttribute("aria-invalid", "true");
    expect(onClose).not.toHaveBeenCalled();
    expect(useStore.getState().data.resources).toHaveLength(0);
  });
});

describe("ResourceForm disciplines", () => {
  it("hides Discipline for people and placeholders when there are no scoped disciplines", () => {
    const person = render(<ResourceForm kind="person" onClose={vi.fn()} />);
    expect(screen.queryByLabelText("Discipline")).not.toBeInTheDocument();

    person.unmount();
    render(<ResourceForm kind="placeholder" onClose={vi.fn()} />);
    expect(screen.queryByLabelText("Discipline")).not.toBeInTheDocument();
  });

  it("shows Discipline for people and placeholders when enabled with a scoped discipline", async () => {
    await useStore.getState().addDiscipline({ name: "Design", color: "#737373", sortOrder: 0 });

    const person = render(<ResourceForm kind="person" onClose={vi.fn()} />);
    expect(screen.getByLabelText("Discipline")).toBeVisible();

    person.unmount();
    render(<ResourceForm kind="placeholder" onClose={vi.fn()} />);
    expect(screen.getByLabelText("Discipline")).toBeVisible();
  });

  it("preserves an existing discipline when the disabled control is hidden", async () => {
    const user = userEvent.setup();
    const discipline = await requireCreated(
      useStore.getState().addDiscipline({ name: "Design", color: "#737373", sortOrder: 0 }),
    );
    const resource = await requireCreated(
      useStore.getState().addResource({
        kind: "person",
        name: "Barbara Gordon",
        role: "Designer",
        disciplineId: discipline.id,
        employmentType: "permanent",
        engagement: "studio",
        workingHoursPerDay: 8,
        workingDays: [1, 2, 3, 4, 5],
        halfDays: [],
        color: "#737373",
      }),
    );
    await useStore
      .getState()
      .updateAccount(requireValue(useStore.getState().data.accounts[0], "account").id, { disciplinesEnabled: false });
    render(<ResourceForm resource={resource} onClose={vi.fn()} />);

    expect(screen.queryByLabelText("Discipline")).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText("Role"));
    await user.type(screen.getByLabelText("Role"), "Design lead");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(useStore.getState().data.resources[0]).toMatchObject({
      role: "Design lead",
      disciplineId: discipline.id,
    });
  });
});

it("rejects a stale person edit instead of overwriting a concurrent change", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  const resource = await requireCreated(
    useStore.getState().addResource({
      kind: "person",
      name: "Alice",
      role: "Designer",
      employmentType: "permanent",
      engagement: "studio" as const,
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      color: "#737373",
    }),
  );
  render(<ResourceForm resource={resource} onClose={onClose} />);

  await useStore.getState().updateResource(resource.id, { role: "Design lead" });
  await user.clear(screen.getByLabelText("Name"));
  await user.type(screen.getByLabelText("Name"), "Alice renamed");
  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(screen.getByRole("alert")).toHaveTextContent(/resource changed while you were editing/i);
  expect(onClose).not.toHaveBeenCalled();
  expect(useStore.getState().data.resources[0]).toMatchObject({ name: "Alice", role: "Design lead" });
});

it("keeps the dialog open and shows the persistence error when the server rejects a new person", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  vi.spyOn(useStore.getState(), "addResource").mockRejectedValue(
    new Error("Resource could not be saved by the server."),
  );
  try {
    render(<ResourceForm kind="person" onClose={onClose} />);
    await user.type(screen.getByLabelText("Name"), "Bruce Wayne");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Resource could not be saved by the server.");
    expect(onClose).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
  }
});

it("shows a planning conflict when the typed write is refused", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  vi.spyOn(useStore.getState(), "addResource").mockRejectedValue(
    new PlanningControllerError("Row is stale.", "revision_conflict", 409),
  );
  try {
    render(<ResourceForm kind="person" onClose={onClose} />);
    await user.type(screen.getByLabelText("Name"), "Bruce Wayne");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Row is stale.");
    expect(onClose).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
  }
});

it("keeps the server's own reason when a save is rejected as invalid", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  vi.spyOn(useStore.getState(), "addResource").mockRejectedValue(
    new PlanningControllerError("That discipline no longer exists.", "validation_error", 400),
  );
  try {
    render(<ResourceForm kind="person" onClose={onClose} />);
    await user.type(screen.getByLabelText("Name"), "Bruce Wayne");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert")).toHaveTextContent("That discipline no longer exists.");
    expect(onClose).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
  }
});

it("retries a transient rejected save without adding a duplicate person", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  vi.spyOn(useStore.getState(), "addResource")
    .mockRejectedValueOnce(new Error("Temporary server failure."))
    .mockRejectedValueOnce(new Error("Temporary server failure again."))
    .mockImplementation(addResource);
  try {
    render(<ResourceForm kind="person" onClose={onClose} />);
    await user.type(screen.getByLabelText("Name"), "Bruce Wayne");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Temporary server failure.");
    expect(useStore.getState().data.resources).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Temporary server failure again.");
    expect(useStore.getState().data.resources).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(useStore.getState().data.resources).toHaveLength(1);
  } finally {
    vi.restoreAllMocks();
  }
});

it("retries an existing edit from its latest optimistic snapshot", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  const resource = await requireCreated(
    useStore.getState().addResource({
      kind: "person",
      name: "Bruce Wayne",
      role: "Designer",
      employmentType: "permanent",
      engagement: "studio",
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      color: "#737373",
    }),
  );
  vi.spyOn(useStore.getState(), "updateResource")
    .mockRejectedValueOnce(new Error("Temporary server failure."))
    .mockRejectedValueOnce(new Error("Temporary server failure again."))
    .mockImplementation(updateResource);
  try {
    render(<ResourceForm resource={resource} onClose={onClose} />);
    await user.clear(screen.getByLabelText("Role"));
    await user.type(screen.getByLabelText("Role"), "Lead designer");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Temporary server failure.");

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Temporary server failure again.");

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(useStore.getState().data.resources[0]).toMatchObject({ name: "Bruce Wayne", role: "Lead designer" });
  } finally {
    vi.restoreAllMocks();
  }
});

it("closes after a successful save under StrictMode", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(
    <StrictMode>
      <ResourceForm kind="person" onClose={onClose} />
    </StrictMode>,
  );
  await user.type(screen.getByLabelText("Name"), "Bruce Wayne");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
});

it("ignores a second submit while the first typed write is pending", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  let releaseWrite!: () => void;
  const pending = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  vi.spyOn(useStore.getState(), "addResource").mockImplementation(async (input) => {
    const saved = await addResource(input);
    await pending;
    return saved;
  });
  try {
    render(<ResourceForm kind="person" onClose={onClose} />);
    await user.type(screen.getByLabelText("Name"), "Bruce Wayne");
    const save = screen.getByRole("button", { name: "Save" });
    await user.click(save);
    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.getByLabelText("Role")).toBeDisabled();
    for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled();
    await user.click(save);
    expect(useStore.getState().data.resources).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();

    releaseWrite();
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  } finally {
    vi.restoreAllMocks();
  }
});

it("does not let a late typed write response close a form after its company changed", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  let releaseWrite!: () => void;
  const pending = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  vi.spyOn(useStore.getState(), "addResource").mockImplementation(async (input) => {
    const saved = await addResource(input);
    await pending;
    return saved;
  });
  try {
    render(<ResourceForm kind="person" onClose={onClose} />);
    await user.type(screen.getByLabelText("Name"), "Bruce Wayne");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const other = useStore.getState().addAccount({ name: "Stark Industries", color: "#111111" });
    if (!other) throw new Error("Expected second account");
    useStore.getState().setActiveAccount(other.id);

    releaseWrite();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onClose).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
  }
});

it("does not surface a late typed write rejection after its company changed", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  let releaseWrite!: () => void;
  const pending = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  vi.spyOn(useStore.getState(), "addResource").mockImplementation(async (input) => {
    await addResource(input);
    await pending;
    throw new Error("stale save failure");
  });
  try {
    render(<ResourceForm kind="person" onClose={onClose} />);
    await user.type(screen.getByLabelText("Name"), "Bruce Wayne");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const other = useStore.getState().addAccount({ name: "Stark Industries", color: "#111111" });
    if (!other) throw new Error("Expected second account");
    useStore.getState().setActiveAccount(other.id);

    releaseWrite();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  } finally {
    vi.restoreAllMocks();
  }
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
  await useStore
    .getState()
    .updateAccount(requireValue(useStore.getState().data.accounts[0], "account").id, { workingDays: [1, 3, 5] });
  const client = await requireCreated(useStore.getState().addClient({ name: "Ferris", color: "#111" }));
  const project = await requireCreated(
    useStore.getState().addProject({ name: "Lightning", clientId: client.id, color: "#222" }),
  );
  render(<ResourceForm kind="placeholder" onClose={onClose} />);

  await user.type(screen.getByLabelText("Role"), "Senior Designer");
  fireEvent.keyDown(screen.getByLabelText("Bound project"), { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("option", { name: "Ferris / Lightning" }));
  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(onClose).toHaveBeenCalled();
  const resources = useStore.getState().data.resources;
  expect(resources).toHaveLength(1);
  expect(resources[0]?.kind).toBe("placeholder");
  expect(resources[0]?.projectId).toBe(project.id);
  expect(resources[0]?.engagement).toBe("studio");
  expect(resources[0]?.workingDays).toEqual([1, 2, 3, 4, 5]);
  expect(resources[0]?.halfDays).toEqual([]);
});

// An existing archived project must remain a disabled selected option so unrelated placeholder edits preserve the unchanged projectId.
it("edits a placeholder bound to an archived project without forcing a reassignment", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  const client = await requireCreated(useStore.getState().addClient({ name: "Ferris", color: "#111" }));
  const project = await requireCreated(
    useStore.getState().addProject({ name: "Lightning", clientId: client.id, color: "#222" }),
  );
  const placeholder = await requireCreated(
    useStore.getState().addResource({
      kind: "placeholder",
      role: "Designer",
      employmentType: "permanent",
      engagement: "studio" as const,
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      projectId: project.id,
      color: "#333",
    }),
  );
  useStore.getState().archiveEntity("projects", project.id);
  render(<ResourceForm resource={placeholder} onClose={onClose} />);

  const select = screen.getByLabelText("Bound project");
  expect(select).toHaveTextContent("Ferris / Lightning (archived)");
  fireEvent.keyDown(select, { key: "ArrowDown" });
  expect(screen.getByRole("option", { name: "Ferris / Lightning (archived)" })).toHaveAttribute("data-disabled");
  fireEvent.keyDown(document, { key: "Escape" });

  await user.clear(screen.getByLabelText("Role"));
  await user.type(screen.getByLabelText("Role"), "Senior Designer");
  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(onClose).toHaveBeenCalled();
  const saved = useStore.getState().data.resources[0];
  if (!saved) throw new Error("Expected saved resource");
  expect(saved.role).toBe("Senior Designer");
  expect(saved.projectId).toBe(project.id);
});

describe("ResourceForm engagement", () => {
  it("defaults new people to Studio and saves Supplementary without showing Employment", async () => {
    const user = userEvent.setup();
    render(<ResourceForm kind="person" onClose={vi.fn()} />);

    expect(screen.queryByLabelText("Employment")).not.toBeInTheDocument();
    const engagement = screen.getByRole("radiogroup", { name: "Engagement" });
    expect(engagement).toHaveTextContent("Studio");
    expect(screen.queryByRole("combobox", { name: "Engagement" })).not.toBeInTheDocument();
    expect(within(engagement).getByRole("radio", { name: "Supplementary" })).toBeVisible();

    await user.type(screen.getByLabelText("Name"), "Selina Kyle");
    await user.click(within(engagement).getByRole("radio", { name: "Supplementary" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(useStore.getState().data.resources[0]).toMatchObject({
      employmentType: "permanent",
      engagement: "supplementary",
    });
  });

  it("preserves hidden employment data when engagement is edited", async () => {
    const user = userEvent.setup();
    const resource = await requireCreated(
      useStore.getState().addResource({
        kind: "person",
        name: "Barry Allen",
        role: "Developer",
        employmentType: "freelancer",
        engagement: "studio",
        workingHoursPerDay: 8,
        workingDays: [1, 2, 3, 4, 5],
        halfDays: [],
        color: "#737373",
      }),
    );
    render(<ResourceForm resource={resource} onClose={vi.fn()} />);

    const engagement = screen.getByRole("radiogroup", { name: "Engagement" });
    await user.click(within(engagement).getByRole("radio", { name: "Supplementary" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(useStore.getState().data.resources[0]).toMatchObject({
      employmentType: "freelancer",
      engagement: "supplementary",
    });
  });
});

it("does not show working days for placeholders", () => {
  render(<ResourceForm kind="placeholder" onClose={vi.fn()} />);

  expect(screen.queryByRole("group", { name: "Working days" })).not.toBeInTheDocument();
});

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
  const resource = await requireCreated(
    useStore.getState().addResource({
      kind: "person",
      name: "Alice",
      role: "Designer",
      employmentType: "permanent",
      engagement: "studio" as const,
      workingHoursPerDay: 6,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      color: "#737373",
    }),
  );
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
