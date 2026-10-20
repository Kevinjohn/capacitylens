import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { resetLocalStorage, StorageRecovery, StorageResetError } from "./StorageRecovery";

describe("resetLocalStorage", () => {
  it("clears application preferences and reloads", async () => {
    const clearLocalStorage = vi.fn();
    const reload = vi.fn();

    await resetLocalStorage({ clearLocalStorage, reload });

    expect(clearLocalStorage).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("surfaces a local storage failure without reloading", async () => {
    const cause = new Error("localStorage blocked");
    const clearLocalStorage = vi.fn(() => {
      throw cause;
    });
    const reload = vi.fn();

    await expect(resetLocalStorage({ clearLocalStorage, reload })).rejects.toMatchObject({
      name: "StorageResetError",
      cause,
    });
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("StorageRecovery confirmation", () => {
  it("keeps stored bytes untouched until the destructive reset is confirmed", () => {
    const onDownload = vi.fn();
    const onReset = vi.fn();
    render(<StorageRecovery onDownload={onDownload} onReset={onReset} />);

    fireEvent.click(screen.getByRole("button", { name: "Download raw copy" }));
    expect(onDownload).toHaveBeenCalledOnce();
    expect(onReset).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Reset data" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("permanently discards the unreadable data");
    expect(onReset).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onReset).not.toHaveBeenCalled();
  });

  it("runs the reset only after confirmation", async () => {
    const onReset = vi.fn().mockResolvedValue(undefined);
    render(<StorageRecovery onReset={onReset} />);

    fireEvent.click(screen.getByRole("button", { name: "Reset data" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Reset" }));

    await waitFor(() => expect(onReset).toHaveBeenCalledOnce());
  });
});

describe("StorageRecovery errors", () => {
  it("surfaces download and reset failures", async () => {
    const onReset = vi.fn().mockRejectedValue(new StorageResetError());
    render(
      <StorageRecovery
        onDownload={() => {
          throw new Error("blocked");
        }}
        onReset={onReset}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Download raw copy" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t read the stored bytes");
    fireEvent.click(screen.getByRole("button", { name: "Reset data" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Reset" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t reset the stored data");
    expect(screen.getByRole("button", { name: "Reset data" })).toBeEnabled();
  });
});
