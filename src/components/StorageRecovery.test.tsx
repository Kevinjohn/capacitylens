import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { resetLocalStorage, StorageRecovery, StorageResetError } from "./StorageRecovery";

describe("resetLocalStorage", () => {
  it("attempts both backends and reloads after both clear successfully", async () => {
    const clearOfflineData = vi.fn().mockResolvedValue(undefined);
    const clearLocalStorage = vi.fn();
    const notify = vi.fn();
    const reload = vi.fn();

    await resetLocalStorage({ clearOfflineData, clearLocalStorage, notify, reload });

    expect(clearOfflineData).toHaveBeenCalledOnce();
    expect(clearLocalStorage).toHaveBeenCalledOnce();
    expect(clearOfflineData.mock.invocationCallOrder[0]).toBeLessThan(clearLocalStorage.mock.invocationCallOrder[0]!);
    expect(notify).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("still clears local storage and reloads when the offline backend rejects", async () => {
    const clearOfflineData = vi.fn().mockRejectedValue(new Error("IndexedDB blocked"));
    const clearLocalStorage = vi.fn();
    const notify = vi.fn();
    const reload = vi.fn();

    await resetLocalStorage({ clearOfflineData, clearLocalStorage, notify, reload });

    expect(clearOfflineData).toHaveBeenCalledOnce();
    expect(clearLocalStorage).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(
      "The unreadable browser data was reset, but offline snapshots could not be cleared. Offline access remains disabled. The app will now reload.",
    );
    expect(reload).toHaveBeenCalledOnce();
  });

  it("reloads after a successful local clear even if the partial-failure notice throws", async () => {
    const reload = vi.fn();

    await expect(
      resetLocalStorage({
        clearOfflineData: vi.fn().mockRejectedValue(new Error("IndexedDB blocked")),
        clearLocalStorage: vi.fn(),
        notify: vi.fn(() => {
          throw new Error("notice blocked");
        }),
        reload,
      }),
    ).rejects.toThrow("notice blocked");

    expect(reload).toHaveBeenCalledOnce();
  });

  it("reports a partial failure without reloading when only local storage fails", async () => {
    const clearOfflineData = vi.fn().mockResolvedValue(undefined);
    const clearLocalStorage = vi.fn(() => {
      throw new Error("localStorage blocked");
    });
    const reload = vi.fn();

    await expect(resetLocalStorage({ clearOfflineData, clearLocalStorage, reload })).rejects.toMatchObject({
      name: "StorageResetError",
      offlineDataCleared: true,
    });
    expect(clearOfflineData).toHaveBeenCalledOnce();
    expect(clearLocalStorage).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
  });

  it("reports a full failure after both backend attempts fail", async () => {
    const clearOfflineData = vi.fn().mockRejectedValue(new Error("IndexedDB blocked"));
    const clearLocalStorage = vi.fn(() => {
      throw new Error("localStorage blocked");
    });
    const reload = vi.fn();

    await expect(resetLocalStorage({ clearOfflineData, clearLocalStorage, reload })).rejects.toMatchObject({
      name: "StorageResetError",
      offlineDataCleared: false,
    });
    expect(clearOfflineData).toHaveBeenCalledOnce();
    expect(clearLocalStorage).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("StorageRecovery", () => {
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

  it("surfaces a download failure without enabling an implicit reset", () => {
    const onReset = vi.fn();
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
    expect(onReset).not.toHaveBeenCalled();
  });

  it("reports a rejected reset as a reset failure and allows another attempt", async () => {
    const onReset = vi.fn().mockRejectedValue(new Error("storage blocked"));
    render(<StorageRecovery onReset={onReset} />);

    fireEvent.click(screen.getByRole("button", { name: "Reset data" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Reset" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t reset the stored data");
    expect(screen.getByRole("button", { name: "Reset data" })).toBeEnabled();
    expect(screen.queryByText("Couldn’t read the stored bytes")).not.toBeInTheDocument();
  });

  it.each([
    [
      true,
      "Offline snapshots were cleared, but the unreadable browser data could not be reset. Check your browser’s storage/privacy settings and try again.",
    ],
    [
      false,
      "Neither the unreadable browser data nor offline snapshots could be cleared. Check your browser’s storage/privacy settings and try again.",
    ],
  ])("surfaces the specific backend outcome after a reset failure", async (offlineDataCleared, message) => {
    const onReset = vi.fn().mockRejectedValue(new StorageResetError(offlineDataCleared));
    render(<StorageRecovery onReset={onReset} />);

    fireEvent.click(screen.getByRole("button", { name: "Reset data" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Reset" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });
});
