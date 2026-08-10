import { test, expect } from "./fixtures";
import { openApp } from "./helpers";

// Covers US-SET-08 — the Settings "Clear device data" action.
test.describe("Settings — Clear device data", () => {
  test("Cancel is a no-op; confirm clears owned device data, preserves unrelated data, and reloads", async ({
    page,
  }) => {
    await openApp(page, "Wayne Enterprises", "/settings");

    await page.evaluate(() => {
      localStorage.setItem("capacitylens/test-owned", "remove me");
      localStorage.setItem("unrelated/test-key", "keep me");
      return new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("capacitylens-offline-v1", 2);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains("records")) {
            request.result.createObjectStore("records", { keyPath: "key" });
          }
          if (!request.result.objectStoreNames.contains("keys")) {
            request.result.createObjectStore("keys", { keyPath: "id" });
          }
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("records", "readwrite");
          tx.objectStore("records").put({ key: "test-snapshot", savedAt: Date.now(), value: "remove me" });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    });

    const button = page.getByTestId("clear-local-storage");
    await expect(button).toBeVisible();
    await expect(button).toHaveText("Clear device data");

    // Opening the modal shows the accurate, minimal copy (this browser + cannot be undone).
    await button.click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("Clear device data?");
    await expect(dialog).toContainText(/THIS browser/i);
    await expect(dialog).toContainText(/cannot be undone/i);

    // Cancel closes the modal and leaves the app intact — the seeded data is untouched.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.getByTestId("clear-local-storage")).toBeVisible();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("capacitylens/test-owned"))).toBe("remove me");

    // Confirm performs the destructive boundary and reloads the app.
    await button.click();
    const reloaded = page.waitForEvent("load");
    await page.getByRole("alertdialog").getByRole("button", { name: "Clear device data" }).click();
    await reloaded;

    expect(await page.evaluate(() => localStorage.getItem("capacitylens/test-owned"))).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem("unrelated/test-key"))).toBe("keep me");
    expect(
      await page.evaluate(
        () =>
          new Promise<number>((resolve, reject) => {
            const request = indexedDB.open("capacitylens-offline-v1", 2);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const db = request.result;
              const count = db.transaction("records", "readonly").objectStore("records").count();
              count.onsuccess = () => {
                db.close();
                resolve(count.result);
              };
              count.onerror = () => reject(count.error);
            };
          }),
      ),
    ).toBe(0);

    // The demo reload proves scheduling data is not browser-owned: the canonical company data is
    // still available after passing back through the cleared device gates.
    await openApp(page);
    await expect(page.getByText("Bruce Wayne")).toBeVisible();
  });
});
