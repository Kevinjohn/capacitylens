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
      dialog.getByLabel("Hours / day"),
      dialog.getByRole("combobox", { name: "Repeat" }),
      dialog.getByRole("radiogroup", { name: "Status" }),
      dialog.getByLabel("Note"),
      dialog.getByRole("checkbox", { name: "Ignore working days" }),
    ]) {
      await expectLabelControl(control);
    }
    await expectInControlColumn(dialog.getByLabel("Start Date"));
    await expectInControlColumn(dialog.getByLabel(/^End/));
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

    const dateRow = dialog.getByLabel("Start Date").locator("xpath=ancestor::*[@data-allocation-control-column][1]");
    const dateRowBox = await dateRow.boundingBox();
    const dateContentBox = await dateRow.locator(":scope > :nth-child(2)").boundingBox();
    expect(dateRowBox).not.toBeNull();
    expect(dateContentBox).not.toBeNull();
    expect(Math.abs(dateContentBox!.x - dateRowBox!.x)).toBeLessThanOrEqual(1);
    expect(dateContentBox!.x + dateContentBox!.width).toBeLessThanOrEqual(dateRowBox!.x + dateRowBox!.width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
    await page.screenshot({ path: testInfo.outputPath("issue_306_allocation_create_narrow.png") });
  });

  test("keeps edit, Days, Blocks, External and placeholder variants in the same control column", async ({
    page,
  }, testInfo: TestInfo) => {
    await page.getByTestId("allocation-bar").filter({ hasText: "Wireframes" }).first().click();
    let dialog = page.getByRole("dialog", { name: "Edit allocation" });
    await expectLabelControl(dialog.getByRole("combobox", { name: "Assignee" }));
    await expectInControlColumn(dialog.getByLabel("Start Date"));
    await expect(dialog.getByRole("combobox", { name: "Repeat" })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("issue_306_allocation_edit_desktop.png") });
    await dialog.getByRole("button", { name: "Cancel" }).click();

    await chooseSchedulingMode(page, "Days");
    dialog = await openCreate(page, "Clark Kent");
    for (const label of ["Start Date", "Days of work", "Days over"]) {
      await expectInControlColumn(dialog.getByLabel(label, { exact: true }));
    }
    await expectInControlColumn(dialog.getByText(/^Ends /));
    await dialog.getByRole("button", { name: "Cancel" }).click();

    await chooseSchedulingMode(page, "Blocks");
    dialog = await openCreate(page, "Clark Kent");
    await expectInControlColumn(dialog.getByLabel("Start Date"));
    await expectInControlColumn(dialog.getByLabel("Days over"));
    await expectInControlColumn(dialog.getByText(/^Ends /));
    await dialog.getByRole("button", { name: "Cancel" }).click();

    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("switch", { name: "Show external resources" }).click();
    await showPlaceholders(page);
    await page.getByRole("link", { name: "Schedule", exact: true }).click();
    await setZoom(page, 4);

    dialog = await openCreate(page, "Kord Industries");
    await expectInControlColumn(dialog.getByLabel("Start Date"));
    await expectInControlColumn(dialog.getByLabel(/^End/));
    await expect(dialog.getByRole("checkbox", { name: "Ignore working days" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Cancel" }).click();

    dialog = await openCreate(page, "Placeholder");
    await expectInControlColumn(dialog.getByText("Placeholder — locked to its bound project."));
    await expect(dialog.getByLabel("Project", { exact: true })).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath("issue_306_allocation_placeholder.png") });
  });
});
