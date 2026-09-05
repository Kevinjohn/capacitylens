import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { resetStoreWithAccount, makeResource } from "../../test/fixtures";
import { ExternalResourceSection } from "./ExternalResourceSection";

beforeEach(() => resetStoreWithAccount());

const acme = makeResource({ id: "ext-acme", kind: "external", name: "Acme Studio", role: "Partner" });
const zed = makeResource({ id: "ext-zed", kind: "external", name: "Zed Films", role: "Partner" });

function renderSection(externals = [acme]) {
  const onAdd = vi.fn();
  const onEdit = vi.fn();
  const onRequestArchive = vi.fn();

  render(
    <ExternalResourceSection externals={externals} onAdd={onAdd} onEdit={onEdit} onRequestArchive={onRequestArchive} />,
  );

  return { onAdd, onEdit, onRequestArchive };
}

describe("ExternalResourceSection", () => {
  it("calls onAdd from both add actions when the section is empty", () => {
    const { onAdd } = renderSection([]);

    fireEvent.click(screen.getByRole("button", { name: "Add external party" }));
    fireEvent.click(screen.getByRole("button", { name: "Add an external party" }));

    expect(onAdd).toHaveBeenCalledTimes(2);
  });

  it("renders external rows in the provided order", () => {
    renderSection([acme, zed]);

    const rows = screen.getAllByTestId("external-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("Acme Studio")).toBeInTheDocument();
  });

  it("passes the selected external to onEdit", () => {
    const { onEdit } = renderSection();

    fireEvent.click(screen.getByRole("button", { name: "Edit Acme Studio" }));

    expect(onEdit).toHaveBeenCalledWith(acme);
  });

  it("requests archive without calling the add or edit handlers", () => {
    const { onAdd, onEdit, onRequestArchive } = renderSection();

    fireEvent.click(screen.getByRole("button", { name: "Archive Acme Studio" }));

    expect(onRequestArchive).toHaveBeenCalledWith(acme);
    expect(onEdit).not.toHaveBeenCalled();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("labels the section with the External heading", () => {
    renderSection();

    expect(screen.getByRole("heading", { name: "External" })).toHaveAttribute("id", "external-heading");
  });
});
