import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { ArchivedSection } from "./ArchivedSection";
import { useStore } from "../../store/useStore";
import { DEFAULT_ACCOUNT_ID, makeAccount, makeActivity, makeClient, makeResource } from "../../test/fixtures";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import { PermissionContext } from "../../auth/permissionContext";

const cfg = vi.hoisted(() => ({ serverOn: false }));
vi.mock("../../data/apiConfig", () => ({ API_BASE: "http://api.test", isServerConfigured: () => cfg.serverOn }));

const TS = "2026-05-01T00:00:00.000Z";
const OLD = "2026-01-01T00:00:00.000Z";

function seed(overrides = {}) {
  useStore.getState().replaceAll({ ...emptyAppData(), accounts: [makeAccount()], ...overrides });
  useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID);
}

beforeEach(() => {
  cfg.serverOn = false;
  seed();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// eslint-disable-next-line max-lines-per-function -- deleted-item security and retention scenarios share one fixture lifecycle
describe("Settings deleted items", () => {
  it("does not list archived rows and shows the deleted empty state", () => {
    seed({ clients: [makeClient({ accountId: DEFAULT_ACCOUNT_ID, archivedAt: TS })] });
    render(<ArchivedSection />);
    expect(screen.getByRole("heading", { name: "Deleted items" })).toBeInTheDocument();
    expect(screen.getByText("Nothing deleted.")).toBeInTheDocument();
    expect(screen.queryByText("Acme")).not.toBeInTheDocument();
  });

  it("lists deleted resources and activities for permanent deletion", () => {
    seed({
      resources: [
        makeResource({ accountId: DEFAULT_ACCOUNT_ID, name: "Removed person #123", archivedAt: OLD, deletedAt: OLD }),
      ],
      activities: [
        makeActivity({ accountId: DEFAULT_ACCOUNT_ID, name: "Old planning", archivedAt: OLD, deletedAt: OLD }),
      ],
    });
    render(<ArchivedSection />);
    expect(screen.getAllByTestId("deleted-row")).toHaveLength(2);
    expect(screen.getByText("Removed person #123")).toBeInTheDocument();
    expect(screen.getByText("Old planning")).toBeInTheDocument();
    expect(screen.getByText("· Activity")).toBeInTheDocument();
  });

  it("hides deleted data from editors", () => {
    seed({ clients: [makeClient({ accountId: DEFAULT_ACCOUNT_ID, archivedAt: OLD, deletedAt: OLD })] });
    render(
      <PermissionContext.Provider value={{ role: "editor", status: "resolved" }}>
        <ArchivedSection />
      </PermissionContext.Provider>,
    );
    expect(screen.queryByTestId("archived-section")).not.toBeInTheDocument();
  });

  it("keeps the permanent-delete confirmation", () => {
    seed({
      clients: [makeClient({ accountId: DEFAULT_ACCOUNT_ID, name: "Old client", archivedAt: OLD, deletedAt: OLD })],
    });
    render(<ArchivedSection />);
    fireEvent.click(screen.getByRole("button", { name: "Permanently delete Old client" }));
    const dialog = screen.getByRole("alertdialog", { name: "Permanently delete?" });
    expect(dialog).toHaveTextContent("Old client");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("enables permanent deletion after crossing the 30-day boundary and purges after confirmation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-31T23:59:59.950Z"));
    const deletedAt = "2026-01-02T00:00:00.000Z";
    seed({
      clients: [makeClient({ accountId: DEFAULT_ACCOUNT_ID, name: "Old client", archivedAt: deletedAt, deletedAt })],
    });
    render(<ArchivedSection />);
    const purge = screen.getByRole("button", { name: "Permanently delete Old client" });
    expect(purge).toBeDisabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(51);
    });
    expect(purge).toBeEnabled();
    fireEvent.click(purge);
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete permanently" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(useStore.getState().data.clients).toHaveLength(0);
    vi.useRealTimers();
  });

  it("re-arms a 32-bit timer and enables purge when the full retention period ends", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    seed({
      clients: [
        makeClient({
          accountId: DEFAULT_ACCOUNT_ID,
          name: "Young client",
          archivedAt: "2026-01-01T00:00:00.000Z",
          deletedAt: "2026-01-01T00:00:00.000Z",
        }),
      ],
    });
    render(<ArchivedSection />);
    expect(screen.getByRole("button", { name: "Permanently delete Young client" })).toBeDisabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_147_483_647);
    });
    expect(screen.getByRole("button", { name: "Permanently delete Young client" })).toBeDisabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30 * 24 * 60 * 60 * 1000 - 2_147_483_647 + 1);
    });
    expect(screen.getByRole("button", { name: "Permanently delete Young client" })).toBeEnabled();
    vi.useRealTimers();
  });

  it("suppresses server inactive rows immediately when the role loses access", async () => {
    cfg.serverOn = true;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ...emptyAppData(),
          accounts: [makeAccount()],
          clients: [makeClient({ accountId: DEFAULT_ACCOUNT_ID, name: "Old client", archivedAt: OLD, deletedAt: OLD })],
        }),
      }),
    );
    const view = render(
      <PermissionContext.Provider value={{ role: "admin", status: "resolved" }}>
        <ArchivedSection />
      </PermissionContext.Provider>,
    );
    expect(await screen.findByText("Old client")).toBeInTheDocument();
    view.rerender(
      <PermissionContext.Provider value={{ role: "editor", status: "resolved" }}>
        <ArchivedSection />
      </PermissionContext.Provider>,
    );
    expect(screen.queryByText("Old client")).not.toBeInTheDocument();
  });

  it.each([403, 500])("does not render stale server rows after an HTTP %s", async (status) => {
    cfg.serverOn = true;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status, json: async () => ({ error: "Denied" }) }));
    render(
      <PermissionContext.Provider value={{ role: "admin", status: "resolved" }}>
        <ArchivedSection />
      </PermissionContext.Provider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByTestId("deleted-row")).not.toBeInTheDocument();
  });

  it("rejects a structurally incomplete server response", async () => {
    cfg.serverOn = true;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ accounts: [] }) }));
    render(
      <PermissionContext.Provider value={{ role: "admin", status: "resolved" }}>
        <ArchivedSection />
      </PermissionContext.Provider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useStore.getState().notice?.tone).toBe("error");
    expect(screen.queryByTestId("deleted-row")).not.toBeInTheDocument();
  });
});
