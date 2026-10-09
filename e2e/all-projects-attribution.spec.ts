import { test, expect } from "./fixtures";
import type { Locator, Page } from "./fixtures";
import {
  boundingBoxOrThrow,
  enableInlineActivityCreation,
  openApp,
  resetSchedulerScroll,
  selectShadOption,
  setZoom,
  showPlaceholders,
  showScheduleFilters,
} from "./browserTestSupport";

const attributedBar = (page: Page) =>
  page.locator('[data-resource-id="r-nike"]').getByTestId("allocation-bar").filter({ hasText: "Design" });

async function stableBoundingBox(locator: Locator) {
  let previous: Awaited<ReturnType<typeof boundingBoxOrThrow>> | undefined;
  await expect
    .poll(
      async () => {
        const current = await boundingBoxOrThrow(locator);
        const stable = previous !== undefined && current.x === previous.x && current.y === previous.y;
        previous = current;
        return stable;
      },
      { intervals: [150, 150, 250], timeout: 5_000 },
    )
    .toBe(true);
  return boundingBoxOrThrow(locator);
}

async function createAttributedDesign(page: Page, repeatUntil?: string) {
  await page.getByRole("button", { name: "Add allocation for Clark Kent" }).click();
  const dialog = page.getByRole("dialog", { name: "New allocation" });
  await selectShadOption(dialog.getByLabel("Project", { exact: true }), "p-acme");
  await selectShadOption(dialog.getByRole("combobox", { name: "Activity", exact: true }), "t-design");
  await dialog.getByLabel("Start").fill("2026-06-15");
  await dialog.getByLabel(/^End/).fill("2026-06-15");
  if (repeatUntil) {
    await selectShadOption(dialog.getByRole("combobox", { name: "Repeat" }), "weekly");
    await dialog.getByLabel("Repeat until").fill(repeatUntil);
  }
  await dialog.getByRole("button", { name: "Save" }).click();
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await setZoom(page, 4);
  await resetSchedulerScroll(page);
});

test("creates, labels, filters, edits and clears an attributed allocation", async ({ page }) => {
  await createAttributedDesign(page);
  const bar = attributedBar(page);
  await expect(bar).toContainText("Queen Consolidated · Project Watchtower · Design");

  await bar.click();
  let editor = page.getByRole("dialog", { name: "Edit allocation" });
  await expect(editor.getByLabel("Project", { exact: true })).toHaveText(/Project Watchtower/);
  await editor.getByLabel("Note").fill("Attribution survives edit");
  await editor.getByRole("button", { name: "Save" }).click();

  await showScheduleFilters(page);
  await selectShadOption(page.getByLabel("Filter by project"), "p-acme");
  await expect(attributedBar(page)).toBeVisible();
  await page.getByRole("button", { name: "Clear Filters" }).click();

  await attributedBar(page).click();
  editor = page.getByRole("dialog", { name: "Edit allocation" });
  await selectShadOption(editor.getByLabel("Project", { exact: true }), { label: "No specific project" });
  await selectShadOption(editor.getByRole("combobox", { name: "Activity", exact: true }), "t-design");
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(attributedBar(page)).not.toContainText("Project Watchtower");

  await selectShadOption(page.getByLabel("Filter by project"), "p-acme");
  await expect(attributedBar(page)).toHaveCount(0);
});

test("keeps a legacy unattributed edit unchanged and places inline activities in their group", async ({ page }) => {
  const legacy = page
    .locator('[data-resource-id="r-alex"]')
    .getByTestId("allocation-bar")
    .filter({ hasText: "Design" });
  await legacy.click();
  let editor = page.getByRole("dialog", { name: "Edit allocation" });
  await expect(editor.getByLabel("Project", { exact: true })).toHaveText("No specific project");
  await editor.getByLabel("Note").fill("Still unattributed");
  await editor.getByRole("button", { name: "Save" }).click();
  await legacy.click();
  editor = page.getByRole("dialog", { name: "Edit allocation" });
  await expect(editor.getByLabel("Project", { exact: true })).toHaveText("No specific project");
  await editor.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await enableInlineActivityCreation(page);
  await page.getByRole("link", { name: "Schedule" }).click();
  await setZoom(page, 4);
  await resetSchedulerScroll(page);

  await page.getByRole("button", { name: "Add allocation for Clark Kent" }).click();
  const create = page.getByRole("dialog", { name: "New allocation" });
  await selectShadOption(create.getByLabel("Project", { exact: true }), "p-acme");
  await create.getByLabel("New activity name").fill("Inline Attribution");
  await create.getByRole("button", { name: "Add activity" }).click();
  await create.getByRole("combobox", { name: "Activity", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "Project-specific" }).getByRole("option", { name: "Inline Attribution" }),
  ).toBeVisible();
});

test("locks and stamps a placeholder booking and copies attribution across a repeat series", async ({ page }) => {
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await showPlaceholders(page);
  await page.getByRole("link", { name: "Schedule" }).click();
  await setZoom(page, 4);
  await resetSchedulerScroll(page);

  await page.getByRole("button", { name: "Add allocation for Placeholder" }).click();
  const placeholderCreate = page.getByRole("dialog", { name: "New allocation" });
  const project = placeholderCreate.getByLabel("Project", { exact: true });
  await project.click();
  await expect(page.getByRole("option", { name: "Internal", exact: true })).toHaveAttribute("data-disabled");
  await expect(page.getByRole("option", { name: "No specific project", exact: true })).toHaveAttribute("data-disabled");
  await page.keyboard.press("Escape");
  await placeholderCreate.getByRole("combobox", { name: "Activity", exact: true }).click();
  await expect(page.getByRole("group", { name: "All projects" }).getByRole("option", { name: "Design" })).toBeVisible();
  await page.getByRole("option", { name: "Design", exact: true }).click();
  await placeholderCreate.getByRole("button", { name: "Save" }).click();
  const placeholderBar = page
    .locator('[data-resource-id="r-ph-designer"]')
    .getByRole("button", { name: /· Design, 8h per day,/ });
  await placeholderBar.click();
  await expect(page.getByRole("dialog", { name: "Edit allocation" }).getByLabel("Project", { exact: true })).toHaveText(
    /Project Watchtower/,
  );
  await page.getByRole("dialog", { name: "Edit allocation" }).getByRole("button", { name: "Cancel" }).click();

  await createAttributedDesign(page, "2026-06-22");
  await expect(attributedBar(page)).toHaveCount(2);
  for (const occurrence of await attributedBar(page).all()) {
    await occurrence.click();
    const editor = page.getByRole("dialog", { name: "Edit allocation" });
    await expect(editor.getByLabel("Project", { exact: true })).toHaveText(/Project Watchtower/);
    await editor.getByRole("button", { name: "Cancel" }).click();
  }
});

test("restores an archived attributed project and preserves it through a drag", async ({ page }) => {
  await createAttributedDesign(page);
  await page.getByRole("link", { name: "Projects" }).click();
  await page
    .getByTestId("project-row")
    .filter({ hasText: "Project Watchtower" })
    .getByRole("button", { name: "Archive Project Watchtower" })
    .click();
  await page
    .getByRole("alertdialog", { name: "Archive project?" })
    .getByRole("button", { name: "Archive", exact: true })
    .click();
  await page
    .getByTestId("archived-projects-section")
    .getByTestId("archived-row")
    .filter({ hasText: "Project Watchtower" })
    .getByRole("button", { name: "Restore Project Watchtower" })
    .click();
  await page.getByRole("link", { name: "Schedule" }).click();
  await setZoom(page, 4);
  await resetSchedulerScroll(page);

  const bar = attributedBar(page);
  await bar.scrollIntoViewIfNeeded();
  const barBox = await stableBoundingBox(bar);
  const x = barBox.x + barBox.width / 2;
  const y = barBox.y + barBox.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 120, y, { steps: 10 });
  await page.mouse.up();
  const movedBox = await stableBoundingBox(bar);
  expect(movedBox.x).toBeLessThan(barBox.x - 20);
  await bar.click();
  await expect(page.getByRole("dialog", { name: "Edit allocation" }).getByLabel("Project", { exact: true })).toHaveText(
    /Project Watchtower/,
  );
});
