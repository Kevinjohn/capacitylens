import type { Locator, Page, TestInfo } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  dismissLandscapeHint,
  openApp,
  resetSchedulerScroll,
  selectShadOption,
  setZoom,
  showPlaceholders,
} from "./helpers";

async function expectLabelControl(control: Locator) {
  const field = control.locator('xpath=ancestor::*[@data-product-layout="label-control"][1]');
  const fieldBox = await field.boundingBox();
  const controlBox = await control.boundingBox();
  expect(fieldBox).not.toBeNull();
  expect(controlBox).not.toBeNull();
  const controlStart = (controlBox!.x - fieldBox!.x) / fieldBox!.width;
  expect(controlStart).toBeGreaterThan(0.24);
  expect(controlStart).toBeLessThan(0.32);
}

async function expectInControlColumn(control: Locator) {
  const row = control.locator("xpath=ancestor::*[@data-allocation-control-column][1]");
  const rowBox = await row.boundingBox();
  const contentBox = await row.locator(":scope > :nth-child(2)").boundingBox();
  expect(rowBox).not.toBeNull();
  expect(contentBox).not.toBeNull();
  const contentStart = (contentBox!.x - rowBox!.x) / rowBox!.width;
  expect(contentStart).toBeGreaterThan(0.24);
  expect(contentStart).toBeLessThan(0.32);
}

async function expectFullWidthSchedulingRow(dialog: Locator, controls: Locator[]) {
  const row = dialog.locator("[data-allocation-span-row]");
  const content = row.locator("[data-allocation-span-controls]");
  const fields = content.locator(":scope > [data-slot='field']");
  await expect(row).toHaveCount(1);
  await expect(fields).toHaveCount(controls.length);
  for (const control of controls) {
    await expect(control.locator("xpath=ancestor::*[@data-allocation-span-row][1]")).toBeAttached();
  }

  const rowBox = await row.boundingBox();
  const modalBodyContentBox = await row.locator("xpath=parent::*").evaluate((body) => {
    const box = body.getBoundingClientRect();
    const style = getComputedStyle(body);
    const left = box.x + Number.parseFloat(style.paddingLeft);
    const right = box.right - Number.parseFloat(style.paddingRight);
    return { left, right };
  });
  const fieldBoxes = await Promise.all((await fields.all()).map((field) => field.boundingBox()));
  expect(rowBox).not.toBeNull();
  expect(fieldBoxes.every((box) => box !== null)).toBe(true);
  expect(Math.abs(rowBox!.x - modalBodyContentBox.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(rowBox!.x + rowBox!.width - modalBodyContentBox.right)).toBeLessThanOrEqual(1);
  const widths = fieldBoxes.map((box) => box!.width);
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
}

async function expectStackedSchedulingRow(dialog: Locator, controls: Locator[]) {
  const row = dialog.locator("[data-allocation-span-row]");
  const content = row.locator("[data-allocation-span-controls]");
  const contentBox = await content.boundingBox();
  const fields = content.locator(":scope > [data-slot='field']");
  const fieldBoxes = await Promise.all((await fields.all()).map((field) => field.boundingBox()));
  expect(contentBox).not.toBeNull();
  expect(fieldBoxes).toHaveLength(controls.length);
  expect(fieldBoxes.every((box) => box !== null)).toBe(true);
  for (const [index, box] of fieldBoxes.entries()) {
    expect(Math.abs(box!.x - contentBox!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.width - contentBox!.width)).toBeLessThanOrEqual(1);
    if (index > 0) expect(box!.y).toBeGreaterThanOrEqual(fieldBoxes[index - 1]!.y + fieldBoxes[index - 1]!.height);
  }
  for (const control of controls) {
    const controlBox = await control.boundingBox();
    expect(controlBox).not.toBeNull();
    expect(controlBox!.x).toBeGreaterThanOrEqual(contentBox!.x - 1);
    expect(controlBox!.x + controlBox!.width).toBeLessThanOrEqual(contentBox!.x + contentBox!.width + 1);
  }
}

async function openCreate(page: Page, resource: string) {
  await page.getByRole("button", { name: `Add allocation for ${resource}` }).click();
  const dialog = page.getByRole("dialog", { name: "New allocation" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function chooseSchedulingMode(page: Page, mode: "Days" | "Blocks") {
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("radio", { name: mode, exact: true }).click();
  await page.getByRole("link", { name: "Schedule", exact: true }).click();
  await setZoom(page, 4);
  await resetSchedulerScroll(page);
}

test.describe("Allocation modal label/control layout", () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await setZoom(page, 4);
    await resetSchedulerScroll(page);
  });

  test("aligns create, repeat, status and error controls, then stacks without narrow overflow", async ({
    page,
  }, testInfo: TestInfo) => {
    const dialog = await openCreate(page, "Clark Kent");
    for (const control of [
      dialog.getByRole("combobox", { name: "Project" }),
      dialog.getByRole("combobox", { name: "Activity" }),
      dialog.getByRole("combobox", { name: "Repeat" }),
      dialog.getByRole("radiogroup", { name: "Status" }),
      dialog.getByLabel("Note"),
      dialog.getByRole("checkbox", { name: "Ignore working days" }),
    ]) {
      await expectLabelControl(control);
    }
    await expectFullWidthSchedulingRow(dialog, [
      dialog.getByLabel("Start Date"),
      dialog.getByLabel(/^End/),
      dialog.getByLabel("Hours / day"),
    ]);
    await expectInControlColumn(dialog.getByRole("textbox", { name: "New activity name" }));

    const status = dialog.getByRole("radiogroup", { name: "Status" });
    const statusBox = await status.boundingBox();
    const segments = await status.getByRole("radio").all();
    const segmentBoxes = await Promise.all(segments.map((segment) => segment.boundingBox()));
    const noteBox = await dialog.getByLabel("Note").boundingBox();
    expect(statusBox).not.toBeNull();
    expect(noteBox).not.toBeNull();
    expect(segmentBoxes.every((box) => box !== null)).toBe(true);
    const segmentWidths = segmentBoxes.map((box) => box!.width);
    expect(Math.max(...segmentWidths) - Math.min(...segmentWidths)).toBeLessThanOrEqual(1);
    expect(Math.abs(statusBox!.width - noteBox!.width)).toBeLessThanOrEqual(1);

    await selectShadOption(dialog.getByLabel("Project", { exact: true }), "p-acme");
    await selectShadOption(dialog.getByRole("combobox", { name: "Activity" }), "t-wires");
    await selectShadOption(dialog.getByRole("combobox", { name: "Repeat" }), "weekly");
    await expectLabelControl(dialog.getByLabel("Repeat until"));
    await expectInControlColumn(dialog.getByText(/Creates \d+ linked allocations/));
    await page.screenshot({ path: testInfo.outputPath("issue_306_allocation_create_desktop.png") });

    await dialog.getByLabel("Start Date").fill("");
    await dialog.getByRole("button", { name: "Save" }).click();
    const error = dialog.getByRole("alert");
    const errorId = await error.getAttribute("id");
    expect(errorId).toBeTruthy();
    await expect(dialog.getByLabel("Start Date")).toHaveAttribute("aria-describedby", errorId!);
    await expect(dialog.getByLabel("Start Date")).toBeFocused();

    await dismissLandscapeHint(page);
    const projectField = dialog
      .getByRole("combobox", { name: "Project" })
      .locator('xpath=ancestor::*[@data-product-layout="label-control"][1]');
    const fieldBox = await projectField.boundingBox();
    const labelBox = await projectField.locator(":scope > :first-child").boundingBox();
    const controlBox = await dialog.getByRole("combobox", { name: "Project" }).boundingBox();
    expect(fieldBox).not.toBeNull();
    expect(labelBox).not.toBeNull();
    expect(controlBox).not.toBeNull();
    expect(controlBox!.y).toBeGreaterThanOrEqual(labelBox!.y + labelBox!.height);
    expect(Math.abs(controlBox!.x - fieldBox!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(controlBox!.width - fieldBox!.width)).toBeLessThanOrEqual(1);

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
    await page.screenshot({ path: testInfo.outputPath("issue_306_allocation_create_narrow.png") });
  });

  test("uses the full-width scheduling row for edit, Days, Blocks and External variants", async ({
    page,
  }, testInfo: TestInfo) => {
    await page.getByTestId("allocation-bar").filter({ hasText: "Wireframes" }).first().click();
    let dialog = page.getByRole("dialog", { name: "Edit allocation" });
    await expectLabelControl(dialog.getByRole("combobox", { name: "Assignee" }));
    await expectFullWidthSchedulingRow(dialog, [
      dialog.getByLabel("Start Date"),
      dialog.getByLabel(/^End/),
      dialog.getByLabel("Hours / day"),
    ]);
    await expect(dialog.getByRole("combobox", { name: "Repeat" })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("issue_306_allocation_edit_desktop.png") });
    await dialog.getByRole("button", { name: "Cancel" }).click();

    await chooseSchedulingMode(page, "Days");
    dialog = await openCreate(page, "Clark Kent");
    await expectFullWidthSchedulingRow(
      dialog,
      ["Start Date", "Days of work", "Days over"].map((label) => dialog.getByLabel(label, { exact: true })),
    );
    await expect(dialog.getByText(/^Ends /).locator("xpath=ancestor::*[@data-allocation-span-row][1]")).toBeAttached();
    await dialog.getByRole("button", { name: "Cancel" }).click();

    await chooseSchedulingMode(page, "Blocks");
    dialog = await openCreate(page, "Clark Kent");
    await expectFullWidthSchedulingRow(dialog, [dialog.getByLabel("Start Date"), dialog.getByLabel("Days over")]);
    await expect(dialog.getByText(/^Ends /).locator("xpath=ancestor::*[@data-allocation-span-row][1]")).toBeAttached();
    await dialog.getByRole("button", { name: "Cancel" }).click();

    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("switch", { name: "Show external resources" }).click();
    await showPlaceholders(page);
    await page.getByRole("link", { name: "Schedule", exact: true }).click();
    await setZoom(page, 4);

    dialog = await openCreate(page, "Kord Industries");
    await expectFullWidthSchedulingRow(dialog, [dialog.getByLabel("Start Date"), dialog.getByLabel(/^End/)]);
    await expect(dialog.getByRole("checkbox", { name: "Ignore working days" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Cancel" }).click();

    dialog = await openCreate(page, "Placeholder");
    await expectInControlColumn(dialog.getByText("Placeholder — locked to its bound project."));
    await expect(dialog.getByLabel("Project", { exact: true })).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath("issue_306_allocation_placeholder.png") });
  });

  test("stacks the hourly three-field row without clipping at 360px", async ({ page }) => {
    const dialog = await openCreate(page, "Clark Kent");
    await dismissLandscapeHint(page);
    await expectStackedSchedulingRow(dialog, [
      dialog.getByLabel("Start Date"),
      dialog.getByLabel(/^End/),
      dialog.getByLabel("Hours / day"),
    ]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
  });
});
