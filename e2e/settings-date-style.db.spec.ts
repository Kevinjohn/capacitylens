import { test, expect } from "./dbFixtures";
import { openApp } from "./browserTestSupport";
import { resetServer, serverState, requireStateRows } from "./serverTestState";

// DB-backed flavour of the date-format preference (US-SET-17). The demo project
// cannot carry this assertion: its in-memory store restores the seed on every reload, so a
// surviving choice there would prove nothing. Here the reload re-hydrates purely from
// GET /api/state, so the choice coming back proves the full round-trip
// UI → store → ServerSyncAdapter → PATCH → SQLite `accounts.dateStyle` → GET on reload.
test.describe("Settings — date format is account data", () => {
  test.beforeEach(async ({ request }) => {
    await resetServer({ request: request, withSeed: true });
  });

  test("the company's choice survives a reload", async ({ page, request }) => {
    await openApp(page, "Wayne Enterprises", "/settings");
    await page.getByRole("radio", { name: "Sep 9", exact: true }).click();
    await expect(page.getByRole("radio", { name: "Sep 9", exact: true })).toHaveAttribute("aria-checked", "true");

    // The control reads back from the store immediately, but the write to the server is debounced.
    // Reloading before it lands would fail on the round trip the next assertion is testing.
    await expect
      .poll(
        async () =>
          requireStateRows(await serverState(request), "accounts").some(
            (account) => (account as { dateStyle?: string }).dateStyle === "month-day",
          ),
        { timeout: 10_000 },
      )
      .toBe(true);

    await page.reload();
    // The single-company server summary restores the company and the current Settings route.
    await expect(page.getByRole("heading", { name: "Choose a company" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Switch company/i })).toHaveCount(0);
    await expect(page.getByRole("radio", { name: "Sep 9", exact: true })).toHaveAttribute("aria-checked", "true");
  });
});
