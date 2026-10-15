import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SettingsSection } from "./SettingsSection";
import { SettingsGroup } from "./SettingsGroup";

describe("SettingsSection", () => {
  it("uses compact rows only inside a labelled Settings group and retains independent disclosures", async () => {
    const user = userEvent.setup();
    render(
      <>
        <SettingsGroup title="Data and support" description="Tools for your data">
          <SettingsSection
            title="Device data"
            help="Device help"
            description="This device"
            collapsible
            defaultOpen={false}
          >
            <p>Device controls</p>
          </SettingsSection>
          <SettingsSection title="Import and export" help="Import help" collapsible defaultOpen={false}>
            <p>Company controls</p>
          </SettingsSection>
        </SettingsGroup>
        <SettingsSection title="Security" help="Security help">
          <p>Account controls</p>
        </SettingsSection>
      </>,
    );
    const group = screen.getByRole("region", { name: "Data and support" });
    expect(within(group).getByRole("heading", { level: 3, name: "Device data" })).toBeVisible();
    expect(within(group).getByText("This device")).toBeVisible();
    expect(group.querySelector('[data-slot="card"]')).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Security" }).closest('[data-slot="card"]')).not.toBeNull();
    const device = within(group).getByRole("button", { name: "Device data" });
    await user.click(device);
    expect(document.getElementById(device.getAttribute("aria-controls") ?? "")).toHaveTextContent("Device controls");
    expect(within(group).getByRole("button", { name: "Import and export" })).toHaveAttribute("aria-expanded", "false");
    await user.click(within(group).getByRole("button", { name: "About Device data" }));
    const dialog = screen.getByRole("dialog", { name: "Device data" });
    expect(within(dialog).getByText("Device help")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps fuller help out of the card and opens it from the labelled question-mark action", async () => {
    const user = userEvent.setup();
    render(
      <SettingsSection title="Schedule" help="How the week grid is drawn.">
        <p>Controls</p>
      </SettingsSection>,
    );

    expect(screen.queryByText("How the week grid is drawn.")).not.toBeInTheDocument();
    const help = screen.getByRole("button", { name: "About Schedule" });
    expect(help).toHaveAttribute("title", "About Schedule");
    const heading = screen.getByRole("heading", { name: "Schedule" });
    expect(heading.closest('[data-slot="card-header"]')).toHaveClass("flex", "items-center");
    expect(heading.parentElement).toHaveClass("flex-1");
    expect(help.parentElement).toHaveClass("self-center");

    await user.click(help);
    const dialog = screen.getByRole("dialog", { name: "Schedule" });
    expect(within(dialog).getByText("How the week grid is drawn.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Schedule" })).not.toBeInTheDocument();
  });

  it("keeps closed disclosures independent", async () => {
    const user = userEvent.setup();
    render(
      <>
        <SettingsSection title="Device data" help="Device help" collapsible defaultOpen={false}>
          <p>Device controls</p>
        </SettingsSection>
        <SettingsSection title="Import & export" help="Import help" collapsible defaultOpen={false}>
          <p>Import controls</p>
        </SettingsSection>
      </>,
    );

    const device = screen.getByRole("button", { name: "Device data" });
    const data = screen.getByRole("button", { name: "Import & export" });
    expect(device).toHaveAttribute("aria-expanded", "false");
    expect(data).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Device controls")).not.toBeInTheDocument();
    expect(screen.queryByText("Import controls")).not.toBeInTheDocument();

    await user.click(device);
    expect(device).toHaveAttribute("aria-expanded", "true");
    expect(data).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Device controls")).toBeInTheDocument();
    expect(screen.queryByText("Import controls")).not.toBeInTheDocument();
  });
});
