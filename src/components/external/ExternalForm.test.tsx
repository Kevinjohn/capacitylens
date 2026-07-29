import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { resetStoreWithAccount } from "../../test/fixtures";
import { useStore } from "../../store/useStore";
import { ExternalForm } from "./ExternalForm";

beforeEach(() => resetStoreWithAccount());

describe("ExternalForm", () => {
  it("rejects a blank company name and associates the error with the field", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ExternalForm onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Save" }));

    const company = screen.getByLabelText("Company");
    const alert = screen.getByRole("alert");
    expect(company).toHaveAttribute("aria-invalid", "true");
    expect(company).toHaveAttribute("aria-describedby", alert.id);
    expect(alert).toHaveTextContent("Company name is required.");
    expect(onClose).not.toHaveBeenCalled();
    expect(useStore.getState().data.resources).toEqual([]);
  });

  it("adds an external party with the submitted company and descriptor", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ExternalForm onClose={onClose} />);

    await user.type(screen.getByLabelText("Company"), "Pixel Forge");
    await user.type(screen.getByLabelText("Descriptor"), "Print partner");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(useStore.getState().data.resources).toHaveLength(1);
    expect(useStore.getState().data.resources[0]).toMatchObject({
      kind: "external",
      name: "Pixel Forge",
      role: "Print partner",
    });
  });

  it("prefills and updates an existing external party", async () => {
    const user = userEvent.setup();
    const resource = useStore.getState().addResource({
      kind: "external",
      name: "Northstar Partners",
      role: "Visual design",
      employmentType: "contractor",
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      color: "#737373",
    });
    const onClose = vi.fn();
    render(<ExternalForm resource={resource} onClose={onClose} />);

    expect(screen.getByLabelText("Company")).toHaveValue("Northstar Partners");
    expect(screen.getByLabelText("Descriptor")).toHaveValue("Visual design");
    await user.clear(screen.getByLabelText("Company"));
    await user.type(screen.getByLabelText("Company"), "Northstar Studio");
    await user.clear(screen.getByLabelText("Descriptor"));
    await user.type(screen.getByLabelText("Descriptor"), "Brand partner");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(useStore.getState().data.resources).toHaveLength(1);
    expect(useStore.getState().data.resources[0]).toMatchObject({
      id: resource.id,
      kind: "external",
      name: "Northstar Studio",
      role: "Brand partner",
    });
  });

  it("rejects a stale edit instead of overwriting a concurrent change", async () => {
    const user = userEvent.setup();
    const resource = useStore.getState().addResource({
      kind: "external",
      name: "Northstar Partners",
      role: "Visual design",
      employmentType: "contractor",
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      color: "#737373",
    });
    const onClose = vi.fn();
    render(<ExternalForm resource={resource} onClose={onClose} />);

    useStore.getState().updateResource(resource.id, { role: "Brand lead" });
    await user.clear(screen.getByLabelText("Company"));
    await user.type(screen.getByLabelText("Company"), "Northstar Studio");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/external party changed while you were editing/i);
    expect(onClose).not.toHaveBeenCalled();
    expect(useStore.getState().data.resources[0]).toMatchObject({
      name: "Northstar Partners",
      role: "Brand lead",
    });
  });

  it("surfaces a store rejection without closing the form", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    useStore.getState().setActiveAccount(null);
    render(<ExternalForm onClose={onClose} />);

    await user.type(screen.getByLabelText("Company"), "Unscoped partner");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert")).toHaveTextContent("No active account — cannot mutate scoped data.");
    expect(onClose).not.toHaveBeenCalled();
    expect(useStore.getState().data.resources).toEqual([]);
  });
});
