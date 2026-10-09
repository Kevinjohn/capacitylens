import { test, expect } from "./fixtures";
import type { Locator } from "./fixtures";
import { openNewCompany, selectShadOption } from "./browserTestSupport";
import { TOUR_ANCHORS } from "../src/lib/tourAnchors";

test.use({ contextOptions: { reducedMotion: "reduce" } });

async function finishTour(popover: Locator, stopCount: number, finalTitle: string): Promise<void> {
  for (let stop = 1; stop < stopCount; stop += 1) await popover.getByRole("button", { name: "Next" }).click();
  await expect(popover.getByText(`${stopCount} of ${stopCount}`)).toBeVisible();
  await expect(popover.getByText(finalTitle)).toBeVisible();
  await popover.getByRole("button", { name: "Done" }).click();
  await expect(popover).toHaveCount(0);
}

function registerDismissalTest() {
  test("No keeps guidance and Yes dismisses it", async ({ page }) => {
    await openNewCompany(page, "Queen Consolidated");
    await page.getByTestId("getting-started-dismiss").click();
    await expect(page.getByText("Do you really want to hide this forever?")).toBeVisible();
    await page.getByRole("button", { name: "No" }).click();
    await expect(page.getByTestId("getting-started-progress")).toBeVisible();
    await page.getByTestId("getting-started-dismiss").click();
    await page.getByRole("button", { name: "Yes" }).click();
    await expect(page.getByTestId("getting-started-progress")).toHaveCount(0);
    await page.getByRole("link", { name: "Help", exact: true }).click();
    await page.getByTestId("show-tour").click();
    await expect(page.locator(".driver-popover")).toContainText("1 of 7");
    await finishTour(page.locator(".driver-popover"), 7, "Viewer: Search, filters and weeks");
  });
}

test.describe("getting started", () => {
  test("shows five independent milestones and progress across pages", async ({ page }) => {
    await openNewCompany(page, "Queen Consolidated");
    const card = page.getByTestId("getting-started");
    await expect(card).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "Getting started" })).toHaveAttribute("aria-valuenow", "0");
    await expect(card.getByRole("listitem")).toHaveCount(5);
    await card.getByRole("link", { name: "Add someone to the schedule" }).click();
    await expect(page.getByTestId("getting-started-progress")).toBeVisible();
    await expect(card).toHaveCount(0);
    await page.getByRole("button", { name: "Add resource" }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Bruce Wayne");
    await page.getByLabel("Role").fill("Designer");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("progressbar", { name: "Getting started" })).toHaveAttribute("aria-valuenow", "1");

    await page.getByRole("link", { name: "Activities" }).click();
    await page.getByRole("button", { name: "Add activity" }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Wayne planning");
    await page.getByRole("radio", { name: "Internal" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("progressbar", { name: "Getting started" })).toHaveAttribute("aria-valuenow", "2");

    await page.getByRole("link", { name: "Schedule" }).click();
    await page.getByRole("button", { name: "Add allocation for Bruce Wayne" }).click();
    const dialog = page.getByRole("dialog", { name: "New allocation" });
    await selectShadOption(dialog.getByRole("combobox", { name: "Activity", exact: true }), {
      label: "Wayne planning",
    });
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("progressbar", { name: "Getting started" })).toHaveAttribute("aria-valuenow", "3");
    await expect(card).toBeVisible();

    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page.getByTestId("getting-started-progress")).toBeVisible();
    await expect(card).toHaveCount(0);
    await page.getByRole("button", { name: "Show checklist" }).click();
    await expect(card.getByRole("link", { name: "Add a client" })).toBeVisible();
  });

  registerDismissalTest();

  test('"Show me around" runs the role tour in the demo', async ({ page }) => {
    await openNewCompany(page, "Queen Consolidated");
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Show checklist" }).click();
    await page.getByTestId("getting-started-tour").click();
    const popover = page.locator(".driver-popover");
    await expect(popover).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    await expect(popover.getByText("Owner: Import and restore schedules")).toBeVisible();
    await expect(popover.getByText("1 of 7")).toBeVisible();
    for (const selector of TOUR_ANCHORS) await expect(page.locator(selector)).toBeVisible();
    await finishTour(popover, 7, "Viewer: Search, filters and weeks");
  });
});
