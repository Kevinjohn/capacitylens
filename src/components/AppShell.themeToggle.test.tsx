import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppShell } from "./AppShell";
import { useStore } from "../store/useStore";
import { makeAccount, makeAppData, DEFAULT_ACCOUNT_ID } from "../test/fixtures";
import { stubMatchMedia } from "../test/stubMatchMedia";

vi.mock("../data/apiConfig", () => ({
  API_BASE: "",
  isDemoMode: () => true,
  isServerConfigured: () => false,
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  useStore.getState().setFakeSignedIn(true);
  localStorage.setItem("capacitylens/productOrientation/v1/demo/acct-test", "dismissed");
  useStore.getState().replaceAll(makeAppData({ accounts: [makeAccount()] }));
  useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID);
  useStore.getState().setHydrated(true);
});

function renderAppShell() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <AppShell />
    </MemoryRouter>,
  );
}

describe("AppShell sidebar theme toggle", () => {
  it("offers an icon theme toggle directly below Settings", () => {
    act(() => useStore.getState().setTheme("light"));
    renderAppShell();

    const navigation = screen.getByRole("navigation");
    const settings = within(navigation).getByRole("link", { name: "Settings" });
    const toggle = within(navigation).getByRole("button", { name: "Switch to dark mode" });

    expect(settings.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(toggle.querySelector("svg")).toHaveAttribute("aria-hidden", "true");

    fireEvent.click(toggle);

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(localStorage.getItem("capacitylens/theme")).toBe("dark");

    act(() => useStore.getState().setSidebarOpen(false));
    fireEvent.click(within(navigation).getByRole("button", { name: "Switch to light mode" }));

    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("labels and flips the displayed scheme when the preference follows a dark OS", () => {
    stubMatchMedia((query) => query === "(prefers-color-scheme: dark)");
    act(() => useStore.getState().setTheme("system"));
    try {
      renderAppShell();

      expect(document.documentElement).toHaveAttribute("data-theme", "dark");
      const navigation = screen.getByRole("navigation");
      fireEvent.click(within(navigation).getByRole("button", { name: "Switch to light mode" }));

      expect(document.documentElement).toHaveAttribute("data-theme", "light");
      expect(localStorage.getItem("capacitylens/theme")).toBe("light");
    } finally {
      // Later tests run without matchMedia, which the toaster reads while the preference is system.
      act(() => useStore.getState().setTheme("light"));
    }
  });
});
