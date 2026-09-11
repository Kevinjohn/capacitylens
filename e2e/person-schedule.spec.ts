import { expect, test } from "./fixtures";
import {
  boundingBoxOrThrow,
  dismissLandscapeHint,
  goToSeedWeek,
  nudgeScheduler,
  openApp,
  probeSchedulerGeometry,
  resetSchedulerScroll,
  setTheme,
  setZoom,
  showScheduleFilters,
} from "./helpers";

test.use({ contextOptions: { reducedMotion: "reduce" } });

async function assertReadOnlySchedule(page: import("@playwright/test").Page) {
  const sheet = page.getByRole("dialog", { name: "Bruce Wayne's schedule" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute("aria-modal", "true");
  await expect(page.getByTestId("person-schedule-sheet")).toHaveCount(1);
  await expect(page.getByTestId("person-schedule-entry")).toHaveCount(3);
  // Visual Design is tentative and hidden in the grid, but the personal view ignores that filter.
  await expect(sheet).toContainText("Visual Design");
  await expect(sheet).toContainText("Long weekend");
  await expect(sheet.getByTestId("person-schedule-header")).toContainText(
    /\d{1,2} [A-Z][a-z]{2} – \d{1,2} [A-Z][a-z]{2}/,
  );
  await expect(sheet.getByTestId("person-schedule-header")).not.toContainText(/Four weeks:|2026/);
  await expect(sheet).not.toContainText(/Confirmed|Tentative|Completed|Series through/);
  await expect(sheet.getByRole("button", { name: /Edit|Delete|Save|Duplicate|Reassign/ })).toHaveCount(0);
  return sheet;
}

async function assertGridPreserved(
  page: import("@playwright/test").Page,
  grid: import("@playwright/test").Locator,
  before: { scrollLeft: number; scrollTop: number; leftDate: string },
  gridElement: Awaited<ReturnType<import("@playwright/test").Locator["elementHandle"]>>,
) {
  expect(
    await page.getByTestId("scheduler-grid").evaluate((node, original) => node.isSameNode(original), gridElement),
  ).toBe(true);
  expect(await grid.evaluate((node) => (node as HTMLElement).scrollLeft)).toBe(before.scrollLeft);
  expect(await grid.evaluate((node) => (node as HTMLElement).scrollTop)).toBe(before.scrollTop);
  expect((await probeSchedulerGeometry(page)).leftDate).toBe(before.leftDate);
  await expect(page.getByLabel("Search people")).toHaveValue("Bruce");
  await expect(page.getByLabel("Filter by project")).toHaveText("All projects");
  await expect(page.getByRole("radio", { name: "Hide tentative", includeHidden: true })).toBeChecked();
}

async function prepareFilteredGrid(page: import("@playwright/test").Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  const snap = page.getByRole("switch", { name: "Snap to week start" });
  await snap.click();
  await expect(snap).toHaveAttribute("aria-checked", "false");
  await page.getByRole("link", { name: "Schedule" }).click();
  await setZoom(page, 4);
  await goToSeedWeek(page);
  await showScheduleFilters(page);
  await page.getByRole("radio", { name: "Hide tentative" }).click();
  await page.getByLabel("Search people").fill("Bruce");
  await resetSchedulerScroll(page);
  await nudgeScheduler(page, 5);

  const grid = page.getByTestId("scheduler-grid");
  const gridElement = await grid.elementHandle();
  const before = {
    scrollLeft: await grid.evaluate((node) => (node as HTMLElement).scrollLeft),
    scrollTop: await grid.evaluate((node) => (node as HTMLElement).scrollTop),
    leftDate: (await probeSchedulerGeometry(page)).leftDate,
  };
  return { grid, gridElement, before };
}

function registerPreservationScenario() {
  test("opens as one read-only modal and preserves the grid state", async ({ page }) => {
    const { grid, gridElement, before } = await prepareFilteredGrid(page);
    const trigger = page.getByRole("button", { name: "View Bruce Wayne's schedule" });
    await expect(trigger).toHaveAttribute("title", "View Bruce Wayne's schedule");
    await trigger.click();
    const sheet = await assertReadOnlySchedule(page);
    const sheetBox = await sheet.boundingBox();
    expect(sheetBox).not.toBeNull();
    expect(sheetBox!.width).toBe(400);
    expect(sheetBox!.x + sheetBox!.width).toBeCloseTo(1440, 0);
    await assertGridPreserved(page, grid, before, gridElement);
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(await grid.evaluate((node) => (node as HTMLElement).scrollLeft)).toBe(before.scrollLeft);
  });
}

function registerLayoutScenario() {
  test("traps focus, closes with Escape, and fits compact and narrow layouts", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    const normalTrigger = page.getByRole("button", { name: "View Bruce Wayne's schedule" });
    const normalRow = page.getByTestId("scheduler-row").filter({ hasText: "Bruce Wayne" });
    const normalRowBox = await normalRow.boundingBox();
    expect(normalRowBox).not.toBeNull();
    expect(normalRowBox!.height).toBeGreaterThanOrEqual(60);
    await normalTrigger.click();

    const dialog = page.getByRole("dialog", { name: "Bruce Wayne's schedule" });
    const close = dialog.getByRole("button", { name: "Close" });
    await expect(close).toBeFocused();
    for (let tab = 0; tab < 4; tab += 1) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(normalTrigger).toBeFocused();

    await page.getByRole("link", { name: "Settings", exact: true }).click();
    const compact = page.getByRole("switch", { name: "Compact view" });
    await compact.click();
    await expect(compact).toHaveAttribute("aria-checked", "true");
    await page.getByRole("link", { name: "Schedule" }).click();
    const compactRow = page.getByTestId("scheduler-row").filter({ hasText: "Bruce Wayne" });
    const compactRowBox = await compactRow.boundingBox();
    expect(compactRowBox).not.toBeNull();
    expect(compactRowBox!.height).toBeLessThan(normalRowBox!.height);
    await compactRow.getByRole("button", { name: "View Bruce Wayne's schedule" }).click();
    await expect(page.getByRole("dialog", { name: "Bruce Wayne's schedule" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Bruce Wayne's schedule" })).toHaveCount(0);

    await page.setViewportSize({ width: 520, height: 800 });
    await dismissLandscapeHint(page);
    const narrowTrigger = page.getByRole("button", { name: "View Bruce Wayne's schedule" });
    await expect(narrowTrigger).toBeVisible();
    await narrowTrigger.click();
    const narrowSheet = page.getByRole("dialog", { name: "Bruce Wayne's schedule" });
    await expect(narrowSheet).toBeVisible();
    const narrowBox = await narrowSheet.boundingBox();
    expect(narrowBox).not.toBeNull();
    expect(narrowBox!.width).toBeLessThanOrEqual(520);
    expect(narrowBox!.x).toBeGreaterThanOrEqual(0);
    expect(narrowBox!.x + narrowBox!.width).toBeLessThanOrEqual(520);
    await page.keyboard.press("Escape");
    await expect(narrowSheet).toHaveCount(0);
  });
}

test("opens from the trigger with both keyboard activation keys", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  const trigger = page.getByRole("button", { name: "View Bruce Wayne's schedule" });

  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Bruce Wayne's schedule" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await page.keyboard.press("Space");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("uses the avatar as the sole trigger with resting, hover, and focus cues", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  const trigger = page.getByRole("button", { name: "View Bruce Wayne's schedule" });
  const triggerBox = await boundingBoxOrThrow(trigger);
  expect(triggerBox.width).toBe(28);
  expect(triggerBox.height).toBe(28);

  const avatar = trigger.getByTestId("person-schedule-avatar");
  const eye = trigger.getByTestId("person-schedule-eye");
  await expect(avatar).toHaveCSS("opacity", "1");
  await expect(eye).toHaveCSS("opacity", "0");
  await trigger.hover();
  await expect(avatar).toHaveCSS("opacity", "0");
  await expect(eye).toHaveCSS("opacity", "1");
  await page.mouse.move(900, 700);
  for (
    let tabs = 0;
    tabs < 30 && !(await trigger.evaluate((element) => element === document.activeElement));
    tabs += 1
  ) {
    await page.keyboard.press("Tab");
  }
  await expect(trigger).toBeFocused();
  await expect(avatar).toHaveCSS("opacity", "0");
  await expect(eye).toHaveCSS("opacity", "1");
  await expect(trigger).toHaveCSS("cursor", "pointer");

  const identityColumn = page
    .getByTestId("scheduler-row")
    .filter({ hasText: "Bruce Wayne" })
    .locator('[role="rowheader"]');
  const identityBox = await boundingBoxOrThrow(identityColumn);
  expect(identityBox.width).toBe(256);
});

test("renders the drawer and wrap-safe entries in the dark theme", async ({ page }) => {
  await setTheme(page, "dark");
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  const trigger = page.getByRole("button", { name: "View Bruce Wayne's schedule" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Bruce Wayne's schedule" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("person-schedule-entry")).toHaveCount(3);
  const colours = await dialog.evaluate((element) => {
    const styles = getComputedStyle(element);
    return { background: styles.backgroundColor, foreground: styles.color };
  });
  expect(colours.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(colours.foreground).not.toBe("");
});

test.describe("Individual schedule drawer", () => {
  registerPreservationScenario();
  registerLayoutScenario();
});
