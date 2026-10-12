import { test, expect } from "./fixtures";
import type { Locator } from "./fixtures";
import { openApp, resetSchedulerScroll, setZoom } from "./browserTestSupport";

// The end-to-end colour invariant ensures a selected preset swatch renders on the scheduler.
// Disciplines use their swatch for the group-header dot and member avatars; projects use theirs
// for allocation bars. This browser-agnostic spec picks a swatch through ColorField and checks
// the rendered hex value across the supported Playwright browser projects.

// "Blue dark", flat index 47 in the 13×4 swatches grid (swatchLabel(47) === 'Blue dark').
// This swatch already clears WCAG AA against its ink, so resolveAccessibleBarColors() leaves it
// unchanged. The rendered hex is therefore testable and differs from every seeded entity colour,
// making the selected colour visible in the browser.
const PICK_LABEL = "Blue dark";
// SWATCHES[47] is #1b4f98; browsers report its computed background color as rgb(...).
const PICK_RGB = "rgb(27, 79, 152)";

// Match the colour trigger by prefix because its accessible name also includes the current value.
async function pickSwatch(scope: Locator, swatchLabel: string): Promise<void> {
  await scope.getByRole("button", { name: /^Colour/ }).click();
  // Popover content is portalled, so select the open swatch group from the page.
  await scope
    .page()
    .getByRole("radiogroup", { name: /Colour swatches/ })
    .getByRole("radio", { name: swatchLabel, exact: true })
    .click();
}

function disciplineDot(scope: Locator): Locator {
  // The first rounded span in this header is the discipline colour dot.
  return scope.locator("span.rounded-full").first();
}

function rowAvatar(row: Locator): Locator {
  // The avatar is the row header's rounded-full ring-2 span (the bars live in the lane, not here).
  return row.getByRole("rowheader").locator("span.rounded-full.ring-2").first();
}

test.describe("Colour invariant (preset swatch → renders on the scheduler)", () => {
  test("a discipline colour pick tints its group dot + member avatars", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/disciplines");

    await page
      .getByTestId("discipline-row")
      .filter({ hasText: "Design" })
      .getByRole("button", { name: /^Edit / })
      .click();
    const dialog = page.getByRole("dialog", { name: "Edit discipline" });
    await pickSwatch(dialog, PICK_LABEL);
    await expect(dialog.getByRole("button", { name: `Colour (${PICK_LABEL})` })).toBeVisible();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole("link", { name: "Schedule" }).click();
    const designGroup = page.getByTestId("discipline-group").filter({ hasText: "Design" });
    await expect(designGroup).toBeVisible();
    await expect(disciplineDot(designGroup)).toHaveCSS("background-color", PICK_RGB);

    const bruceRow = page.getByTestId("scheduler-row").filter({ hasText: "Bruce Wayne" });
    await expect(rowAvatar(bruceRow)).toHaveCSS("background-color", PICK_RGB);
  });

  test("a project colour pick tints its allocation bars", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/projects");

    await page
      .getByTestId("project-row")
      .filter({ hasText: "Project Watchtower" })
      .getByRole("button", { name: /^Edit / })
      .click();
    const dialog = page.getByRole("dialog", { name: "Edit project" });
    await pickSwatch(dialog, PICK_LABEL);
    await expect(dialog.getByRole("button", { name: `Colour (${PICK_LABEL})` })).toBeVisible();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();

    // The "Wireframes" bar (a Project Watchtower activity) must render the picked hex. Seed bars
    // sit in early June and are visible at 4w with the grid scrolled fully left.
    await page.getByRole("link", { name: "Schedule" }).click();
    await setZoom(page, 4);
    await resetSchedulerScroll(page);
    const wireframesBar = page.getByTestId("allocation-bar").filter({ hasText: "Wireframes" });
    await expect(wireframesBar.first()).toBeVisible();
    await expect(wireframesBar.first()).toHaveCSS("background-color", PICK_RGB);
  });
});
