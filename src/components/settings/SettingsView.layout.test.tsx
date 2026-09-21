import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsView } from "./SettingsView";
import { useStore } from "../../store/useStore";
import { resetStoreWithAccount, DEFAULT_ACCOUNT_ID } from "../../test/fixtures";
import { PermissionContext } from "../../auth/permissionContext";

vi.mock("../../data/offlineCache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../data/offlineCache")>()),
  isOfflineReadEnabled: () => false,
}));

beforeEach(() => {
  resetStoreWithAccount();
  useStore.getState().setTheme("light");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        server: {
          connectivity: "ok",
          database: { status: "ok", schemaVersion: 38 },
          persistence: "unknown",
          backup: { status: "unavailable", lastSuccessAt: null },
        },
      }),
    }),
  );
});

describe("SettingsView — grouped information architecture", () => {
  it("groups company, feature, device and support controls in the agreed heading order", () => {
    render(<SettingsView />);

    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([
      "Company setup",
      "Scheduling features",
      "My display",
      "Data and support",
    ]);
    const company = screen.getByRole("region", { name: "Company setup" });
    const features = screen.getByRole("region", { name: "Scheduling features" });
    const display = screen.getByRole("region", { name: "My display" });
    const support = screen.getByRole("region", { name: "Data and support" });
    expect(within(company).getByText(/Company setting/)).toBeVisible();
    expect(within(company).getByRole("radio", { name: "Days" })).toBeVisible();
    expect(within(company).getByRole("table", { name: "Company working days" })).toBeVisible();
    expect(within(company).getByRole("heading", { name: "Date format", level: 3 })).toBeVisible();
    expect(within(company).getByRole("switch", { name: "Use disciplines" })).toBeVisible();
    expect(within(company).getByRole("switch", { name: "Group resources by engagement" })).toBeVisible();
    expect(within(company).getByRole("radio", { name: "Everyone" })).toBeVisible();
    for (const heading of [
      "Placeholders and external resources",
      "Internal work colours",
      "Internal work",
      "Activity creation",
      "Allocation task field",
    ]) {
      expect(within(features).getByRole("heading", { name: heading, level: 3 })).toBeVisible();
    }
    expect(within(display).getByText(/This device/)).toBeVisible();
    for (const heading of [
      "Schedule on this device",
      "Allocation labels on this device",
      "Utilisation figures on this device",
      "Appearance on this device",
    ]) {
      expect(within(display).getByRole("heading", { name: heading, level: 3 })).toBeVisible();
    }
    for (const heading of ["Device data", "Import and export", "Company details", "Build details", "Diagnostics"]) {
      expect(within(support).getByRole("heading", { name: heading, level: 3 })).toBeVisible();
    }
    expect(within(support).getByTestId("settings-build-details")).toBeVisible();
    expect(within(support).getByText(/Read-only company details/)).toBeVisible();
    expect(within(support).getByText(/Support information/)).toBeVisible();
  });

  it("keeps device controls usable for viewers within the device group", async () => {
    const user = userEvent.setup();
    render(
      <PermissionContext.Provider value={{ role: "viewer", status: "resolved" }}>
        <SettingsView />
      </PermissionContext.Provider>,
    );
    const company = screen.getByRole("region", { name: "Company setup" });
    expect(within(company).getByRole("radio", { name: "Everyone" })).toBeDisabled();
    const display = screen.getByRole("region", { name: "My display" });
    const compact = within(display).getByRole("switch", { name: "Compact view" });
    const before = useStore.getState().compactView;
    expect(compact).toBeEnabled();
    await user.click(compact);
    expect(useStore.getState().compactView).toBe(!before);
  });

  it("retains the existing permission exceptions during a masquerade transition", () => {
    useStore.getState().setMasquerade({
      kind: "starting",
      pending: { accountId: DEFAULT_ACCOUNT_ID, targetUserId: "u-viewer" },
      generation: 1,
    });
    try {
      render(
        <PermissionContext.Provider value={{ role: "owner", status: "resolved" }}>
          <SettingsView />
        </PermissionContext.Provider>,
      );
      expect(screen.getByRole("switch", { name: "Use disciplines" })).toBeDisabled();
      expect(screen.getByRole("radio", { name: "Days" })).toBeDisabled();
      expect(screen.getByRole("radio", { name: "Everyone" })).toBeEnabled();
      expect(screen.getByRole("switch", { name: "Compact view" })).toBeEnabled();
      expect(screen.queryByTestId("archived-section")).not.toBeInTheDocument();
    } finally {
      useStore.getState().setMasquerade({ kind: "inactive" });
    }
  });

  it("keeps Deleted items inside Data and support when its existing access gate resolves", async () => {
    render(<SettingsView />);
    const support = screen.getByRole("region", { name: "Data and support" });
    const deleted = await within(support).findByRole("heading", { name: "Deleted items", level: 3 });
    expect(deleted).toBeVisible();
    expect(within(support).getByRole("button", { name: "Deleted items" })).toHaveAttribute("aria-expanded", "false");
  });
});
