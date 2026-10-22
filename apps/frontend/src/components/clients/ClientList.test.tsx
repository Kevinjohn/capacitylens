import { requireCreated } from "@/test/requireCreated";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClientList } from "./ClientList";
import { useStore } from "@/store/useStore";
import { resetStoreWithAccount, requireValue } from "@/test/fixtures";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import { internalClientFor } from "@capacitylens/shared/data/internalClient";
import { PermissionContext } from "@/auth/permissionContext";

beforeEach(async () => {
  await resetStoreWithAccount();
});

describe("ClientList empty state", () => {
  it("shows the enriched empty state with a CTA distinct from the top Add button", () => {
    render(<ClientList />);
    expect(screen.getByText("No clients yet.")).toBeInTheDocument();
    // The empty-state CTA and the page's top button have distinct accessible names, so
    // getByRole stays unambiguous for each (no duplicate-name collision).
    expect(screen.getByRole("button", { name: "Add client" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add your first client" })).toBeInTheDocument();
  });

  it("CTA opens the same create form as the top Add button", async () => {
    const user = userEvent.setup();
    render(<ClientList />);
    await user.click(screen.getByRole("button", { name: "Add your first client" }));
    expect(screen.getByRole("dialog", { name: "Add client" })).toBeInTheDocument();
  });
});

it("sorts visible clients alphabetically after hiding Internal without changing stored order", async () => {
  await useStore.getState().addClient({ name: "Zulu", color: "#111111" });
  await useStore.getState().addClient({ name: "alpha", color: "#222222" });
  await useStore.getState().addClient({ name: "Bravo", color: "#333333" });
  const storedIds = useStore.getState().data.clients.map((client) => client.id);

  render(<ClientList />);

  expect(screen.getAllByTestId("client-row").map((row) => row.textContent)).toEqual(["alpha", "Bravo", "Zulu"]);
  expect(screen.queryByText("Internal")).not.toBeInTheDocument();
  expect(useStore.getState().data.clients.map((client) => client.id)).toEqual(storedIds);
});

it("gives repeated client edit controls distinct contextual names", async () => {
  await useStore.getState().addClient({ name: "Ferris", color: "#111" });
  await useStore.getState().addClient({ name: "Globex", color: "#222" });
  render(<ClientList />);

  expect(screen.getByRole("button", { name: "Edit Ferris" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Edit Globex" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
});

// Archiving hides a client and its descendants from active views while retaining them for restoration. This suite uses the demo so it exercises store mutations without server requests.
describe("ClientList archive flow", () => {
  beforeEach(() => vi.stubEnv("VITE_CAPACITYLENS_DEMO", "1"));
  afterEach(() => vi.unstubAllEnvs());

  it("confirms before archiving and keeps the client + its children in the data", async () => {
    const user = userEvent.setup();
    const client = await requireCreated(useStore.getState().addClient({ name: "Ferris", color: "#111" }));
    const project = await requireCreated(
      useStore.getState().addProject({ name: "P", clientId: client.id, color: "#222" }),
    );
    await useStore.getState().addPhase({ name: "Discovery", projectId: project.id });
    await useStore.getState().addActivity({ name: "T", kind: "project", projectId: project.id });
    render(<ClientList />);

    expect(screen.getByText("Ferris")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Archive Ferris" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent(/Archive client\?/i);
    expect(dialog).toHaveTextContent(
      "This also hides 1 project, 1 phase, and 0 allocations from the schedule; restore the client to bring them back.",
    );

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(requireValue(useStore.getState().data.clients[0], "active client")).toHaveProperty("archivedAt", null);

    await user.click(screen.getByRole("button", { name: "Archive Ferris" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Archive",
      }),
    );

    expect(useStore.getState().data.clients).toHaveLength(1);
    expect(useStore.getState().data.clients[0]?.archivedAt).toBeTruthy();
    expect(useStore.getState().data.projects).toHaveLength(1);
    expect(useStore.getState().data.phases).toHaveLength(1);
    expect(useStore.getState().data.activities).toHaveLength(1);
    expect(screen.queryByTestId("client-row")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("archived-clients-section")).getByText("Ferris")).toBeInTheDocument();
  });

  it("omits the cascade warning for a client without projects or allocations", async () => {
    const user = userEvent.setup();
    await useStore.getState().addClient({ name: "Childless", color: "#111" });
    render(<ClientList />);

    await user.click(screen.getByRole("button", { name: "Archive Childless" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent('Archive "Childless"?');
    expect(dialog).not.toHaveTextContent("This also hides");
  });

  it("tells editors that an owner or admin manages the archived client", async () => {
    const user = userEvent.setup();
    await useStore.getState().addClient({ name: "Ferris", color: "#111" });
    render(
      <PermissionContext.Provider value={{ role: "editor", status: "resolved" }}>
        <ClientList />
      </PermissionContext.Provider>,
    );

    await user.click(screen.getByRole("button", { name: "Archive Ferris" }));

    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "An owner or admin can restore it from Archived clients.",
    );
  });

  it("keeps exactly one quote pair around a redacted private code name in confirmation copy", async () => {
    const user = userEvent.setup();
    const created = await requireCreated(useStore.getState().addClient({ name: "Real client", color: "#111111" }));
    const client = { ...created, name: '"Nightwing"', isPrivate: true };
    useStore.getState().replaceAll({ ...useStore.getState().data, clients: [client] });
    render(<ClientList />);

    await user.click(screen.getByRole("button", { name: 'Archive "Nightwing"' }));
    const dialog = screen.getByRole("alertdialog", { name: "Archive client?" });
    expect(dialog).toHaveTextContent('Archive "Nightwing"?');
    expect(dialog).not.toHaveTextContent('""Nightwing""');
  });

  it.each(["editor", "viewer"] as const)("hides archived clients from a %s", async (role) => {
    const client = await requireCreated(useStore.getState().addClient({ name: "Ferris", color: "#111" }));
    useStore.getState().archiveEntity("clients", client.id);

    render(
      <PermissionContext.Provider value={{ role, status: "resolved" }}>
        <ClientList />
      </PermissionContext.Provider>,
    );

    expect(screen.queryByText("Ferris")).not.toBeInTheDocument();
    expect(screen.queryByTestId("archived-clients-section")).not.toBeInTheDocument();
  });

  it("restores an archived client from the expanded section", async () => {
    const user = userEvent.setup();
    const client = await requireCreated(useStore.getState().addClient({ name: "Ferris", color: "#111" }));
    useStore.getState().archiveEntity("clients", client.id);
    render(<ClientList />);

    await user.click(screen.getByRole("button", { name: "Restore Ferris" }));

    expect(useStore.getState().data.clients[0]).toHaveProperty("archivedAt", null);
    expect(screen.getByTestId("client-row")).toHaveTextContent("Ferris");
    expect(screen.queryByTestId("archived-clients-section")).not.toBeInTheDocument();
  });
});

// The built-in Internal client is a persisted project bucket, so ordinary client management must neither list nor archive it.
describe("ClientList withholds the Archive affordance for the built-in Internal client", () => {
  it("renders no row and no Archive control for the Internal client (only normal clients show)", async () => {
    useStore.getState().replaceAll(emptyAppData());
    const a = useStore.getState().addAccount({ name: "Ferris Co", color: "#6366f1" });
    if (!a) throw new Error("Expected account");
    useStore.getState().setActiveAccount(a.id);
    await useStore.getState().refreshPlanning();
    const internal = requireValue(internalClientFor(useStore.getState().data.clients, a.id), "internal client");
    await useStore.getState().addClient({ name: "Globex", color: "#3b82f6" });

    render(<ClientList />);

    expect(screen.getByText("Globex")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive Globex" })).toBeInTheDocument();

    expect(screen.queryByText(internal.name)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: `Archive ${internal.name}` })).not.toBeInTheDocument();
  });
});
