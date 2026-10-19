import { expect, test } from "./fixtures";
import type { APIRequestContext, Page } from "./fixtures";
import { openApp } from "./browserTestSupport";
import { API, resetServer } from "./serverTestState";

type Availability = { id: string; firstAvailableDate: string | null; lastAvailableDate: string | null };

async function persistedAvailability(request: APIRequestContext): Promise<Availability> {
  const response = await request.get(`${API}/api/state`);
  expect(response.status()).toBe(200);
  const state = (await response.json()) as { resources: Availability[] };
  const resource = state.resources.find(({ id }) => id === "r-tyler");
  if (!resource) throw new Error("The seeded person must survive availability edits");
  expect(resource).toHaveProperty("firstAvailableDate");
  expect(resource).toHaveProperty("lastAvailableDate");
  return resource;
}

async function saveAvailability(page: Page, first: string, last: string): Promise<void> {
  const row = page.getByTestId("resource-row").filter({ hasText: "Bruce Wayne" });
  await row.getByRole("button", { name: "Edit Bruce Wayne" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit resource" });
  await dialog.getByLabel("Start date", { exact: true }).fill(first);
  await dialog.getByLabel("End date", { exact: true }).fill(last);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

test("clearing, saving, reloading and undoing availability keeps explicit null values", async ({ page, request }) => {
  await resetServer({ request, withSeed: true });
  await openApp(page, "Wayne Enterprises", "/resources");
  await saveAvailability(page, "2026-06-01", "2026-06-30");
  await expect
    .poll(async () => {
      const row = await persistedAvailability(request);
      return [row.firstAvailableDate, row.lastAvailableDate];
    })
    .toEqual(["2026-06-01", "2026-06-30"]);

  await saveAvailability(page, "", "");
  await expect
    .poll(async () => {
      const row = await persistedAvailability(request);
      return [row.firstAvailableDate, row.lastAvailableDate];
    })
    .toEqual([null, null]);
  await openApp(page, "Wayne Enterprises", "/resources");
  await saveAvailability(page, "2026-06-05", "2026-06-25");
  await expect
    .poll(async () => {
      const row = await persistedAvailability(request);
      return [row.firstAvailableDate, row.lastAvailableDate];
    })
    .toEqual(["2026-06-05", "2026-06-25"]);

  await page.getByRole("link", { name: "Schedule", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(async () => {
      const row = await persistedAvailability(request);
      return [row.firstAvailableDate, row.lastAvailableDate];
    })
    .toEqual([null, null]);
  await openApp(page, "Wayne Enterprises", "/resources");
  await page
    .getByTestId("resource-row")
    .filter({ hasText: "Bruce Wayne" })
    .getByRole("button", { name: "Edit Bruce Wayne" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Edit resource" });
  await expect(dialog.getByLabel("Start date", { exact: true })).toHaveValue("");
  await expect(dialog.getByLabel("End date", { exact: true })).toHaveValue("");
});
