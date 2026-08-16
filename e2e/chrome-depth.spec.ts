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

async function expectSegmentGeometry(
  group: Locator,
  expected: { trackRadius: string; itemRadius: string; gap: string; equalWidth?: boolean },
) {
  await expect(group).toHaveCSS("padding", "2px");
  await expect(group).toHaveCSS("border-radius", expected.trackRadius);
  await expect(group).toHaveCSS("column-gap", expected.gap);

  const items = group.getByRole("radio");
  const count = await items.count();
  expect(count).toBeGreaterThan(1);
  for (let index = 0; index < count; index += 1) {
    await expect(items.nth(index)).toHaveCSS("border-radius", expected.itemRadius);
    const borders = await items.nth(index).evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth];
    });
    expect(borders).toEqual(["1px", "1px", "1px", "1px"]);
  }

  if (expected.equalWidth) {
    const widths = await items.evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().width),
    );
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
  }
}

async function expectConnectedSelectionEdges(group: Locator) {
  const items = group.getByRole("radio");
  const count = await items.count();
  for (let selectedIndex = 0; selectedIndex < count; selectedIndex += 1) {
    await items.nth(selectedIndex).click();
    await expect(items.nth(selectedIndex)).toHaveAttribute("aria-checked", "true");
    await items.nth(selectedIndex).evaluate((element) => (element as HTMLElement).blur());

    const shadows = await items.evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).boxShadow),
    );
    expect(shadows[selectedIndex]).not.toContain("inset 1px 0px");
    if (selectedIndex + 1 < count) expect(shadows[selectedIndex + 1]).not.toContain("inset 1px 0px");
  }
}

for (const theme of ["light", "dark"] as const) {
  test(`all seven segmented-control contexts render the shared geometry in ${theme} mode`, async ({
    page,
  }, testInfo) => {
    await openChrome(page, theme);

    const drawMode = page.getByRole("radiogroup", { name: "Draw mode" });
    await expectSegmentGeometry(drawMode, { trackRadius: "6px", itemRadius: "4px", gap: "2px" });
    await page.screenshot({ path: testInfo.outputPath(`chrome_depth_scheduler_${theme}.png`), animations: "disabled" });

    await page.getByRole("button", { name: "Add allocation for Clark Kent" }).click();
    const allocation = page.getByRole("dialog", { name: "New allocation" });
    const status = allocation.getByRole("radiogroup", { name: "Status" });
    await expectSegmentGeometry(status, {
      trackRadius: "7px",
      itemRadius: "5px",
      gap: "0px",
      equalWidth: true,
    });
    await expectConnectedSelectionEdges(status);
    await allocation.screenshot({
      path: testInfo.outputPath(`segmented_allocation_status_${theme}.png`),
      animations: "disabled",
    });
    await allocation.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(allocation).toHaveCount(0);

    await page.getByRole("link", { name: "Activities", exact: true }).click();
    await page.getByRole("button", { name: "Add activity" }).click();
    const activity = page.getByRole("dialog", { name: "Add activity" });
    await expectSegmentGeometry(activity.getByRole("radiogroup", { name: "Activity kind" }), {
      trackRadius: "7px",
      itemRadius: "5px",
      gap: "2px",
      equalWidth: true,
    });
    await activity.screenshot({
      path: testInfo.outputPath(`segmented_activity_kind_${theme}.png`),
      animations: "disabled",
    });
    await activity.getByRole("button", { name: "Cancel", exact: true }).click();

    await page.getByRole("link", { name: "Settings", exact: true }).click();
    for (const { name, slug } of [
      { name: "Scheduling input", slug: "scheduling" },
      { name: "Internal work colours", slug: "internal_colours" },
      { name: "Theme", slug: "theme" },
    ]) {
      const group = page.getByRole("radiogroup", { name });
      await expectSegmentGeometry(group, {
        trackRadius: "7px",
        itemRadius: "5px",
        gap: "2px",
      });
      await group.screenshot({
        path: testInfo.outputPath(`segmented_settings_${slug}_${theme}.png`),
        animations: "disabled",
      });
    }
    await page.screenshot({ path: testInfo.outputPath(`segmented_settings_${theme}.png`), animations: "disabled" });

    await page.getByRole("button", { name: "Switch company", exact: true }).click();
    await page.getByRole("button", { name: "New company" }).click();
    await expectSegmentGeometry(page.getByRole("radiogroup", { name: "Week starts on" }), {
      trackRadius: "7px",
      itemRadius: "5px",
      gap: "2px",
    });
    await page.screenshot({
      path: testInfo.outputPath(`segmented_company_week_start_${theme}.png`),
      animations: "disabled",
    });
  });
}
