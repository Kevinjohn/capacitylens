import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "./fixtures";
import { disableCssMotion, openApp } from "./helpers";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const groups = ["Company setup", "Scheduling features", "My display", "Data and support"];
const disclosures = ["Device data", "Deleted items", "Import and export"];

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
  const table = page.getByRole("table", { name: "Company working days" });
  await expect(table).toBeVisible();
  await expect(table.getByRole("columnheader")).toHaveText(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  await expect(table.getByRole("checkbox")).toHaveCount(7);
  const box = await table.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  const switches = await page.getByRole("switch").all();
  expect(switches.length).toBeGreaterThan(0);
  for (const control of switches) {
    const target = await control.boundingBox();
    expect(target).not.toBeNull();
    expect(target!.width).toBeGreaterThanOrEqual(24);
    expect(target!.height).toBeGreaterThanOrEqual(24);
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
    // Closing one row must preserve the other rows' independently expanded state.
    const device = page.getByRole("button", { name: "Device data", exact: true });
    await device.focus();
    await page.keyboard.press("Space");
    await expect(device).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("button", { name: "Deleted items", exact: true })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(page.getByRole("button", { name: "Import and export", exact: true })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
}

test("help restores focus and destructive confirmation supports keyboard cancellation", async ({ page }) => {
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

  const device = page.getByRole("button", { name: "Device data", exact: true });
  await device.focus();
  await page.keyboard.press("Enter");
  const clear = page.getByRole("button", { name: "Clear device data", exact: true });
  await clear.focus();
  await page.keyboard.press("Enter");
  const confirmation = page.getByRole("alertdialog", { name: "Clear device data?", exact: true });
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole("button", { name: "Clear device data", exact: true })).toBeVisible();
  await assertAccessible(page);
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(confirmation).toBeHidden();
  await expect(page.getByRole("button", { name: "Device data", exact: true })).toHaveAttribute("aria-expanded", "true");
});
