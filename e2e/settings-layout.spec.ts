import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures";
import type { Page } from "./fixtures";
import { disableCssMotion, openApp } from "./browserTestSupport";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const groups = ["Company setup", "Scheduling features", "My display", "Data and support"];
const disclosures = ["Import and export"];

async function assertAccessible(page: Page) {
  await disableCssMotion(page);
  const result = await new AxeBuilder({ page }).analyze();
  const blocking = result.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""));
  expect(
    blocking,
    JSON.stringify(
      blocking.map(({ id, nodes }) => ({ id, nodes })),
      null,
      2,
    ),
  ).toEqual([]);
}

async function assertReflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    main: (() => {
      const main = document.querySelector("main")!;
      return main.scrollWidth - main.clientWidth;
    })(),
  }));
  expect(overflow.document).toBeLessThanOrEqual(1);
  expect(overflow.main).toBeLessThanOrEqual(1);
  const group = page.getByRole("group", { name: "Company working days" });
  await expect(group).toBeVisible();
  const weekdays = group.getByRole("checkbox");
  await expect(weekdays).toHaveCount(7);
  const labels = group.locator("label");
  await expect(labels).toHaveCount(7);
  await expect(labels).toHaveText(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  const box = await group.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  for (const label of await labels.all()) {
    const target = await label.boundingBox();
    expect(target).not.toBeNull();
    expect(target!.width).toBeGreaterThanOrEqual(48);
    expect(target!.height).toBeGreaterThanOrEqual(48);
  }
  const saturdayLabel = group.getByText("Sat", { exact: true });
  await saturdayLabel.click();
  const saturdayCheckbox = group.getByRole("checkbox", { name: "Saturday" });
  await expect(saturdayCheckbox).toBeChecked();
  await saturdayCheckbox.focus();
  await page.keyboard.press("Space");
  await expect(saturdayCheckbox).not.toBeChecked();
  const switches = await page.getByRole("switch").all();
  expect(switches.length).toBeGreaterThan(0);
  for (const control of switches) {
    const target = await control.boundingBox();
    expect(target).not.toBeNull();
    expect(target!.width).toBeGreaterThanOrEqual(24);
    expect(target!.height).toBeGreaterThanOrEqual(24);
  }
  for (const name of ["Scheduling input", "Date format", "Overview access", "Theme"]) {
    const control = page.getByRole("radiogroup", { name });
    const box = await control.boundingBox();
    const row = await control.locator("xpath=..").boundingBox();
    expect(box).not.toBeNull();
    expect(row).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(row!.width - 2);
  }
}

for (const width of [1280, 390, 320]) {
  test(`Settings groups reflow and remain accessible at ${width}px, closed and expanded`, async ({ page }) => {
    test.setTimeout(60_000); // Four full-page axe scans cover the closed and expanded content.
    await page.setViewportSize({ width, height: 900 });
    // The portrait hint has its own coverage; exercise Settings underneath it here.
    if (width < 600) {
      await page.addInitScript(() => sessionStorage.setItem("capacitylens/rotateHintDismissed", "1"));
    }
    await openApp(page, "Wayne Enterprises", "/settings");
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByRole("heading", { level: 2 })).toHaveText(groups);
    for (const name of disclosures) {
      await expect(page.getByRole("button", { name, exact: true })).toHaveAttribute("aria-expanded", "false");
    }
    await assertReflow(page);
    await assertAccessible(page);

    for (const name of disclosures) {
      const trigger = page.getByRole("button", { name, exact: true });
      await trigger.focus();
      await page.keyboard.press("Enter");
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      await assertReflow(page);
      await assertAccessible(page);
    }
    await expect(page.getByRole("heading", { name: "Device data" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Deleted items" })).toHaveCount(0);
  });
}

test("Settings working-day controls remain accessible in light and dark themes", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openApp(page, "Wayne Enterprises", "/settings");
  await page.getByRole("radio", { name: "Light", exact: true }).click();
  await assertAccessible(page);

  await page.getByRole("radio", { name: "Dark", exact: true }).click();
  await assertAccessible(page);
});

test("help restores focus and removed maintenance sections stay hidden", async ({ page }) => {
  await openApp(page, "Wayne Enterprises", "/settings");
  const help = page.getByRole("button", { name: "About Company details", exact: true });
  await help.focus();
  await page.keyboard.press("Enter");
  const explanation = page.getByRole("dialog", { name: "Company details", exact: true });
  await expect(explanation).toBeVisible();
  await assertAccessible(page);
  await page.keyboard.press("Escape");
  await expect(explanation).toBeHidden();
  await expect(help).toBeFocused();
  await expect(page.getByRole("heading", { name: "Device data" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Deleted items" })).toHaveCount(0);
});
