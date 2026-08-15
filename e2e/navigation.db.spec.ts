import { test, expect } from "./fixtures";
import { API, resetServer } from "./db-helpers";
import { dismissIntroIfPresent } from "./helpers";

test.describe("single-company reload entry", () => {
  test.beforeEach(async ({ request }) => {
    await resetServer(request, false);
  });

  test("resumes a deep route once, but keeps first entry and explicit switching on the picker", async ({
    page,
    request,
  }) => {
    const created = await request.post(`${API}/api/orgs`, { data: { name: "Wayne Enterprises" } });
    expect(created.status()).toBe(201);
    const company = (await created.json()) as { id: string; name: string };

    await page.goto("/clients");
    const picker = page.getByRole("heading", { name: "Choose a company" });
    await expect(picker).toBeVisible();
    await page.getByRole("button", { name: company.name, exact: true }).click();
    await dismissIntroIfPresent(page, page.locator("#main"));
    await expect(page.getByRole("heading", { name: "Clients", exact: true })).toBeVisible();

    const reload = await page.reload();
    expect([200, 304]).toContain(reload?.status());
    await expect(page).toHaveURL(/\/clients$/);
    await expect(page.getByRole("heading", { name: "Clients", exact: true })).toBeVisible();
    await expect(picker).toHaveCount(0);

    await page.getByRole("button", { name: "Switch company" }).click();
    await expect(picker).toBeVisible();
    await expect(page).toHaveURL(/\/clients$/);

    await page.getByRole("button", { name: company.name, exact: true }).click();
    await expect(page.getByRole("heading", { name: "Clients", exact: true })).toBeVisible();

    const deleted = await request.delete(`${API}/api/accounts/${company.id}`, {
      headers: {
        "Idempotency-Key": `e2e-single-company-delete-${company.id}`,
        "X-Account-Command-Id": `e2e-single-company-delete-${company.id}`,
      },
    });
    expect(deleted.status()).toBe(204);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Start planning" })).toBeVisible();
    await expect(page).toHaveURL(/\/clients$/);
    await expect(page.locator("#main")).toHaveCount(0);
  });
});
