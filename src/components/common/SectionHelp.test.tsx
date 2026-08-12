import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SectionHelp } from "./SectionHelp";

describe("SectionHelp", () => {
  it("keeps help hidden until its labelled action opens the titled modal", async () => {
    const user = userEvent.setup();
    render(<SectionHelp title="External">External help</SectionHelp>);

    expect(screen.queryByText("External help")).not.toBeInTheDocument();
    const action = screen.getByRole("button", { name: "About External" });
    expect(action).toHaveAttribute("title", "About External");

    await user.click(action);
    const dialog = screen.getByRole("dialog", { name: "External" });
    expect(within(dialog).getByText("External help")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "External" })).not.toBeInTheDocument();
  });
});
