import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SettingsSection } from "./SettingsSection";

describe("SettingsSection", () => {
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
