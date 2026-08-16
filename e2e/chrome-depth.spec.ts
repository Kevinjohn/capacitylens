import { test, expect, type Locator, type Page } from "./fixtures";
import { disableCssMotion, openApp, showScheduleFilters } from "./helpers";

async function background(locator: Locator): Promise<string> {
  return locator.evaluate((element) => getComputedStyle(element).backgroundColor);
}

async function openChrome(page: Page, theme: "light" | "dark") {
  await page.addInitScript((value) => localStorage.setItem("capacitylens/theme", value), theme);
  await openApp(page);
  await disableCssMotion(page);
  await showScheduleFilters(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

for (const theme of ["light", "dark"] as const) {
  test(`chrome bands seat controls on a distinct surface in ${theme} mode`, async ({ page }) => {
    await openChrome(page, theme);

    const toolbar = page.locator('[data-chrome-band="toolbar"]');
    const filterbar = page.locator('[data-chrome-band="filterbar"]');
    const expectedControl = theme === "light" ? "rgb(255, 255, 255)" : "rgb(20, 20, 20)";

    await expect(toolbar).toHaveCSS("background-color", theme === "light" ? "rgb(211, 211, 207)" : "rgb(26, 26, 26)");
    await expect(filterbar).toHaveCSS("background-color", theme === "light" ? "rgb(226, 226, 223)" : "rgb(36, 36, 36)");

    const controls = [
      toolbar.getByRole("button", { name: "Today", exact: true }),
      toolbar.getByRole("combobox", { name: "Weeks visible" }),
      filterbar.getByRole("textbox", { name: "Search people" }),
      filterbar.getByRole("combobox", { name: "Discipline" }),
      filterbar.getByRole("button", { name: "Clear filters" }),
    ];
    for (const control of controls) expect(await background(control)).toBe(expectedControl);
  });
}
