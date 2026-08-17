import { test, expect, type Locator, type Page } from "./fixtures";
import {
  computedStyles,
  disableCssMotion,
  expectConnectedSelectionEdges,
  openApp,
  setTheme,
  showScheduleFilters,
} from "./helpers";

function luminance(cssColor: string): number {
  const channels = cssColor
    .match(/[\d.]+/g)
    ?.slice(0, 3)
    .map(Number);
  if (!channels || channels.length !== 3) throw new Error(`Unsupported computed colour: ${cssColor}`);
  const linear = channels.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

async function openChrome(page: Page, theme: "light" | "dark") {
  await setTheme(page, theme);
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
    const surfaces = await Promise.all(
      [page.getByTestId("app-sidebar"), toolbar, filterbar, page.getByTestId("scheduler-grid")].map(async (locator) =>
        luminance((await computedStyles(locator, ["background-color"]))["background-color"]),
      ),
    );
    expect(surfaces[0]).toBeLessThan(surfaces[1]!);
    expect(surfaces[1]).toBeLessThan(surfaces[2]!);
    expect(surfaces[2]).toBeLessThan(surfaces[3]!);

    const controls = [
      toolbar.getByRole("button", { name: "Today", exact: true }),
      toolbar.getByRole("combobox", { name: "Weeks visible" }),
      filterbar.getByRole("textbox", { name: "Search people" }),
      filterbar.getByRole("combobox", { name: "Discipline" }),
      filterbar.getByRole("button", { name: "Clear filters" }),
    ];
    for (const control of controls) {
      const controlBackground = (await computedStyles(control, ["background-color"]))["background-color"];
      const band = (await control.evaluate((element) =>
        element.closest("[data-chrome-band]")?.getAttribute("data-chrome-band"),
      ))!;
      const bandLocator = page.locator(`[data-chrome-band="${band}"]`);
      const bandBackground = (await computedStyles(bandLocator, ["background-color"]))["background-color"];
      expect(controlBackground).not.toBe(bandBackground);
    }
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

for (const theme of ["light", "dark"] as const) {
  test(`all eight segmented-control contexts render the shared geometry in ${theme} mode`, async ({ page }) => {
    await openChrome(page, theme);

    const drawMode = page.getByRole("radiogroup", { name: "Draw mode" });
    await expectSegmentGeometry(drawMode, { trackRadius: "6px", itemRadius: "4px", gap: "2px" });
    const tentativeVisibility = page.getByRole("radiogroup", { name: "Tentative visibility" });
    await expectSegmentGeometry(tentativeVisibility, { trackRadius: "6px", itemRadius: "4px", gap: "2px" });

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
    await activity.getByRole("button", { name: "Cancel", exact: true }).click();

    await page.getByRole("link", { name: "Settings", exact: true }).click();
    for (const name of ["Scheduling input", "Internal work colours", "Theme"]) {
      const group = page.getByRole("radiogroup", { name });
      await expectSegmentGeometry(group, {
        trackRadius: "7px",
        itemRadius: "5px",
        gap: "2px",
      });
    }

    await page.getByRole("button", { name: "Switch company", exact: true }).click();
    await page.getByRole("button", { name: "New company" }).click();
    await expectSegmentGeometry(page.getByRole("radiogroup", { name: "Week starts on" }), {
      trackRadius: "7px",
      itemRadius: "5px",
      gap: "2px",
    });
  });
}
