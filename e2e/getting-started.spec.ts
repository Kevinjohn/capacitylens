import { test, expect } from "./fixtures";
import { openNewCompany, selectShadOption } from "./helpers";
import { TOUR_ANCHORS } from "../src/lib/tourAnchors";

test.use({ contextOptions: { reducedMotion: "reduce" } });

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

  test("No keeps guidance and Yes dismisses it", async ({ page }) => {
    await openNewCompany(page, "Queen Consolidated");
    await page.getByTestId("getting-started-dismiss").click();
    await expect(page.getByText("Do you really want to hide this forever?")).toBeVisible();
    await page.getByRole("button", { name: "No" }).click();
    await expect(page.getByTestId("getting-started-progress")).toBeVisible();
    await page.getByTestId("getting-started-dismiss").click();
    await page.getByRole("button", { name: "Yes" }).click();
    await expect(page.getByTestId("getting-started-progress")).toHaveCount(0);
  });

  test('"Show me around" runs the loose orientation tour', async ({ page }) => {
    await openNewCompany(page, "Queen Consolidated");
    for (const selector of TOUR_ANCHORS) await expect(page.locator(selector)).toBeVisible();
    await page.getByTestId("getting-started-tour").click();
    const popover = page.locator(".driver-popover");
    await expect(popover).toBeVisible();
    await popover.getByRole("button", { name: "Next" }).click();
    await expect(popover.getByText("Search, filters and zoom")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);
  });
});
