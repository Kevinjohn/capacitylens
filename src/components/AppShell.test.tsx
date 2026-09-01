import { afterEach, describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { AppShell } from "./AppShell";
import { useStore } from "../store/useStore";
import { makeAppData, makeAccount, DEFAULT_ACCOUNT_ID } from "../test/fixtures";
import { attachPersistence } from "../data/persist";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import { setOfflineReadState } from "../data/offlineCache";
import { markCompanyPickerForNextReload } from "../lib/companyPickerEntry";

const i18nMocks = vi.hoisted(() => ({ syncLocaleFromAccount: vi.fn() }));
vi.mock("@/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/i18n")>()),
  syncLocaleFromAccount: i18nMocks.syncLocaleFromAccount,
}));

vi.mock("../data/apiConfig", () => ({
  API_BASE: "",
  isDemoMode: () => true,
  isServerConfigured: () => false,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  i18nMocks.syncLocaleFromAccount.mockReset();
  // Sign through the cosmetic demo gate, dismiss the post-login intro page, AND seed an active
  // account so the shell (not the demo sign-in, not the account picker, not the intro) renders —
  // these tests exercise the nav/hydration gate, which sits *after* all of those gates.
  useStore.getState().setFakeSignedIn(true);
  useStore.getState().setIntroSeen(true);
  useStore.getState().replaceAll(makeAppData({ accounts: [makeAccount()] }));
  useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID);
  useStore.getState().clearFilters();
  // Clear any leftover transient notice so a prior test's Sonner toast can't bleed in (the
  // toast layer is module-global; the store notice is the source of truth the bridge reads).
  useStore.getState().setNotice(null);
  useStore.getState().setMasquerade({ phase: "inactive" });
  // Most shell tests exercise the post-hydration UI; the dedicated handoff test overrides this.
  useStore.getState().setHydrated(true);
  setOfflineReadState("cleanup", false);
});

function renderAppShell(initialEntries: string[] = ["/"], includeLocationProbe = false) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AppShell />
      {includeLocationProbe && <LocationProbe />}
    </MemoryRouter>,
  );
}

function mockNavigationType(type: NavigationTimingType) {
  vi.spyOn(performance, "getEntriesByType").mockImplementation((entryType) =>
    entryType === "navigation" ? ([{ type } as PerformanceNavigationTiming] satisfies PerformanceEntry[]) : [],
  );
}

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <button type="button" data-testid="location-probe" onClick={() => void navigate("/settings?tab=security")}>
      {location.pathname}
      {location.search}
      {location.hash}
    </button>
  );
}

it("shows the session-scoped masquerade banner above ordinary app alerts", () => {
  useStore.getState().setMasquerade({
    phase: "active",
    generation: 1,
    state: {
      accountId: DEFAULT_ACCOUNT_ID,
      targetUserId: "u-viewer",
      targetName: "Selina Kyle",
      effectiveRole: "viewer",
      startedAt: "2026-09-01T10:00:00.000Z",
      token: "token-1",
    },
  });
  setOfflineReadState("tenant", true, Date.parse("2026-09-01T10:00:00.000Z"));
  renderAppShell();

  const banner = screen.getByTestId("masquerade-banner");
  expect(banner).toHaveAttribute("role", "status");
  expect(banner).toHaveTextContent("Masquerading as Selina Kyle");
  expect(within(banner).getByRole("button", { name: "End now" })).toBeInTheDocument();
  expect(
    banner.compareDocumentPosition(screen.getByTestId("offline-read-only")) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
});

it("consumes a joined-account query only once and preserves later route queries", async () => {
  renderAppShell([`/?joinedAccount=${DEFAULT_ACCOUNT_ID}`], true);

  await waitFor(() => expect(screen.getByTestId("location-probe")).toHaveTextContent(/^\/$/));
  fireEvent.click(screen.getByTestId("location-probe"));
  await waitFor(() => expect(screen.getByTestId("location-probe")).toHaveTextContent("/settings?tab=security"));
});

it("removes only the joined-account handoff from the entry query", async () => {
  renderAppShell([`/?tab=security&joinedAccount=${DEFAULT_ACCOUNT_ID}&view=archived#members`], true);

  await waitFor(() =>
    expect(screen.getByTestId("location-probe")).toHaveTextContent("/?tab=security&view=archived#members"),
  );
});

it("waits for initial hydration before consuming a joined-account handoff", async () => {
  useStore.getState().setActiveAccount(null);
  useStore.getState().setHydrated(false);

  renderAppShell([`/?joinedAccount=${DEFAULT_ACCOUNT_ID}`]);

  await waitFor(() =>
    expect(useStore.getState().accountSummaries.some((account) => account.id === DEFAULT_ACCOUNT_ID)).toBe(true),
  );
  expect(useStore.getState().activeAccountId).toBeNull();

  act(() => useStore.getState().setHydrated(true));
  await waitFor(() => expect(useStore.getState().activeAccountId).toBe(DEFAULT_ACCOUNT_ID));
});

it("does not reactivate a consumed joined-account handoff after a later account-list refresh", async () => {
  const otherAccountId = "acct-other";
  const accounts = [makeAccount(), makeAccount({ id: otherAccountId, name: "Other Co" })];
  useStore.getState().replaceAll(makeAppData({ accounts }));
  useStore.getState().setAccountSummaries(accounts.map(({ id, name }) => ({ id, name, role: "owner" })));
  useStore.getState().setActiveAccount(otherAccountId);

  renderAppShell([`/?joinedAccount=${DEFAULT_ACCOUNT_ID}`]);
  act(() => useStore.getState().setHydrated(true));
  await waitFor(() => expect(useStore.getState().activeAccountId).toBe(DEFAULT_ACCOUNT_ID));

  act(() => {
    useStore.getState().setActiveAccount(otherAccountId);
    useStore.getState().setAccountSummaries(accounts.map(({ id, name }) => ({ id, name, role: "owner" })));
  });

  expect(useStore.getState().activeAccountId).toBe(otherAccountId);
});

it("does not apply a late joined-account handoff after an explicit company choice", async () => {
  const lateAccountId = "acct-late";
  useStore.getState().setActiveAccount(null);

  renderAppShell([`/?joinedAccount=${lateAccountId}`]);
  await waitFor(() =>
    expect(useStore.getState().accountSummaries.some((account) => account.id === DEFAULT_ACCOUNT_ID)).toBe(true),
  );

  act(() => useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID));
  act(() => {
    useStore
      .getState()
      .setAccountSummaries([
        ...useStore.getState().accountSummaries,
        { id: lateAccountId, name: "Late Co", role: "owner" },
      ]);
  });

  expect(useStore.getState().activeAccountId).toBe(DEFAULT_ACCOUNT_ID);
});

it("keeps the company picker on first entry even when exactly one company is available", async () => {
  mockNavigationType("navigate");
  useStore.setState({ activeAccountId: null, previousAccountId: null });

  renderAppShell(["/clients"], true);

  expect(await screen.findByRole("heading", { name: "Choose a company" })).toBeInTheDocument();
  expect(useStore.getState().activeAccountId).toBeNull();
  expect(screen.getByTestId("location-probe")).toHaveTextContent("/clients");
});

it("keeps the company picker after a successful sign-in reload", async () => {
  mockNavigationType("reload");
  markCompanyPickerForNextReload();
  useStore.setState({ activeAccountId: null, previousAccountId: null });

  renderAppShell(["/clients"]);

  expect(await screen.findByRole("heading", { name: "Choose a company" })).toBeInTheDocument();
  expect(useStore.getState().activeAccountId).toBeNull();
  expect(window.history.state).toEqual({});
});

it("reopens the sole valid company on reload without changing the requested route", async () => {
  mockNavigationType("reload");
  useStore.setState({ activeAccountId: null, previousAccountId: null });

  renderAppShell(["/clients?view=archived#client-list"], true);

  await waitFor(() => expect(useStore.getState().activeAccountId).toBe(DEFAULT_ACCOUNT_ID));
  expect(screen.getByTestId("location-probe")).toHaveTextContent("/clients?view=archived#client-list");
  expect(screen.queryByRole("heading", { name: "Choose a company" })).not.toBeInTheDocument();
});

it("keeps the picker on a multi-company reload", async () => {
  mockNavigationType("reload");
  const accounts = [makeAccount(), makeAccount({ id: "acct-other", name: "Other Co" })];
  useStore.getState().replaceAll(makeAppData({ accounts }));
  useStore.setState({
    activeAccountId: null,
    previousAccountId: null,
    accountSummaries: accounts.map(({ id, name }) => ({ id, name, role: "owner" as const })),
  });

  renderAppShell();

  expect(await screen.findByRole("heading", { name: "Choose a company" })).toBeInTheDocument();
  expect(useStore.getState().activeAccountId).toBeNull();
});

it("keeps the picker when one valid company came from an incomplete directory", async () => {
  mockNavigationType("reload");
  useStore.getState().replaceAll(emptyAppData());
  useStore.setState({
    activeAccountId: null,
    previousAccountId: null,
    accountSummaries: [{ id: "only-valid-row", name: "Only Visible Co", role: "owner" }],
    accountSummariesComplete: false,
  });

  renderAppShell();

  await waitFor(() => expect(useStore.getState().activeAccountId).toBeNull());
  expect(screen.getByRole("heading", { name: /Start planning|Choose a company/ })).toBeInTheDocument();
});

it("keeps the picker when the browser cannot classify the navigation", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(performance, "getEntriesByType").mockImplementation(() => {
    throw new DOMException("Performance unavailable");
  });
  useStore.setState({ activeAccountId: null, previousAccountId: null });

  renderAppShell();

  expect(await screen.findByRole("heading", { name: "Choose a company" })).toBeInTheDocument();
  expect(useStore.getState().activeAccountId).toBeNull();
  expect(warn).toHaveBeenCalledWith(
    expect.stringContaining("navigation type could not be read"),
    expect.any(DOMException),
  );
});

it("keeps an explicit Switch company action on the picker after a reload", async () => {
  mockNavigationType("reload");
  renderAppShell();
  expect(screen.getByRole("link", { name: "Schedule" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Switch company" }));

  expect(await screen.findByRole("heading", { name: "Choose a company" })).toBeInTheDocument();
  expect(useStore.getState().activeAccountId).toBeNull();
  expect(useStore.getState().previousAccountId).toBe(DEFAULT_ACCOUNT_ID);
});

it("does not mistake an unavailable sole membership for a valid reload destination", async () => {
  mockNavigationType("reload");
  useStore.getState().replaceAll(emptyAppData());
  useStore.setState({
    activeAccountId: null,
    previousAccountId: null,
    accountSummaries: [
      { id: "unavailable-account", name: "Unavailable Co", role: "viewer", roleStatus: "unavailable" },
    ],
  });

  renderAppShell();

  await waitFor(() => expect(useStore.getState().activeAccountId).toBeNull());
  expect(screen.getByRole("heading", { name: /Start planning|Choose a company/ })).toBeInTheDocument();
});

it("lets an invite handoff keep ownership of a reload instead of auto-opening another sole company", async () => {
  mockNavigationType("reload");
  useStore.setState({ activeAccountId: null, previousAccountId: null });

  renderAppShell(["/clients?joinedAccount=not-yet-authorized"]);

  expect(await screen.findByRole("heading", { name: "Choose a company" })).toBeInTheDocument();
  expect(useStore.getState().activeAccountId).toBeNull();
});

it("does not reactivate a sole company after its loaded slice proves missing", async () => {
  mockNavigationType("reload");
  const summary = { id: DEFAULT_ACCOUNT_ID, name: "Wayne Enterprises", role: "owner" as const };
  useStore.setState({ activeAccountId: null, previousAccountId: null, accountSummaries: [summary] });
  renderAppShell();
  await waitFor(() => expect(useStore.getState().activeAccountId).toBe(DEFAULT_ACCOUNT_ID));

  act(() => {
    useStore.getState().replaceAll(emptyAppData());
    useStore.getState().setAccountSummaries([summary]);
  });

  await waitFor(() => expect(useStore.getState().activeAccountId).toBeNull());
  expect(screen.getByRole("heading", { name: "Start planning" })).toBeInTheDocument();
  expect(useStore.getState().notice?.message).toBe("That company no longer exists.");
});

it("guards navigation while a persistence write is still unacknowledged", () => {
  const detachPersistence = attachPersistence(
    useStore,
    { loadAll: async () => emptyAppData(), saveAll: async () => {} },
    300,
  );
  const { unmount } = renderAppShell();
  act(() => {
    useStore.getState().addClient({ name: "Unsaved client", color: "#111111" });
  });

  const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
  window.dispatchEvent(event);

  expect(useStore.getState().dirtyForm).toBe(false);
  expect(event.defaultPrevented).toBe(true);
  unmount();
  detachPersistence();
});

describe("AppShell navigation links", () => {
  it("places the focused skip link on its dedicated accessibility layer", () => {
    renderAppShell();

    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveClass("focus:z-(--z-index-skip-link)");
  });

  it("keeps a descriptive title on an accepted trailing-slash route", async () => {
    renderAppShell(["/resources/"]);

    await waitFor(() => expect(document.title).toBe("Resources · CapacityLens"));
  });

  it("preserves the last locale while a selected company's slice is still loading", async () => {
    const currentAccount = makeAccount({ language: "en" });
    const destinationAccount = makeAccount({ id: "acct-other", name: "Other Co", language: undefined });
    useStore.getState().replaceAll(makeAppData({ accounts: [currentAccount] }));
    renderAppShell();
    await waitFor(() => expect(i18nMocks.syncLocaleFromAccount).toHaveBeenCalledWith("en"));
    i18nMocks.syncLocaleFromAccount.mockClear();

    // Model the ordinary server switch gap directly: the directory authorizes the destination,
    // activeAccountId changes, and the old slice remains until the destination load resolves.
    act(() => {
      useStore.setState({
        activeAccountId: destinationAccount.id,
        accountSummaries: [{ id: destinationAccount.id, name: destinationAccount.name, role: "owner" }],
      });
    });
    expect(i18nMocks.syncLocaleFromAccount).not.toHaveBeenCalled();

    act(() => useStore.setState({ data: makeAppData({ accounts: [destinationAccount] }) }));
    await waitFor(() => expect(i18nMocks.syncLocaleFromAccount).toHaveBeenCalledWith(undefined));
  });

  it("labels a cached snapshot as Offline and view only instead of Demo access", () => {
    setOfflineReadState("tenant", true, Date.parse("2026-07-17T10:00:00.000Z"));
    renderAppShell();

    expect(screen.getByTestId("active-role")).toHaveTextContent("Offline · View only");
    expect(screen.getByTestId("active-role")).not.toHaveTextContent("Demo access");
    expect(screen.getByTestId("view-only")).toHaveTextContent("Offline · View only");
  });

  it("renders all expected nav links", () => {
    renderAppShell();

    expect(screen.getByRole("link", { name: "Schedule" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Resources" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Team & access" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Disciplines" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clients" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Activities" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Time off" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
  });

  it("renders the CapacityLens brand name in the nav", () => {
    renderAppShell();
    expect(screen.getByText("CapacityLens")).toBeInTheDocument();
  });

  // Issue #169: import/export left the sidebar for a Settings card. Nothing in the shell may
  // resurrect it — the whole point was to stop it occupying permanent nav real estate.
  it("does NOT render the import/export tools in the sidebar", () => {
    renderAppShell();

    expect(screen.queryByTestId("settings-data-tools")).not.toBeInTheDocument();
    expect(screen.queryByTestId("export-data")).not.toBeInTheDocument();
    expect(screen.queryByTestId("import-data")).not.toBeInTheDocument();
  });

  // Issue #169: the bottom-left identity control. The demo persona is signed in here (isDemoMode is
  // mocked true above and authMode defaults to "off"), so the avatar'd button ends the demo session.
  it("offers an avatar'd sign-out below Switch company", () => {
    renderAppShell();

    const signOut = screen.getByTestId("nav-sign-out");
    expect(signOut).toHaveTextContent("Sign out");
    expect(signOut).toHaveAttribute("title", "Signed in as Jordan Avery");
    expect(signOut.querySelector("[data-slot='avatar']")).not.toBeNull();

    expect(useStore.getState().fakeSignedIn).toBe(true);
    fireEvent.click(signOut);
    expect(useStore.getState().fakeSignedIn).toBe(false);
  });

  // Issues #169/#172: Team & access and Settings are pinned BELOW the day-to-day destinations, in
  // that order, so administration stops competing with the app's actual purpose. Assert the real
  // document order rather than mere presence — presence alone would pass with the old layout.
  it("pins Team & access and Settings, in that order, after every other destination", () => {
    renderAppShell();

    // Scoped to the nav landmark so the skip-to-content link above the sidebar stays out of it.
    const order = within(screen.getByRole("navigation"))
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));
    expect(order).toEqual([
      "/",
      "/resources",
      "/disciplines",
      "/clients",
      "/projects",
      "/activities",
      "/timeoff",
      "/team",
      "/settings",
    ]);
  });

  it("nav links point to correct routes", () => {
    renderAppShell();

    expect(screen.getByRole("link", { name: "Schedule" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Resources" })).toHaveAttribute("href", "/resources");
    expect(screen.getByRole("link", { name: "Team & access" })).toHaveAttribute("href", "/team");
    expect(screen.getByRole("link", { name: "Disciplines" })).toHaveAttribute("href", "/disciplines");
    expect(screen.getByRole("link", { name: "Clients" })).toHaveAttribute("href", "/clients");
    expect(screen.getByRole("link", { name: "Projects" })).toHaveAttribute("href", "/projects");
    expect(screen.getByRole("link", { name: "Activities" })).toHaveAttribute("href", "/activities");
    expect(screen.getByRole("link", { name: "Time off" })).toHaveAttribute("href", "/timeoff");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });
});

describe("AppShell sidebar collapse", () => {
  beforeEach(() => {
    // Reset to the open default and forget any persisted choice from a prior test.
    act(() => {
      useStore.getState().setSidebarOpen(true);
    });
    localStorage.removeItem("capacitylens/sidebar");
  });

  it("defaults open (jsdom has no matchMedia → large-screen default): links + collapse toggle", () => {
    renderAppShell();

    expect(screen.getByRole("link", { name: "Schedule" })).toBeInTheDocument();
    const toggle = within(screen.getByTestId("app-sidebar")).getByRole("button", { name: "Collapse menu" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("reports the mobile sheet state and next action from the top-bar trigger", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(
        () =>
          ({
            matches: true,
            media: "(max-width: 767px)",
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(() => true),
          }) satisfies MediaQueryList,
      ),
    );
    sessionStorage.setItem("capacitylens/rotateHintDismissed", "1");
    renderAppShell();

    const trigger = within(screen.getByRole("main")).getByRole("button", { name: "Expand menu" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);

    expect(trigger).toHaveAccessibleName("Collapse menu");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("collapsing keeps the navigation links usable and persists the choice", () => {
    renderAppShell();

    act(() => {
      within(screen.getByTestId("app-sidebar")).getByRole("button", { name: "Collapse menu" }).click();
    });

    expect(screen.getByRole("link", { name: "Schedule" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
    expect(screen.getByTestId("app-sidebar")).toHaveAttribute("data-state", "collapsed");
    expect(within(screen.getByTestId("app-sidebar")).getByRole("button", { name: "Expand menu" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(localStorage.getItem("capacitylens/sidebar")).toBe("closed");
  });

  it("collapsed destinations remain real links instead of reopening the menu", () => {
    renderAppShell();
    act(() => {
      useStore.getState().setSidebarOpen(false);
    });

    expect(screen.getByRole("link", { name: "Projects" })).toHaveAttribute("href", "/projects");
    expect(screen.getByTestId("app-sidebar")).toHaveAttribute("data-state", "collapsed");
    expect(localStorage.getItem("capacitylens/sidebar")).toBe("closed");
  });

  it("nav links carry icons without changing their accessible names", () => {
    renderAppShell();
    const link = screen.getByRole("link", { name: "Projects" });
    expect(link.querySelector("svg")).not.toBeNull();
    expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("toggles with Cmd/Ctrl+B and prevents the browser shortcut outside guarded contexts", () => {
    renderAppShell();
    const event = new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true, cancelable: true });

    act(() => {
      window.dispatchEvent(event);
    });

    expect(useStore.getState().sidebarOpen).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it.each([
    ["input", "input"],
    ["textarea", "textarea"],
    ["select", "select"],
    ["editable content", "div"],
  ] as const)("leaves Cmd/Ctrl+B to %s", (_label, tagName) => {
    renderAppShell();
    const target = document.createElement(tagName);
    if (tagName === "div") target.setAttribute("contenteditable", "true");
    document.body.append(target);
    try {
      const event = new KeyboardEvent("keydown", { key: "b", ctrlKey: true, bubbles: true, cancelable: true });

      act(() => {
        target.dispatchEvent(event);
      });

      expect(useStore.getState().sidebarOpen).toBe(true);
      expect(event.defaultPrevented).toBe(false);
    } finally {
      target.remove();
    }
  });

  it("ignores Cmd/Ctrl+B during IME composition", () => {
    renderAppShell();
    const event = new KeyboardEvent("keydown", {
      key: "b",
      metaKey: true,
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      window.dispatchEvent(event);
    });

    expect(useStore.getState().sidebarOpen).toBe(true);
    expect(event.defaultPrevented).toBe(false);
  });

  it("ignores Cmd/Ctrl+B while a modal is open", () => {
    renderAppShell();
    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("data-state", "open");
    document.body.append(modal);
    const event = new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true, cancelable: true });

    try {
      act(() => {
        window.dispatchEvent(event);
      });

      expect(useStore.getState().sidebarOpen).toBe(true);
      expect(event.defaultPrevented).toBe(false);
    } finally {
      modal.remove();
    }
  });
});

describe("AppShell hydration gate", () => {
  beforeEach(() => useStore.getState().setHydrated(false));

  it('shows "Loading…" when the store is not hydrated', () => {
    renderAppShell();

    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("does not render the outlet area when not hydrated", () => {
    renderAppShell();

    // The loading placeholder should be shown, not the outlet content area
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByRole("main")?.textContent).toContain("Loading");
  });

  it('hides "Loading…" and renders outlet area after setHydrated(true)', () => {
    renderAppShell();

    // Initially shows loading
    expect(screen.getByText("Loading…")).toBeInTheDocument();

    // Set hydrated inside act so React processes the state update
    act(() => {
      useStore.getState().setHydrated(true);
    });

    // Loading text should be gone, outlet rendered instead
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });

  it("renders outlet area immediately when hydrated is already true", () => {
    useStore.getState().setHydrated(true);

    renderAppShell();

    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });
});

describe("AppShell undo/redo keyboard", () => {
  it("⌘Z undoes a data change, but is IGNORED while a form is dirty", () => {
    useStore.getState().setHydrated(true);
    renderAppShell();
    // A change so there's something to undo.
    act(() => {
      useStore.getState().addClient({ name: "Undoable", color: "#111111" });
    });
    expect(useStore.getState().data.clients).toHaveLength(1);

    // A dirty form owns ⌘Z — undoing would revert the data behind the unsaved form (the
    // focus check alone misses non-text controls like a <select>), so it must be ignored.
    act(() => {
      useStore.getState().setDirtyForm(true);
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true }));
    });
    expect(useStore.getState().data.clients).toHaveLength(1); // NOT undone

    // Form no longer dirty → ⌘Z undoes as normal.
    act(() => {
      useStore.getState().setDirtyForm(false);
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true }));
    });
    expect(useStore.getState().data.clients).toHaveLength(0); // undone
  });

  it("ignores undo and redo while a clean modal has focus on a non-text control", () => {
    useStore.getState().setHydrated(true);
    renderAppShell();
    act(() => {
      useStore.getState().addClient({ name: "Undoable", color: "#111111" });
    });

    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("data-state", "open");
    const button = document.createElement("button");
    modal.append(button);
    document.body.append(modal);

    try {
      act(() => {
        button.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true }));
      });
      expect(useStore.getState().data.clients).toHaveLength(1);

      // Seed the redo side of history directly, then prove the same clean modal owns Cmd+Shift+Z.
      act(() => useStore.getState().undo());
      expect(useStore.getState().data.clients).toHaveLength(0);
      act(() => {
        button.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "z",
            metaKey: true,
            shiftKey: true,
            bubbles: true,
          }),
        );
      });
      expect(useStore.getState().data.clients).toHaveLength(0);
    } finally {
      modal.remove();
    }
  });
});

describe("AppShell command palette dirty-form guard", () => {
  it("Ctrl+K with dirtyForm=true shows the unsaved-changes notice and does NOT open the palette", async () => {
    useStore.getState().setHydrated(true);
    renderAppShell();

    act(() => {
      useStore.getState().setDirtyForm(true);
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    });

    // Palette must NOT render
    expect(screen.queryByTestId("command-palette")).not.toBeInTheDocument();
    // Notice must show the exact message. It's surfaced via a Sonner toast now (bridged from
    // the store `notice`), which portals in asynchronously — so await it.
    expect(
      await screen.findByText("You have unsaved changes — use Cancel or Save to close this dialog."),
    ).toBeInTheDocument();
  });

  it("Ctrl+K with dirtyForm=false opens the palette", () => {
    useStore.getState().setHydrated(true);
    renderAppShell();

    act(() => {
      useStore.getState().setDirtyForm(false);
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    });

    expect(screen.getByTestId("command-palette")).toBeInTheDocument();
  });

  it("leaves Cmd/Ctrl+K to an existing modal", () => {
    renderAppShell();
    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("data-state", "open");
    document.body.appendChild(modal);
    const event = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, cancelable: true });
    try {
      act(() => {
        window.dispatchEvent(event);
      });
      expect(event.defaultPrevented).toBe(false);
      expect(screen.queryByTestId("command-palette")).not.toBeInTheDocument();
    } finally {
      modal.remove();
    }
  });

  it("ignores Cmd/Ctrl+K during IME composition", () => {
    renderAppShell();
    const event = new KeyboardEvent("keydown", { key: "k", metaKey: true, isComposing: true, cancelable: true });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByTestId("command-palette")).not.toBeInTheDocument();
  });

  it("keeps the palette open when the Ctrl+K keydown repeats", () => {
    renderAppShell();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, repeat: true }));
    });

    expect(screen.getByTestId("command-palette")).toBeInTheDocument();
  });

  it("closes the open palette with a second Ctrl+K", () => {
    renderAppShell();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    });
    expect(screen.getByTestId("command-palette")).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    });
    expect(screen.queryByTestId("command-palette")).not.toBeInTheDocument();
  });

  it("leaves Ctrl+K to a later modal even while the palette is open", () => {
    renderAppShell();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    });
    expect(screen.getByTestId("command-palette")).toBeInTheDocument();

    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("data-state", "open");
    document.body.appendChild(modal);
    const event = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, cancelable: true });
    try {
      act(() => {
        window.dispatchEvent(event);
      });
      expect(event.defaultPrevented).toBe(false);
      expect(screen.getByTestId("command-palette")).toBeInTheDocument();
    } finally {
      modal.remove();
    }
  });
});

describe("AppShell transient notice", () => {
  // The store `notice`/`setNotice` API is unchanged; AppShell now bridges it to a Sonner
  // toast (the hand-rolled Toast was retired in shadcn Phase 5). Sonner portals the toast in
  // asynchronously inside a polite live region (<section aria-label="Notifications…"
  // aria-live="polite">), each toast a `li[data-sonner-toast]` with an aria-label="Close
  // toast" button — so these assertions match Sonner's DOM, while the behavioural intent
  // (info appears + auto-dismisses, error persists + is dismissible, store stays in sync)
  // is preserved.
  it("renders a Sonner toast for an info store notice and clears it on dismiss", async () => {
    renderAppShell();
    expect(screen.queryByText(/could not be moved/)).not.toBeInTheDocument();

    act(() => {
      useStore.getState().setNotice("That allocation could not be moved there.");
    });
    // Sonner portals the toast in asynchronously; wait for it, then confirm it's a real Sonner
    // toast living in the polite live region (not, say, a loading spinner's status node).
    const message = await screen.findByText(/could not be moved/);
    expect(message.closest("[data-sonner-toast]")).not.toBeNull();
    expect(message.closest('[aria-live="polite"]')).not.toBeNull();

    // Dismiss via Sonner's close button (aria-label "Close toast"); the bridge's onDismiss
    // calls setNotice(null), so the store clears in lock-step with the toast leaving.
    act(() => {
      screen.getByRole("button", { name: "Close toast" }).click();
    });
    await waitFor(() => expect(useStore.getState().notice).toBeNull());
    await waitFor(() => expect(screen.queryByText(/could not be moved/)).not.toBeInTheDocument());
  });

  it("keeps an ERROR notice on screen past the 4s info window (no auto-dismiss), unlike info", async () => {
    // Drive Sonner's auto-close timer with FAKE timers so we can genuinely advance past the
    // 4000ms info window deterministically (a real 4s wait is too slow + flaky). `findBy*`
    // polls on real timers, so we never use it here — we pump Sonner's mount + dismiss timers
    // with advanceTimersByTimeAsync and read synchronously. Restored in finally so the other
    // async tests in this file keep their real-timer behaviour.
    vi.useFakeTimers();
    try {
      renderAppShell();

      // BASELINE — an INFO notice MUST auto-dismiss once the 4000ms window elapses. Prove the
      // window actually closes (so the error assertion below isn't vacuously true).
      act(() => {
        useStore.getState().setNotice("Info that should auto-dismiss.");
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50); // let Sonner mount/portal the toast
      });
      expect(screen.getByText(/auto-dismiss/)).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4500); // past the 4000ms info window + exit animation
      });
      expect(screen.queryByText(/auto-dismiss/)).not.toBeInTheDocument();
      expect(useStore.getState().notice).toBeNull(); // bridge cleared the store in lock-step

      // ERROR — created with duration: Infinity, so the SAME 4500ms advance must NOT dismiss it.
      act(() => {
        useStore.getState().setNotice("That allocation could not be moved.", "error");
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      const message = screen.getByText(/could not be moved/);
      expect(message.closest("[data-sonner-toast]")).not.toBeNull();
      // Tagged for the danger affordance (index.css `.toast-error`) so it reads as an error.
      expect(message.closest("[data-sonner-toast]")).toHaveClass("toast-error");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4500); // well past where an info toast would have gone
      });
      expect(screen.getByText(/could not be moved/)).toBeInTheDocument();
      expect(useStore.getState().notice?.tone).toBe("error");

      // It is still dismissible, and dismissal clears the store in lock-step.
      act(() => {
        screen.getByRole("button", { name: "Close toast" }).click();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500); // exit animation → removal + onDismiss
      });
      expect(useStore.getState().notice).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a WARNING notice on screen past the 4s info window, on the NEUTRAL surface (WCAG 2.2.1)", async () => {
    // The 'warning' tone (e.g. the clamped-hours/data-truncation advisory) must inherit the
    // persistent (duration: Infinity) treatment like an error — a fixed 4s timer on the sole signal
    // of a silent truncation fails WCAG 2.2.1 — but must NOT carry the danger `.toast-error` accent,
    // since the edit SUCCEEDED. Same fake-timer technique as the info-vs-error test above.
    vi.useFakeTimers();
    try {
      renderAppShell();

      act(() => {
        useStore.getState().setNotice("Work volume was capped at 24h/day.", "warning");
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50); // let Sonner mount/portal the toast
      });
      const message = screen.getByText(/capped at 24h\/day/);
      const toastEl = message.closest("[data-sonner-toast]");
      expect(toastEl).not.toBeNull();
      // NEUTRAL surface: not raised via toast.error, so no danger accent (unlike the error tone).
      expect(toastEl).not.toHaveClass("toast-error");

      // Persists well past where an INFO toast (4000ms) would have auto-dismissed.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4500);
      });
      expect(screen.getByText(/capped at 24h\/day/)).toBeInTheDocument();
      expect(useStore.getState().notice?.tone).toBe("warning");

      // Still dismissible via the close button; dismissal clears the store in lock-step.
      act(() => {
        screen.getByRole("button", { name: "Close toast" }).click();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(useStore.getState().notice).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rapidly replacing notice A with B leaves B intact (no stale-clear race)", async () => {
    // REGRESSION for the Phase-5 stale-clear race: rapidly swapping notice A→B (e.g. two drags
    // in quick succession) must NOT let A's deferred programmatic dismiss wipe B. When the bridge
    // replaces A's toast it runs cleanup `toast.dismiss(idA)`, and Sonner fires A's `onDismiss`
    // even for a *programmatic* dismiss — so without the `=== thisNotice` identity guard A's
    // `clear()` would call setNotice(null) and erase B. (Verified: with the guard removed the
    // store reads `notice === undefined` here instead of B.) Fake timers let us pump Sonner's
    // deferred-dismiss + exit-animation rAFs for A deterministically while staying WELL under the
    // 4000ms auto-dismiss window, so B never auto-closes — we isolate the swap race, not the timer.
    vi.useFakeTimers();
    try {
      renderAppShell();

      // A mounts first (its bridge effect runs, Sonner portals toast A) — the swap must dismiss a
      // *real* live toast for the race to exist at all.
      act(() => {
        useStore.getState().setNotice("First notice");
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50); // let Sonner mount/portal toast A
      });
      expect(screen.getByText("First notice")).toBeInTheDocument();

      // The back-to-back second notice REPLACES A — this is what tears A's toast down and fires
      // A's deferred onDismiss (the thing that, unguarded, would wipe B).
      act(() => {
        useStore.getState().setNotice("Second notice");
      });
      // Pump A's deferred dismiss rAF, THEN its exit-animation removal, in two steps — Sonner
      // chains those across rAF/flush boundaries, so a single big advance can leave A's node
      // mid-animation. Total here (~250ms post-swap) stays well under the 4000ms auto-dismiss,
      // so B never auto-closes.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50); // A's deferred onDismiss fires (the race trigger)
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200); // A's exit animation completes → node removed
      });

      // CORE ASSERTION — the store still holds B (A's deferred clear was identity-guarded out; an
      // unguarded bridge leaves this undefined). Read synchronously: `findBy*` polls on real timers
      // and would hang under fake timers, so we never use it here.
      expect(useStore.getState().notice?.message).toBe("Second notice");
      // B is on screen as a real Sonner toast; A's toast has left the DOM (its 300ms dismiss +
      // exit completed), proving A's teardown removed only A, not B.
      const message = screen.getByText("Second notice");
      expect(message.closest("[data-sonner-toast]")).not.toBeNull();
      expect(screen.queryByText("First notice")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("AppShell fake sign-in gate (cosmetic demo)", () => {
  it("shows the demo sign-in (not the picker/shell) when not signed in", () => {
    useStore.getState().setFakeSignedIn(false);
    useStore.getState().setHydrated(true);
    renderAppShell();

    expect(screen.getByRole("heading", { name: "Choose an account" })).toBeInTheDocument();
    // Both downstream gates are walled off behind the demo sign-in.
    expect(screen.queryByText("Choose a company")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Schedule" })).not.toBeInTheDocument();
  });

  it("clicking the demo account signs in and reveals the next screen (the picker)", () => {
    useStore.getState().setFakeSignedIn(false);
    useStore.getState().setActiveAccount(null);
    useStore.getState().setHydrated(true);
    renderAppShell();

    act(() => {
      screen.getByTestId("fake-sign-in").click();
    });

    expect(useStore.getState().fakeSignedIn).toBe(true);
    expect(screen.getByText("Choose a company")).toBeInTheDocument();
  });
});
