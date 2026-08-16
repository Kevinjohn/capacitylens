import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { resetStoreWithAccount } from "../../test/fixtures";
import { ExternalForm } from "../external/ExternalForm";
import { DisciplineForm } from "../disciplines/DisciplineForm";
import { ClientForm } from "../clients/ClientForm";
import { ProjectForm } from "../projects/ProjectForm";
import { ActivityForm } from "../activities/ActivityForm";
import { TimeOffForm } from "../timeoff/TimeOffForm";

beforeEach(() => resetStoreWithAccount());

function expectCompact(control: HTMLElement) {
  expect(control.closest('[data-slot="field"]')).toHaveAttribute("data-product-layout", "label-control");
}

function expectPrivacyDescriptionWithControl() {
  const privacy = screen.getByRole("switch", { name: "Use a code name" });
  const description = screen.getByText("Only account owners can see the real name. Everyone else sees the code name.");
  expect(privacy.parentElement).toContainElement(description);
}

function expectCodeNameHintWithInput() {
  const codeName = screen.getByLabelText("Code name");
  const hint = screen.getByText("Quotation marks are added automatically.");
  expect(codeName.parentElement).toContainElement(hint);
}

describe("compact input modal layouts", () => {
  it("uses compact rows for every External and Discipline field", () => {
    const external = render(<ExternalForm onClose={vi.fn()} />);
    expectCompact(screen.getByLabelText("Company"));
    expectCompact(screen.getByLabelText("Descriptor"));
    external.unmount();

    render(<DisciplineForm onClose={vi.fn()} />);
    expectCompact(screen.getByLabelText("Name"));
    expectCompact(screen.getByRole("button", { name: /^Colour \(/ }));
  });

  it("keeps Client and Project privacy controls in the compact field layout", async () => {
    const user = userEvent.setup();
    const client = render(<ClientForm onClose={vi.fn()} />);
    expectCompact(screen.getByLabelText("Name"));
    expectCompact(screen.getByRole("switch", { name: "Use a code name" }));
    expectPrivacyDescriptionWithControl();
    expectCompact(screen.getByRole("button", { name: /^Colour \(/ }));
    await user.click(screen.getByRole("switch", { name: "Use a code name" }));
    expectCompact(screen.getByLabelText("Code name"));
    expectCodeNameHintWithInput();
    client.unmount();

    render(<ProjectForm onClose={vi.fn()} />);
    expectCompact(screen.getByLabelText("Name"));
    expectCompact(screen.getByRole("switch", { name: "Use a code name" }));
    expectPrivacyDescriptionWithControl();
    await user.click(screen.getByRole("switch", { name: "Use a code name" }));
    expectCompact(screen.getByLabelText("Code name"));
    expectCodeNameHintWithInput();
    expectCompact(screen.getByLabelText("Client"));
    expectCompact(screen.getByRole("button", { name: /^Colour \(/ }));
  });

  it("uses compact rows and equal full-width segments for the Activity kind", () => {
    render(<ActivityForm onClose={vi.fn()} />);
    expectCompact(screen.getByLabelText("Name"));
    const kind = screen.getByRole("radiogroup", { name: "Activity kind" });
    expectCompact(kind);
    expect(kind).toHaveAttribute("data-geometry", "gapped");
    expect(kind).toHaveAttribute("data-density", "compact");
    expect(kind.children).toHaveLength(3);
    expect(screen.getAllByRole("radio").map((segment) => segment.textContent)).toEqual([
      "Internal",
      "Cross-project",
      "Project-specific",
    ]);
    expectCompact(screen.getByLabelText("Project"));
  });

  it("uses compact rows for every visible Time off field", () => {
    render(<TimeOffForm onClose={vi.fn()} />);
    expectCompact(screen.getByLabelText("Resource"));
    expectCompact(screen.getByLabelText("Start"));
    expectCompact(screen.getByLabelText("End"));
    expectCompact(screen.getByLabelText("Type"));
    expectCompact(screen.getByLabelText("Note"));
  });
});
