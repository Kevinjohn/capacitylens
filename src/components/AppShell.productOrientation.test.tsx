import { act } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeAccount, makeAppData, DEFAULT_ACCOUNT_ID } from "../test/fixtures";
import { useStore } from "../store/useStore";
import { AppShell } from "./AppShell";

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
  useStore.getState().setFakeSignedIn(true);
  useStore.getState().replaceAll(makeAppData({ accounts: [makeAccount()] }));
  useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID);
  useStore.getState().setHydrated(true);
  localStorage.setItem("capacitylens/productOrientation/v1/demo/acct-test", "dismissed");
});

function renderShell(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppShell />
    </MemoryRouter>,
  );
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
    expect(screen.getByRole("region", { name: "How CapacityLens works" })).toBeInTheDocument();
  });
});
