import { test, expect } from "./fixtures";
import { openApp } from "./helpers";
import { resetServer } from "./db-helpers";

// DB-backed flavour of the date-format preference (US-SET-17, issue #866). The demo project
// cannot carry this assertion: its in-memory store restores the seed on every reload, so a
// surviving choice there would prove nothing. Here the reload re-hydrates purely from
// GET /api/state, so the choice coming back proves the full round-trip
// UI → store → ServerSyncAdapter → PATCH → SQLite `accounts.dateStyle` → GET on reload.
test.describe("Settings — date format is account data", () => {
  test.beforeEach(async ({ request }) => {
    await resetServer(request, true);
  });

  test("the company's choice survives a reload", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/settings");
    await page.getByRole("radio", { name: "Sep 9", exact: true }).click();
    await expect(page.getByRole("radio", { name: "Sep 9", exact: true })).toHaveAttribute("aria-checked", "true");

    await page.reload();
    // Re-pick the company after reload (activeAccountId is never persisted) and re-open Settings.
    await page.getByRole("button", { name: "Wayne Enterprises", exact: true }).click();
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("radio", { name: "Sep 9", exact: true })).toHaveAttribute("aria-checked", "true");
  });
});
