import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { AppShell } from "@/components/AppShell";
import { AccountPicker } from "./AccountPicker";
import { AuthContext } from "@/auth/authContext";
import { useStore } from "@/store/useStore";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import { makeAccount, makeAppData, DEFAULT_ACCOUNT_ID } from "@/test/fixtures";
import { renderWithQueryClient as render } from "@/test/renderWithQueryClient";

const serverFlag = vi.hoisted(() => ({ on: false }));
vi.mock("@/data/apiConfig", () => ({
  API_BASE: "",
  isDemoMode: () => !serverFlag.on,
  isServerConfigured: () => serverFlag.on,
}));

vi.mock("@/auth/accountTransition", () => ({
  transitionAccount: vi.fn(async (id: string | null) => {
    useStore.getState().setActiveAccount(id);
    return true;
  }),
}));

type WithCanCreateAccountOptions = { canCreateAccount: boolean; ui: ReactNode };
function withCanCreateAccount({ canCreateAccount, ui }: WithCanCreateAccountOptions) {
  return render(
    <AuthContext.Provider
      value={{
        authMode: "off",
        user: null,
        canCreateAccount,
        refreshAuth: async () => {},
        signOut: async () => {},
      }}
    >
      {ui}
    </AuthContext.Provider>,
  );
}

function seedAccounts(...accounts: ReturnType<typeof makeAccount>[]) {
  useStore.getState().replaceAll(makeAppData({ accounts }));
  useStore
    .getState()
    .setAccountSummaries({ list: accounts.map((a) => ({ id: a.id, name: a.name, role: "owner" as const })) });
}

function requireAccount(name: string) {
  const account = useStore.getState().data.accounts.find((candidate) => candidate.name === name);
  if (!account) throw new Error(`Expected account ${name} to exist`);
  return account;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  serverFlag.on = false;
  useStore.getState().replaceAll(emptyAppData());
  useStore.getState().setActiveAccount(null);
  useStore.getState().setAccountSummaries({ list: [] });
  useStore.getState().setHydrated(true);
  useStore.getState().setNotice(null);
  // Sign through the cosmetic demo gate so AppShell renders the picker (the demo sign-in
  // sits in front of it). These tests exercise the account gate, not the demo one.
  useStore.getState().setFakeSignedIn(true);
});

function renderShell() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <AppShell />
    </MemoryRouter>,
  );
}

describe("AppShell account gate", () => {
  it("shows the AccountPicker (not the nav) when hydrated with no active account", () => {
    seedAccounts(makeAccount({ name: "Wayne Enterprises" }));
    renderShell();
    expect(screen.getByText("Choose a company")).toBeInTheDocument();
    expect(screen.getByText("Wayne Enterprises")).toBeInTheDocument();

    expect(screen.queryByRole("link", { name: "Schedule" })).not.toBeInTheDocument();
  });

  it("renders store notices as Sonner toasts while the account picker is visible", async () => {
    seedAccounts(makeAccount({ name: "Wayne Enterprises" }));
    renderShell();

    act(() => {
      useStore.getState().setNotice("Company deletion was refused.", "error");
    });

    const message = await screen.findByText("Company deletion was refused.");
    expect(message.closest("[data-sonner-toast]")).not.toBeNull();
  });

  it("shows the shell (with the active company + Switch company) once an account is active", () => {
    seedAccounts(makeAccount({ name: "Wayne Enterprises" }));
    useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID);
    renderShell();
    expect(screen.queryByText("Choose a company")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Schedule" })).toBeInTheDocument();
    expect(screen.getByText("Wayne Enterprises")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch company" })).toBeInTheDocument();
  });

  it('"Switch company" returns to the picker', async () => {
    const user = userEvent.setup();
    seedAccounts(makeAccount({ name: "Wayne Enterprises" }));
    useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID);
    renderShell();
    await user.click(screen.getByRole("button", { name: "Switch company" }));
    expect(screen.getByText("Choose a company")).toBeInTheDocument();
    expect(useStore.getState().activeAccountId).toBeNull();
  });
});

describe("AccountPicker create + open", () => {
  registerCreateAndActivateTests();
  registerCreateFormValidationTests();
  registerOpenAndEnterTests();
  registerNoCompanyDeletionTests();
});

function registerCreateAndActivateTests() {
  it("creates a company inline and activates it", async () => {
    const user = userEvent.setup();
    render(<AccountPicker />);

    expect(screen.queryByRole("heading", { name: "New company" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    const nameInput = screen.getByLabelText("Company name");
    await user.type(nameInput, "Stark Industries");
    await user.click(screen.getByRole("button", { name: "Create company" }));

    expect(useStore.getState().data.accounts.map((a) => a.name)).toContain("Stark Industries");

    const created = requireAccount("Stark Industries");
    expect(useStore.getState().activeAccountId).toBe(created.id);
  });

  it("keeps the New company heading when creating an additional company", async () => {
    const user = userEvent.setup();
    seedAccounts(makeAccount({ name: "Wayne Enterprises" }));
    render(<AccountPicker />);

    await user.click(screen.getByRole("button", { name: "New company" }));
    expect(screen.getByRole("heading", { name: "New company" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("captures week-start, timezone and language at creation and passes them to addAccount (P1.14)", async () => {
    const user = userEvent.setup();
    render(<AccountPicker />);

    expect(screen.queryByText(/Week start, timezone, and language apply/)).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Company planning settings" })).not.toHaveAttribute("aria-describedby");
    expect(screen.getByLabelText("Company name")).not.toHaveAccessibleDescription(
      "You can change the company name later; the calendar choices below are fixed after creation.",
    );

    expect(screen.getByRole("radio", { name: "Monday" })).toHaveAttribute("aria-checked", "true");
    const tz = screen.getByLabelText("Timezone");
    expect(tz).toHaveTextContent(/(?:GMT|UTC|London)/);
    expect(tz).not.toHaveAccessibleDescription();
    expect(screen.getByRole("radio", { name: "Monday" }).parentElement).not.toHaveAccessibleDescription();
    expect(screen.getByRole("combobox", { name: "Language" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Language" })).toHaveTextContent("English");
    expect(screen.getByRole("group", { name: "Language" })).not.toHaveAccessibleDescription();

    await user.click(screen.getByRole("radio", { name: "Sunday" }));
    fireEvent.keyDown(tz, { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: /Europe\/London/ }));
    await user.type(screen.getByLabelText("Company name"), "Frozen Co");
    await user.click(screen.getByRole("button", { name: "Create company" }));

    const created = requireAccount("Frozen Co");
    expect(created.weekStartsOn).toBe(0);
    expect(created.timezone).toBe("Europe/London");
    expect(created.language).toBe("en");
    // This interaction needs a longer timeout on contended CI because its modal, listbox, and typing sequence is slower than a single-field test.
  }, 15_000);

  it("detects the browser zone, searches friendly names, and selects it with the keyboard", async () => {
    const user = userEvent.setup();
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      locale: "en-GB",
      timeZone: "Europe/London",
    } as Intl.ResolvedDateTimeFormatOptions);
    render(<AccountPicker />);

    const timezone = screen.getByRole("combobox", { name: "Timezone" });
    expect(timezone).toHaveTextContent("London");
    await user.click(timezone);
    const popup = document.getElementById(timezone.getAttribute("aria-controls") ?? "");
    expect(popup).toHaveAttribute("role", "dialog");
    expect(popup).toHaveClass("max-w-[calc(100vw-1rem)]", "max-h-[calc(100dvh-1rem)]");
    const search = screen.getByRole("combobox", { name: "Search time zones" });
    expect(search).toHaveClass("min-w-0");
    await user.type(search, "London");
    await user.keyboard("{Enter}");

    expect(timezone).toHaveTextContent("London");
    expect(timezone).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(timezone);

    await user.type(screen.getByLabelText("Company name"), "Queen Industries");
    await user.click(screen.getByRole("button", { name: "Create company" }));
    await waitFor(() => expect(requireAccount("Queen Industries").timezone).toBe("Europe/London"));
  });
}

function registerCreateFormValidationTests() {
  it("validates a blank name", async () => {
    const user = userEvent.setup();
    render(<AccountPicker />);
    await user.click(screen.getByRole("button", { name: "Create company" }));
    expect(screen.getByText("Name is required.")).toBeInTheDocument();
    expect(useStore.getState().data.accounts).toHaveLength(0);
  });

  it("reopens the create form without the previous attempt's validation error", async () => {
    const user = userEvent.setup();
    seedAccounts(makeAccount({ name: "Wayne Enterprises" }));
    render(<AccountPicker />);

    await user.click(screen.getByRole("button", { name: "New company" }));
    const firstInput = screen.getByLabelText("Company name");
    await user.click(screen.getByRole("button", { name: "Create company" }));
    expect(firstInput).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Name is required.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "New company" }));

    expect(screen.getByLabelText("Company name")).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText("Name is required.")).not.toBeInTheDocument();
  });
}

function registerOpenAndEnterTests() {
  it("opens an existing company by clicking it", async () => {
    const user = userEvent.setup();
    seedAccounts(makeAccount({ name: "Wayne Enterprises" }));
    render(<AccountPicker />);
    await user.click(screen.getByRole("button", { name: "Wayne Enterprises" }));
    expect(useStore.getState().activeAccountId).toBe(DEFAULT_ACCOUNT_ID);
  });

  it("creates a company when pressing Enter in the company name input", async () => {
    const user = userEvent.setup();
    render(<AccountPicker />);

    await user.type(screen.getByLabelText("Company name"), "Enter Co");
    await user.keyboard("{Enter}");

    expect(useStore.getState().data.accounts.map((a) => a.name)).toContain("Enter Co");
    const created = requireAccount("Enter Co");
    expect(useStore.getState().activeAccountId).toBe(created.id);
  });
}

function registerNoCompanyDeletionTests() {
  it("does not offer company deletion from the picker", () => {
    seedAccounts(makeAccount({ name: "Wayne Enterprises" }));
    render(<AccountPicker />);

    expect(screen.getByRole("button", { name: "Wayne Enterprises" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Wayne Enterprises" })).not.toBeInTheDocument();
    expect(useStore.getState().data.accounts).toHaveLength(1);
  });
}

describe("AccountPicker server mode", () => {
  it("never renders production company selection or creation controls", () => {
    serverFlag.on = true;
    useStore.getState().setAccountSummaries({ list: [{ id: "a1", name: "Wayne Enterprises", role: "owner" }] });
    render(<AccountPicker />);

    expect(screen.queryByRole("button", { name: "Wayne Enterprises" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new company/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Company name")).not.toBeInTheDocument();
  });

  it("shows an actionable conflict without offering choices when the server reports ambiguity", () => {
    serverFlag.on = true;
    useStore.getState().setAccountSummaries({ list: [], complete: false, ambiguous: true });
    render(<AccountPicker />);

    expect(screen.getByRole("alert")).toHaveTextContent(/more than one company/i);
    expect(screen.queryByRole("button", { name: /company/i })).not.toBeInTheDocument();
    act(() => useStore.getState().setNotice(null));
    expect(screen.getByRole("alert")).toHaveTextContent(/more than one company/i);
    expect(screen.queryByLabelText("Company name")).not.toBeInTheDocument();
  });
});

describe("AccountPicker first-company setup", () => {
  beforeEach(() => {
    serverFlag.on = true;
    useStore.getState().setAccountSummaries({ list: [], complete: true });
  });

  it("creates the initial company through the supported server setup route", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      status: url === "/api/orgs" ? 201 : 200,
      json: async () => ({ id: "org-first", name: "Wayne Aerospace" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AccountPicker />);

    await user.type(screen.getByLabelText("Company name"), "Wayne Aerospace");
    await user.click(screen.getByRole("button", { name: "Create company" }));

    await waitFor(() => expect(useStore.getState().activeAccountId).toBe("org-first"));
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/orgs");
    expect(useStore.getState().accountSummaries.map(({ id }) => id)).toContain("org-first");
    expect(useStore.getState().data.accounts).toHaveLength(0);
  });

  it("keeps the setup form and does not activate when the server refuses first-company creation", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: "Setup refused." }) })),
    );
    render(<AccountPicker />);

    await user.type(screen.getByLabelText("Company name"), "Wayne Aerospace");
    await user.click(screen.getByRole("button", { name: "Create company" }));

    expect(await screen.findByText("Setup refused.")).toBeInTheDocument();
    expect(useStore.getState().activeAccountId).toBeNull();
    expect(useStore.getState().accountSummaries).toHaveLength(0);
  });

  it("reconciles a malformed success from the authoritative directory without rendering choices", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (url: string) =>
      url === "/api/orgs"
        ? { ok: true, status: 201, json: async () => ({ ok: true }) }
        : { ok: true, status: 200, json: async () => [{ id: "org-first", name: "Wayne Aerospace", role: "owner" }] },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<AccountPicker />);

    await user.type(screen.getByLabelText("Company name"), "Wayne Aerospace");
    await user.click(screen.getByRole("button", { name: "Create company" }));

    await waitFor(() => expect(useStore.getState().accountSummaries[0]?.id).toBe("org-first"));
    expect(useStore.getState().activeAccountId).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(screen.queryByRole("button", { name: "Wayne Aerospace" })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([url]) => url)).toContain("/api/accounts");
  });

  it("keeps setup available after an unknown response when an authoritative refresh confirms no company", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (url: string) =>
      url === "/api/orgs"
        ? { ok: false, status: 503, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => [] },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<AccountPicker />);

    await user.type(screen.getByLabelText("Company name"), "Wayne Aerospace");
    await user.click(screen.getByRole("button", { name: "Create company" }));

    await waitFor(() => expect(useStore.getState().notice?.tone).toBe("warning"));
    expect(screen.getByLabelText("Company name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create company" })).toBeEnabled();
    expect(useStore.getState().accountSummaries).toEqual([]);
  });

  it("locks retries when a successful response cannot be reconciled", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/orgs") return { ok: true, status: 201, json: async () => ({ ok: true }) };
      throw new Error("directory refresh failed");
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AccountPicker />);

    await user.type(screen.getByLabelText("Company name"), "Wayne Aerospace");
    await user.click(screen.getByRole("button", { name: "Create company" }));

    await waitFor(() => expect(screen.queryByLabelText("Company name")).not.toBeInTheDocument());
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/orgs")).toHaveLength(1);
    expect(useStore.getState().activeAccountId).toBeNull();
  });

  it("locks retries after a create transport failure when directory reconciliation also fails", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (url: string) => {
      throw new Error(url === "/api/orgs" ? "create transport failed" : "directory refresh failed");
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AccountPicker />);

    await user.type(screen.getByLabelText("Company name"), "Wayne Aerospace");
    await user.click(screen.getByRole("button", { name: "Create company" }));

    await waitFor(() => expect(screen.queryByLabelText("Company name")).not.toBeInTheDocument());
    expect(useStore.getState().notice?.message).toContain("create transport failed");
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/orgs")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Create company" })).not.toBeInTheDocument();
  });
});

describe("AccountPicker — single-company-per-instance policy (canCreateAccount)", () => {
  it('hides the "New company" button when the auth context reports the cap is reached', () => {
    seedAccounts(makeAccount({ name: "Wayne Enterprises" }));
    withCanCreateAccount({ canCreateAccount: false, ui: <AccountPicker /> });
    expect(screen.queryByTestId("new-company-button")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New company" })).not.toBeInTheDocument();

    expect(screen.getByText("Choose a company to plan.")).toBeInTheDocument();
    expect(screen.queryByText("Choose a company to plan, or create another one.")).not.toBeInTheDocument();
  });

  it('shows the "New company" button when the auth context allows another company', () => {
    seedAccounts(makeAccount({ name: "Wayne Enterprises" }));
    withCanCreateAccount({ canCreateAccount: true, ui: <AccountPicker /> });
    expect(screen.getByTestId("new-company-button")).toBeInTheDocument();
    expect(screen.getByText("Choose a company to plan, or create another one.")).toBeInTheDocument();
  });

  it("REGRESSION GUARD: no AuthContext provider (demo build / older callers) fails OPEN — button stays visible", () => {
    seedAccounts(makeAccount({ name: "Wayne Enterprises" }));
    render(<AccountPicker />);
    expect(screen.getByTestId("new-company-button")).toBeInTheDocument();
  });
});
