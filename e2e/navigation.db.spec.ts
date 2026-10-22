import { test, expect } from "./dbFixtures";
import { API, resetServer } from "./serverTestState";
import { waitForAppLanding } from "./browserTestSupport";

test.describe("single-company reload entry", () => {
  test.beforeEach(async ({ request }) => {
    await resetServer({ request: request, withSeed: false });
  });

  test("opens and resumes a deep route without a company picker", async ({ page, request }) => {
    const created = await request.post(`${API}/api/orgs`, { data: { name: "Wayne Enterprises" } });
    expect(created.status()).toBe(201);
    const company = (await created.json()) as { id: string };

    await page.goto("/clients");
    await waitForAppLanding(page, page.locator("#main"));
    await expect(page.getByRole("heading", { name: "Clients", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Choose a company" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Switch company/i })).toHaveCount(0);

    const reload = await page.reload();
    expect([200, 304]).toContain(reload?.status());
    await expect(page).toHaveURL(/\/clients$/);
    await expect(page.getByRole("heading", { name: "Clients", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Choose a company" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Switch company/i })).toHaveCount(0);

    const deleted = await request.delete(`${API}/api/accounts/${company.id}`, {
      headers: {
        "Idempotency-Key": `e2e-single-company-delete-${company.id}`,
        "X-Account-Command-Id": `e2e-single-company-delete-${company.id}`,
      },
    });
    expect(deleted.status()).toBe(204);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Setup the account Owner" })).toBeVisible();
    await expect(page).toHaveURL(/\/clients$/);
    await expect(page.locator("#main")).toHaveCount(0);
  });
});
