import { test, expect, type Page } from "./fixtures";
import { openApp } from "./helpers";

async function editOrder(page: Page, rowTestId: string): Promise<string[]> {
  return page
    .getByTestId(rowTestId)
    .getByRole("button", { name: /^Edit / })
    .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")?.replace(/^Edit /, "") ?? ""));
}

test("management lists show the seeded records alphabetically", async ({ page }) => {
  await openApp(page, "Wayne Enterprises", "/resources");
  await expect
    .poll(() => editOrder(page, "resource-row"))
    .toEqual(["Barry Allen", "Bruce Wayne", "Clark Kent", "Diana Prince"]);

  await page.getByRole("link", { name: "Disciplines", exact: true }).click();
  await expect.poll(() => editOrder(page, "discipline-row")).toEqual(["Copywriting", "Design", "Development"]);

  await page.getByRole("link", { name: "Clients", exact: true }).click();
  await expect.poll(() => editOrder(page, "client-row")).toEqual(["LexCorp", "Queen Consolidated"]);

  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await expect.poll(() => editOrder(page, "project-row")).toEqual(["Metropolis Rebrand", "Project Watchtower"]);
});
