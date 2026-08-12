import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsView } from "./SettingsView";
import { AuthContext } from "../../auth/authContext";
import { useStore } from "../../store/useStore";
import { resetStoreWithAccount, DEFAULT_ACCOUNT_ID } from "../../test/fixtures";
import { PermissionContext } from "../../auth/permissionContext";

const offlineMocks = vi.hoisted(() => ({
  enabled: false,
  setEnabled: vi.fn<(enabled: boolean) => Promise<void>>(),
  cacheAuth: vi.fn(async () => ({ status: "written" as const })),
  cacheSummaries: vi.fn(async () => ({ status: "written" as const })),
  cacheSlice: vi.fn(async () => ({ status: "written" as const })),
  clearAll: vi.fn<() => Promise<void>>(),
  preferenceListeners: new Set<() => void>(),
}));

vi.mock("../../data/offlineCache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../data/offlineCache")>()),
  offlineReadEnabled: () => offlineMocks.enabled,
  subscribeOfflinePreference: (listener: () => void) => {
    offlineMocks.preferenceListeners.add(listener);
    return () => offlineMocks.preferenceListeners.delete(listener);
  },
  setOfflineReadEnabled: offlineMocks.setEnabled,
  cacheAuthSnapshot: offlineMocks.cacheAuth,
  cacheAccountSummaries: offlineMocks.cacheSummaries,
  cacheAccountSlice: offlineMocks.cacheSlice,
  clearAllOfflineData: offlineMocks.clearAll,
}));

beforeEach(() => {
  offlineMocks.enabled = false;
  offlineMocks.preferenceListeners.clear();
  offlineMocks.setEnabled.mockReset();
  offlineMocks.setEnabled.mockImplementation(async (enabled) => {
    offlineMocks.enabled = enabled;
    for (const listener of offlineMocks.preferenceListeners) listener();
  });
  offlineMocks.cacheAuth.mockClear();
  offlineMocks.cacheSummaries.mockClear();
  offlineMocks.cacheSlice.mockClear();
  offlineMocks.clearAll.mockReset();
  offlineMocks.clearAll.mockResolvedValue(undefined);
  resetStoreWithAccount();
  useStore.getState().setTheme("light");
});

describe("SettingsView — scheduling mode", () => {
  it("defaults to Hours and switches the company to Days through the store", async () => {
    const user = userEvent.setup();
    render(<SettingsView />);

    const hours = screen.getByRole("radio", { name: "Hours" });
    const days = screen.getByRole("radio", { name: "Days" });
    // Absent schedulingMode reads as the original 'hourly' behaviour.
    expect(hours).toHaveAttribute("aria-checked", "true");
    expect(days).toHaveAttribute("aria-checked", "false");

    await user.click(days);

    const account = useStore.getState().data.accounts.find((a) => a.id === DEFAULT_ACCOUNT_ID);
    expect(account?.schedulingMode).toBe("days");
    expect(days).toHaveAttribute("aria-checked", "true");
  });

  it("offers a Blocks option and switches the company to it", async () => {
    const user = userEvent.setup();
    render(<SettingsView />);

    const blocks = screen.getByRole("radio", { name: "Blocks" });
    expect(blocks).toHaveAttribute("aria-checked", "false");

    await user.click(blocks);

    const account = useStore.getState().data.accounts.find((a) => a.id === DEFAULT_ACCOUNT_ID);
    expect(account?.schedulingMode).toBe("blocks");
    expect(blocks).toHaveAttribute("aria-checked", "true");
  });
});

describe("SettingsView — section help", () => {
  it("gives every default settings section its labelled question-mark action", () => {
    render(<SettingsView />);

    for (const section of [
      "Scheduling",
      "Global working days",
      "Disciplines",
      "Engagement grouping",
      "Schedule",
      "Internal work colours",
      "Placeholders",
      "External",
      "Internal work",
      "Activity creation",
      "Allocation bars",
      "Utilisation",
      "Appearance",
      "Device data",
      "Import & export",
      "Account Options Selected at Creation",
    ]) {
      expect(screen.getByRole("button", { name: `About ${section}` })).toHaveAttribute("title", `About ${section}`);
    }
  });

  it("keeps help and the account summary available while company controls remain read-only for viewers", () => {
    render(
      <PermissionContext.Provider value={{ role: "viewer", status: "resolved" }}>
        <SettingsView />
      </PermissionContext.Provider>,
    );

    expect(screen.getByRole("button", { name: "About Disciplines" })).toBeEnabled();
    expect(screen.getByRole("switch", { name: "Use disciplines" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Group resources by engagement" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Days" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Monday" })).toBeDisabled();
    expect(screen.getByRole("cell", { name: "Test Co" })).toBeInTheDocument();
  });
});

describe("SettingsView — global working days", () => {
  it("renders one abbreviated heading row above one checkbox row", () => {
    render(<SettingsView />);

    const table = screen.getByRole("table", { name: "Company working days" });
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((heading) => heading.textContent),
    ).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]) {
      expect(within(table).getByRole("checkbox", { name: day })).toBeInTheDocument();
    }
  });

  it("defaults to the first five days and persists checkbox changes", async () => {
    const user = userEvent.setup();
    render(<SettingsView />);

    for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]) {
      expect(screen.getByRole("checkbox", { name: day })).toBeChecked();
    }
    expect(screen.getByRole("checkbox", { name: "Saturday" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Sunday" })).not.toBeChecked();

    await user.click(screen.getByRole("checkbox", { name: "Friday" }));
    await user.click(screen.getByRole("checkbox", { name: "Saturday" }));

    expect(useStore.getState().data.accounts.find((account) => account.id === DEFAULT_ACCOUNT_ID)?.workingDays).toEqual(
      [1, 2, 3, 4, 6],
    );
  });

  it("reorders from Sunday without changing an explicit saved selection", () => {
    useStore.getState().updateAccount(DEFAULT_ACCOUNT_ID, { workingDays: [1, 3, 5], weekStartsOn: 0 });
    render(<SettingsView />);

    expect(screen.getAllByRole("checkbox").map((checkbox) => checkbox.id)).toEqual([
      "account-working-day-0",
      "account-working-day-1",
      "account-working-day-2",
      "account-working-day-3",
      "account-working-day-4",
      "account-working-day-5",
      "account-working-day-6",
    ]);
    expect(screen.getAllByRole("columnheader").map((heading) => heading.textContent)).toEqual([
      "Sun",
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
    ]);
    expect(screen.getByRole("checkbox", { name: "Monday" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Wednesday" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Friday" })).toBeChecked();
    expect(useStore.getState().data.accounts[0]?.workingDays).toEqual([1, 3, 5]);
  });
});

describe("SettingsView — Internal work colours", () => {
  it("defaults to Grey and stores Use colour palette on the active account", async () => {
    const user = userEvent.setup();
    render(<SettingsView />);

    const grey = screen.getByRole("radio", { name: "Grey" });
    const palette = screen.getByRole("radio", { name: "Use colour palette" });
    expect(grey).toHaveAttribute("aria-checked", "true");
    expect(palette).toHaveAttribute("aria-checked", "false");

    await user.click(palette);

    const account = useStore.getState().data.accounts.find((candidate) => candidate.id === DEFAULT_ACCOUNT_ID);
    expect(account?.internalColourMode).toBe("palette");
    expect(palette).toHaveAttribute("aria-checked", "true");
  });
});

describe("SettingsView — theme", () => {
  it("reflects the current preference and switches it on click", async () => {
    const user = userEvent.setup();
    render(<SettingsView />);

    const light = screen.getByRole("radio", { name: "Light" });
    const dark = screen.getByRole("radio", { name: "Dark" });
    expect(light).toHaveAttribute("aria-checked", "true");
    expect(dark).toHaveAttribute("aria-checked", "false");

    await user.click(dark);

    expect(useStore.getState().theme).toBe("dark");
    expect(dark).toHaveAttribute("aria-checked", "true");
    // The choice is reflected onto <html> for the CSS to key off.
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});

describe("SettingsView — build stamp", () => {
  // buildStamp() reads the env at render time, so stubbing before render is enough here
  // (the server/demo suffix is exercised in buildInfo.test.ts, where modules are reset).
  // Server is the default mode now (no demo flag), so the stamp reads `· server`.
  afterEach(() => vi.unstubAllEnvs());

  it("renders nothing when VITE_CAPACITYLENS_BUILD_SHA is unset (today's Settings)", () => {
    render(<SettingsView />);
    expect(screen.queryByTestId("build-stamp")).not.toBeInTheDocument();
    expect(screen.getByTestId("persistence-diagnostics")).toHaveTextContent("Failed saves: 0");
  });

  it("renders the muted footer when the build is stamped", () => {
    vi.stubEnv("VITE_CAPACITYLENS_BUILD_SHA", "a1b2c3d");
    render(<SettingsView />);
    expect(screen.getByTestId("build-stamp")).toHaveTextContent("build a1b2c3d · server");
  });

  it("renders no Send feedback link by default, and a stamped mailto when configured", () => {
    const { unmount } = render(<SettingsView />);
    expect(screen.queryByTestId("send-feedback")).not.toBeInTheDocument();
    unmount();

    vi.stubEnv("VITE_CAPACITYLENS_FEEDBACK_MAILTO", "owner@example.com");
    vi.stubEnv("VITE_CAPACITYLENS_BUILD_SHA", "a1b2c3d");
    render(<SettingsView />);
    const link = screen.getByTestId("send-feedback");
    expect(link).toHaveTextContent("Send feedback");
    expect(link).toHaveAttribute(
      "href",
      `mailto:owner@example.com?subject=${encodeURIComponent("CapacityLens feedback — build a1b2c3d · server")}`,
    );
  });
});

describe("SettingsView — Import & export card (issue #169)", () => {
  it("keeps the import/export tools closed by default above the final account-options card", async () => {
    const user = userEvent.setup();
    render(<SettingsView />);

    expect(screen.getByRole("heading", { name: "Import & export" })).toBeInTheDocument();
    const disclosure = screen.getByRole("button", { name: "Import & export" });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("export-data")).not.toBeInTheDocument();

    await user.click(disclosure);
    expect(screen.getByTestId("export-data")).toHaveTextContent("Export JSON");
    expect(screen.getByTestId("import-data")).toHaveTextContent("Import JSON");
    expect(screen.getByTestId("import-input")).toHaveAttribute("type", "file");

    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings.at(-1)).toBe("Account Options Selected at Creation");
  });
});

describe("SettingsView — Account section (auth)", () => {
  it("renders no Account section by default (auth off / demo build — today's Settings)", () => {
    render(<SettingsView />);
    expect(screen.queryByRole("heading", { name: "Account" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
  });

  it("shows who is signed in plus Sign out when the server reports an auth mode", async () => {
    const user = userEvent.setup();
    const signOut = vi.fn().mockResolvedValue(undefined);
    render(
      <AuthContext.Provider
        value={{
          authMode: "password",
          user: { id: "u1", email: "tester@capacitylens.dev" },
          canCreateAccount: true,
          multiAccount: true,
          refreshAuth: async () => {},
          signOut,
        }}
      >
        <SettingsView />
      </AuthContext.Provider>,
    );
    expect(screen.getByRole("heading", { name: "Account" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "About Account" })).toHaveAttribute("title", "About Account");
    expect(screen.getByRole("button", { name: "About Offline access" })).toHaveAttribute(
      "title",
      "About Offline access",
    );
    expect(screen.getByText(/Signed in as tester@capacitylens\.dev/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalled();
  });

  it("runs only one offline activation when the switch is triggered twice", async () => {
    let finishActivation!: () => void;
    offlineMocks.setEnabled.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishActivation = () => {
            offlineMocks.enabled = true;
            resolve();
          };
        }),
    );
    render(
      <AuthContext.Provider
        value={{
          authMode: "password",
          user: { id: "u1", email: "tester@capacitylens.dev" },
          canCreateAccount: true,
          multiAccount: true,
          refreshAuth: async () => {},
          signOut: async () => {},
        }}
      >
        <SettingsView />
      </AuthContext.Provider>,
    );

    const toggle = screen.getByRole("switch", { name: "Make this device available offline" });
    fireEvent.click(toggle);
    fireEvent.click(toggle);

    expect(offlineMocks.setEnabled).toHaveBeenCalledTimes(1);
    expect(toggle).toBeDisabled();
    finishActivation();
    await waitFor(() => expect(toggle).toBeEnabled());
  });
});

describe("SettingsView — Schedule (minimise weekends)", () => {
  it("reflects the default-on preference and toggles it through the store", async () => {
    const user = userEvent.setup();
    useStore.getState().setMinimiseWeekends(true); // deterministic starting point (device-global pref)
    render(<SettingsView />);

    const sw = screen.getByRole("switch", { name: "Minimise weekends" });
    expect(sw).toHaveAttribute("aria-checked", "true"); // default on

    await user.click(sw);
    expect(useStore.getState().minimiseWeekends).toBe(false);
    expect(sw).toHaveAttribute("aria-checked", "false");

    await user.click(sw);
    expect(useStore.getState().minimiseWeekends).toBe(true);
    expect(sw).toHaveAttribute("aria-checked", "true");
  });
});

describe("SettingsView — account toggle wiring", () => {
  it.each([
    ["Use disciplines", "disciplinesEnabled"],
    ["Group resources by engagement", "groupResourcesByEngagement"],
    ["Show placeholders", "placeholdersEnabled"],
    ["Show external resources", "externalEnabled"],
    ["Show internal projects", "showInternalProjects"],
    ["Show internal activities", "showInternalActivities"],
    ["Inline activity creation", "inlineActivityCreateEnabled"],
  ] as const)("wires %s to account.%s", async (label, key) => {
    const user = userEvent.setup();
    render(<SettingsView />);
    const before = useStore.getState().data.accounts.find((account) => account.id === DEFAULT_ACCOUNT_ID)?.[key];

    await user.click(screen.getByRole("switch", { name: label }));

    const after = useStore.getState().data.accounts.find((account) => account.id === DEFAULT_ACCOUNT_ID)?.[key];
    expect(after).toBe(
      !(
        before ??
        (key === "disciplinesEnabled" ||
          key === "groupResourcesByEngagement" ||
          key.startsWith("showInternal") ||
          key === "inlineActivityCreateEnabled")
      ),
    );
  });
});

describe("SettingsView — device preference toggle wiring", () => {
  it("wires Snap to week start to its own preference", async () => {
    const user = userEvent.setup();
    const before = useStore.getState().snapToWeekStart;
    render(<SettingsView />);
    await user.click(screen.getByRole("switch", { name: "Snap to week start" }));
    expect(useStore.getState().snapToWeekStart).toBe(!before);
  });

  it.each([
    ["Show client name", "showClient"],
    ["Show project name", "showProject"],
  ] as const)("wires %s to barLabelPrefs.%s", async (label, key) => {
    const user = userEvent.setup();
    const before = useStore.getState().barLabelPrefs[key];
    render(<SettingsView />);
    await user.click(screen.getByRole("switch", { name: label }));
    expect(useStore.getState().barLabelPrefs[key]).toBe(!before);
  });

  it.each([
    ["Show Total Utilisation", "showTotal"],
    ["Show Discipline Utilisation", "showDiscipline"],
    ["Show Personal Utilisation", "showPersonal"],
  ] as const)("wires %s to utilizationPrefs.%s", async (label, key) => {
    const user = userEvent.setup();
    const before = useStore.getState().utilizationPrefs[key];
    render(<SettingsView />);
    await user.click(screen.getByRole("switch", { name: label }));
    expect(useStore.getState().utilizationPrefs[key]).toBe(!before);
  });
});

describe("SettingsView — switch target size (WCAG 2.5.8 AA, ≥24px)", () => {
  // The shared ShadCN Switch uses the default 24×40px size. Real geometry is also covered by E2E.
  it('renders the role="switch" control at the h-6 (24px) target-size floor', () => {
    render(<SettingsView />);
    const sw = screen.getByRole("switch", { name: "Minimise weekends" });
    expect(sw).toHaveAttribute("data-size", "default");
    expect(sw.className).toContain("data-[size=default]:h-6");
    expect(sw.className).toContain("data-[size=default]:w-10");
  });
});

describe("SettingsView — Clear local storage", () => {
  // The action calls window.location.reload(); jsdom's reload is non-configurable, so we replace
  // the whole location with a stub carrying a spy (restored after each test).
  const realLocation = window.location;
  let reload: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...realLocation, reload },
    });
    localStorage.clear();
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: realLocation,
    });
    localStorage.clear();
  });

  const openDeviceData = async (user: ReturnType<typeof userEvent.setup>) => {
    const disclosure = screen.getByRole("button", { name: "Device data" });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("clear-local-storage")).not.toBeInTheDocument();
    await user.click(disclosure);
  };

  it("shows a destructive Clear device data button that opens a confirm modal", async () => {
    const user = userEvent.setup();
    render(<SettingsView />);
    await openDeviceData(user);

    const button = screen.getByTestId("clear-local-storage");
    expect(button).toHaveTextContent("Clear device data");
    // No modal until clicked.
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    await user.click(button);
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent(/Clear device data\?/i);
    expect(dialog).toHaveTextContent(/cannot be undone/i);
  });

  it("Cancel is a no-op — it neither clears storage nor reloads", async () => {
    const user = userEvent.setup();
    localStorage.setItem("capacitylens/offlineRead", "on");
    localStorage.setItem("capacitylens/theme", "dark");
    render(<SettingsView />);
    await openDeviceData(user);

    await user.click(screen.getByTestId("clear-local-storage"));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(localStorage.getItem("capacitylens/offlineRead")).toBe("on");
    expect(localStorage.getItem("capacitylens/theme")).toBe("dark");
    expect(reload).not.toHaveBeenCalled();
  });

  it("Confirm clears every capacitylens/ key and reloads", async () => {
    const user = userEvent.setup();
    localStorage.setItem("capacitylens/offlineRead", "on");
    localStorage.setItem("capacitylens/theme", "dark");
    localStorage.setItem("unrelated", "leave-me"); // a sibling tool's key must survive
    render(<SettingsView />);
    await openDeviceData(user);

    await user.click(screen.getByTestId("clear-local-storage"));
    // Scope to the alert dialog — the section button and confirm action share the label.
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Clear device data",
      }),
    );

    expect(localStorage.getItem("capacitylens/offlineRead")).toBeNull();
    expect(localStorage.getItem("capacitylens/theme")).toBeNull();
    expect(localStorage.getItem("unrelated")).toBe("leave-me");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("locks both confirmation actions while device cleanup is in flight", async () => {
    let finishCleanup!: () => void;
    offlineMocks.clearAll.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishCleanup = resolve;
        }),
    );
    const user = userEvent.setup();
    render(<SettingsView />);
    await openDeviceData(user);
    await user.click(screen.getByTestId("clear-local-storage"));
    const dialog = screen.getByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Clear device data" });
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });

    await user.click(confirm);

    expect(offlineMocks.clearAll).toHaveBeenCalledTimes(1);
    expect(confirm).toBeDisabled();
    expect(cancel).toBeDisabled();
    fireEvent.click(confirm);
    expect(offlineMocks.clearAll).toHaveBeenCalledTimes(1);

    finishCleanup();
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
  });
});

describe("SettingsView — account options selected at creation", () => {
  it("shows the four frozen values in a compact read-only table at the bottom", () => {
    render(<SettingsView />);

    const heading = screen.getByRole("heading", { name: "Account Options Selected at Creation" });
    const card = heading.closest('[data-slot="card"]');
    expect(card).not.toBeNull();
    const table = within(card as HTMLElement).getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByRole("cell", { name: "Test Co" })).toBeInTheDocument();
    expect(within(table).getByRole("cell", { name: "Monday" })).toBeInTheDocument();
    expect(within(table).getByRole("cell", { name: "GMT (UTC+00:00)" })).toBeInTheDocument();
    expect(screen.getByTestId("settings-language")).toHaveTextContent("English");
    for (const cell of [...within(table).getAllByRole("rowheader"), ...within(table).getAllByRole("cell")]) {
      expect(cell).toHaveClass("py-1");
      expect(cell).not.toHaveClass("py-2");
    }
    expect(screen.queryByLabelText("Company name")).not.toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Week starts on" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Time zone" })).not.toBeInTheDocument();
  });

  it("moves the frozen explanation into the section help modal", async () => {
    const user = userEvent.setup();
    render(<SettingsView />);

    expect(screen.queryByText(/cannot be changed here/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "About Account Options Selected at Creation" }));
    const dialog = screen.getByRole("dialog", { name: "Account Options Selected at Creation" });
    expect(within(dialog).getByText(/cannot be changed here/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/sets which day starts the week/i)).toBeInTheDocument();
  });
});
