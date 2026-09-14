import { act } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeAccount, makeAppData, DEFAULT_ACCOUNT_ID } from "../test/fixtures";
import { useStore } from "../store/useStore";
import { AppShell } from "./AppShell";
import { AuthContext, type AuthContextValue } from "../auth/authContext";
import { buildProductOrientationKey } from "../lib/productOrientation";

const serverFlag = vi.hoisted(() => ({ on: false }));
vi.mock("../data/apiConfig", () => ({
  API_BASE: "",
  isDemoMode: () => !serverFlag.on,
  isServerConfigured: () => serverFlag.on,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  serverFlag.on = false;
  useStore.getState().setFakeSignedIn(true);
  useStore.getState().replaceAll(makeAppData({ accounts: [makeAccount()] }));
  useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID);
  useStore.getState().setHydrated(true);
  localStorage.setItem("capacitylens/productOrientation/v1/demo/acct-test", "dismissed");
});

function authenticatedAuth(userId: string): AuthContextValue {
  const subjectNames: Record<string, string> = {
    "user-a": "Bruce Wayne",
    "user-b": "Tony Stark",
    "viewer-user": "Bruce Wayne",
  };
  return {
    authMode: "password",
    user: { id: userId, name: subjectNames[userId] ?? "Bruce Wayne" },
    canCreateAccount: true,
    multiAccount: true,
    refreshAuth: async () => {},
    signOut: async () => {},
  };
}

function shellTree(path: string, auth?: AuthContextValue) {
  const shell = (
    <MemoryRouter initialEntries={[path]}>
      <AppShell />
    </MemoryRouter>
  );
  return auth ? <AuthContext.Provider value={auth}>{shell}</AuthContext.Provider> : shell;
}

function renderShell(path = "/", auth?: AuthContextValue) {
  return render(shellTree(path, auth));
}

describe("AppShell product orientation", () => {
  it("shows guidance without blocking the schedule and persists dismissal for the active company", async () => {
    localStorage.removeItem("capacitylens/productOrientation/v1/demo/acct-test");
    const user = userEvent.setup();
    renderShell();

    expect(screen.getByRole("region", { name: "How CapacityLens works" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Schedule" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Got it" }));

    expect(screen.queryByRole("region", { name: "How CapacityLens works" })).not.toBeInTheDocument();
    expect(localStorage.getItem("capacitylens/productOrientation/v1/demo/acct-test")).toBe("dismissed");
  });

  it("can be reopened from the permanent sidebar action and returns focus on dismissal", async () => {
    const user = userEvent.setup();
    renderShell();
    const trigger = screen.getByRole("button", { name: "How CapacityLens works" });

    await user.click(trigger);
    await waitFor(() => expect(screen.getByRole("heading", { name: "How CapacityLens works" })).toHaveFocus());
    await user.click(screen.getByRole("button", { name: "Got it" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("refocuses and scrolls the heading when the visible orientation is explicitly activated", async () => {
    localStorage.removeItem("capacitylens/productOrientation/v1/demo/acct-test");
    const user = userEvent.setup();
    renderShell();
    const heading = screen.getByRole("heading", { name: "How CapacityLens works" });
    const trigger = screen.getByRole("button", { name: "How CapacityLens works" });
    trigger.focus();

    await user.click(trigger);

    expect(heading).toHaveFocus();
  });

  it("keeps a failed storage dismissal suppressed for the current mount", async () => {
    localStorage.removeItem("capacitylens/productOrientation/v1/demo/acct-test");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation((key) => {
      if (String(key).includes("productOrientation")) throw new Error("blocked");
    });
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("region", { name: "How CapacityLens works" })).not.toBeInTheDocument();
  });

  it("scopes the no-company Account view to a stable account-state segment", async () => {
    useStore.getState().setActiveAccount(null);
    localStorage.removeItem("capacitylens/productOrientation/v1/demo/no-company");
    const user = userEvent.setup();
    renderShell("/account");

    expect(screen.getByRole("region", { name: "How CapacityLens works" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(localStorage.getItem("capacitylens/productOrientation/v1/demo/no-company")).toBe("dismissed");
  });

  it("keeps the collapsed sidebar action keyboard-discoverable with a rich tooltip", async () => {
    renderShell();
    act(() => useStore.getState().setSidebarOpen(false));

    const trigger = screen.getByRole("button", { name: "How CapacityLens works" });
    act(() => trigger.focus());
    expect(await screen.findByRole("tooltip", { name: "How CapacityLens works" })).toBeVisible();
  });

  it("closes the mobile sidebar when its orientation action is activated", async () => {
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
    const user = userEvent.setup();
    renderShell();
    const topTrigger = within(screen.getByRole("main")).getByRole("button", { name: "Expand menu" });
    await user.click(topTrigger);
    await user.click(screen.getByRole("button", { name: "How CapacityLens works" }));

    expect(topTrigger).toHaveAttribute("aria-expanded", "false");
    const heading = screen.getByRole("heading", { name: "How CapacityLens works" });
    expect(heading).not.toHaveFocus();
    await waitFor(() => expect(heading).toHaveFocus());
    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(topTrigger).toHaveFocus();
  });

  it("scopes guidance to the authenticated subject when the signed-in user changes", async () => {
    const firstSubject = authenticatedAuth("user-a");
    const secondSubject = authenticatedAuth("user-b");
    localStorage.removeItem(buildProductOrientationKey("user-a", DEFAULT_ACCOUNT_ID));
    localStorage.removeItem(buildProductOrientationKey("user-b", DEFAULT_ACCOUNT_ID));
    const user = userEvent.setup();
    const view = renderShell("/", firstSubject);

    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("region", { name: "How CapacityLens works" })).not.toBeInTheDocument();

    view.rerender(shellTree("/", secondSubject));
    expect(screen.getByRole("region", { name: "How CapacityLens works" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Got it" }));

    view.rerender(shellTree("/", firstSubject));
    expect(screen.queryByRole("region", { name: "How CapacityLens works" })).not.toBeInTheDocument();
  });

  it("follows company A to B to A without leaking dismissal between companies", async () => {
    const accountA = makeAccount({ id: "acct-a", name: "Wayne Enterprises" });
    const accountB = makeAccount({ id: "acct-b", name: "Stark Industries" });
    useStore.getState().replaceAll(makeAppData({ accounts: [accountA, accountB] }));
    useStore.getState().setAccountSummaries([
      { id: accountA.id, name: accountA.name, role: "owner" },
      { id: accountB.id, name: accountB.name, role: "owner" },
    ]);
    useStore.getState().setActiveAccount(accountA.id);
    localStorage.removeItem(buildProductOrientationKey("user-a", accountA.id));
    localStorage.removeItem(buildProductOrientationKey("user-a", accountB.id));
    const user = userEvent.setup();
    renderShell("/", authenticatedAuth("user-a"));

    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("region", { name: "How CapacityLens works" })).not.toBeInTheDocument();

    act(() => useStore.getState().setActiveAccount(accountB.id));
    await waitFor(() => expect(screen.getByRole("region", { name: "How CapacityLens works" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Got it" }));

    act(() => useStore.getState().setActiveAccount(accountA.id));
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "How CapacityLens works" })).not.toBeInTheDocument(),
    );
  });

  it("keeps the orientation action available to an authenticated Viewer", async () => {
    serverFlag.on = true;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/accounts")) {
          return Promise.resolve(
            new Response(JSON.stringify([{ id: DEFAULT_ACCOUNT_ID, name: "Wayne Enterprises", role: "viewer" }]), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ active: false }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }),
    );
    localStorage.removeItem(buildProductOrientationKey("viewer-user", DEFAULT_ACCOUNT_ID));

    renderShell("/", authenticatedAuth("viewer-user"));

    expect(await screen.findByTestId("active-role")).toHaveTextContent("Viewer");
    expect(screen.getByRole("button", { name: "How CapacityLens works" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "How CapacityLens works" })).toBeInTheDocument();
  });

  it("preserves focus on an unrelated control across an ordinary shell rerender", async () => {
    const auth = authenticatedAuth("user-a");
    localStorage.removeItem(buildProductOrientationKey("user-a", DEFAULT_ACCOUNT_ID));
    const view = renderShell("/", auth);
    const heading = screen.getByRole("heading", { name: "How CapacityLens works" });
    await waitFor(() => expect(heading).toHaveFocus());
    const unrelatedControl = screen.getByRole("link", { name: "Schedule" });
    unrelatedControl.focus();

    view.rerender(shellTree("/", auth));

    expect(unrelatedControl).toHaveFocus();
  });
});
