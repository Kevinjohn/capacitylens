import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { RestorationCleanupDialog } from "./RestorationCleanupDialog";
import { completeRestorationCleanup, requestRestorationCleanup } from "./restorationCleanupConfirmation";

afterEach(() => completeRestorationCleanup(false));
describe("Restore cleanup dialog", () => {
  it("stays absent without pending items and cancels without authorizing a save", async () => {
    render(<RestorationCleanupDialog />);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    let result!: Promise<boolean>;
    act(() => {
      result = requestRestorationCleanup(3, new AbortController().signal);
    });
    expect(screen.getByRole("alertdialog")).toHaveTextContent("This change clears 3 restorable items");
    expect(screen.getByRole("alertdialog")).toHaveTextContent("including unrelated deleted items");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await expect(result).resolves.toBe(false);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
  it("authorizes only an explicit confirmation and cancels on context abort", async () => {
    render(<RestorationCleanupDialog />);
    let result!: Promise<boolean>;
    act(() => {
      result = requestRestorationCleanup(2, new AbortController().signal);
    });
    await userEvent.click(screen.getByRole("button", { name: "Save change" }));
    await expect(result).resolves.toBe(true);
    const context = new AbortController();
    act(() => {
      result = requestRestorationCleanup(1, context.signal);
    });
    act(() => context.abort());
    await expect(result).resolves.toBe(false);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
