import { test, expect } from "./fixtures";
import { selectShadOption, setZoom, showScheduleFilters } from "./browserTestSupport";
import { openApp } from "./appEntrySupport";
import { resetSchedulerScroll } from "./schedulerGeometrySupport";

// External visibility is an account preference that defaults off; toggling it must preserve the underlying bookings.

// Turn the External feature on via Settings, then return to the Schedule. Used by the tests that
// exercise the band / assignee behaviour, which all need externals visible first.
async function enableExternal(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  const toggle = page.getByRole("switch", { name: "Show external resources" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
}

function registerHiddenDefaultSeededExternalAbsentTest() {
  test("hidden by default: the seeded external is absent from the schedule and the Resources tab", async ({ page }) => {
    await openApp(page);
    await expect(page.locator('[data-resource-id="r-ext-northstar"]')).toHaveCount(0);
    await expect(page.getByTestId("discipline-group").filter({ hasText: "External / 3rd party" })).toHaveCount(0);

    await page.getByRole("link", { name: "Resources" }).click();
    await expect(page.getByRole("heading", { name: "External", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add external party" })).toHaveCount(0);
    await expect(page.getByTestId("external-row")).toHaveCount(0);
  });
}

function registerOldExternalURLRedirectsResourcesTest() {
  test("the old /external URL redirects to the Resources tab", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/external");
    await expect(page).toHaveURL(/\/resources$/);
    await expect(page.getByRole("heading", { name: "Resources", exact: true })).toBeVisible();
  });
}

function registerTurningRevealsExternalSectionHelpTest() {
  test("turning it on reveals the External section with help in Resources and the band on the schedule", async ({
    page,
  }) => {
    await openApp(page);
    await enableExternal(page);

    await page.getByRole("button", { name: "About Company features" }).click();
    const helpDialog = page.getByRole("dialog", { name: "Company features" });
    await expect(helpDialog.getByText(/outside companies you hand work to but/i)).toBeVisible();
    await helpDialog.getByRole("button", { name: "Close" }).click();

    await page.getByRole("link", { name: "Resources" }).click();
    await expect(page.getByRole("heading", { name: "External", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add external party" })).toBeVisible();
    await expect(page.getByText(/never count toward your team’s capacity or utilisation/i)).toHaveCount(0);
    await page.getByRole("button", { name: "About External" }).click();
    const resourcesHelpDialog = page.getByRole("dialog", { name: "External" });
    await expect(
      resourcesHelpDialog.getByText(/never count toward your team’s capacity or utilisation/i),
    ).toBeVisible();
    await resourcesHelpDialog.getByRole("button", { name: "Close" }).click();
    await expect(page.getByTestId("external-row").filter({ hasText: "Kord Industries" })).toBeVisible();
    await expect(page.getByTestId("resource-row").filter({ hasText: "Kord Industries" })).toHaveCount(0);

    await page.getByRole("link", { name: "Schedule" }).click();
    await setZoom(page, 4);
    await resetSchedulerScroll(page);
    await page.getByTestId("scheduler-grid").evaluate((el) => {
      (el as HTMLElement).scrollTop = (el as HTMLElement).scrollHeight;
    });
    await expect(page.getByTestId("discipline-group").last()).toContainText("External / 3rd party");
    const extBar = page
      .locator('[data-resource-id="r-ext-northstar"]')
      .getByTestId("allocation-bar")
      .filter({ hasText: "Visual Design" });
    await expect(extBar).toBeVisible();
    await expect(extBar).not.toContainText(/\b\d+(?:\.\d+)?h\b/);
    await expect(
      page.getByTestId("scheduler-row").filter({ hasText: "Kord Industries" }).getByTestId("utilization"),
    ).toHaveCount(0);
  });
}

function registerChoiceSurvivesNavigationCurrentDemoTest() {
  test("the choice survives navigation in the current demo session", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/settings");
    await page.getByRole("switch", { name: "Show external resources" }).click();
    await page.getByRole("link", { name: "Schedule" }).click();
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("switch", { name: "Show external resources" })).toHaveAttribute("aria-checked", "true");
  });
}

function registerAddsExternalPartyResourcesTabTest() {
  test("adds an external party in the Resources tab External section", async ({ page }) => {
    await openApp(page);
    await enableExternal(page);
    await page.getByRole("link", { name: "Resources" }).click();

    await page.getByRole("button", { name: "Add external party" }).click();
    await page.getByLabel("Company").fill("Pixel Forge");
    await page.getByLabel("Descriptor").fill("Print");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("external-row").filter({ hasText: "Pixel Forge" })).toBeVisible();
    await expect(page.getByTestId("resource-row").filter({ hasText: "Pixel Forge" })).toHaveCount(0);
  });
}

function registerAssignsActivityRowModalHasTest() {
  test('assigns an activity from the row "+": the modal has no Hours field and saves a span-only bar', async ({
    page,
  }) => {
    await openApp(page);
    await enableExternal(page);
    await page.getByRole("link", { name: "Schedule" }).click();
    await setZoom(page, 4);
    await resetSchedulerScroll(page);
    await page.getByTestId("scheduler-grid").evaluate((el) => {
      (el as HTMLElement).scrollTop = (el as HTMLElement).scrollHeight;
    });

    await page.getByRole("button", { name: "Add allocation for Kord Industries" }).click();
    const dialog = page.getByRole("dialog", { name: "New allocation" });
    await expect(dialog.getByRole("heading")).toContainText("Kord Industries");
    // External work has no capacity, so its modal collects only a date span.
    await expect(dialog.getByLabel("Hours / day")).toHaveCount(0);
    // Externals already use literal calendar spans, so the override is hidden.
    await expect(dialog.getByRole("checkbox", { name: "Ignore working days" })).toHaveCount(0);
    await expect(dialog.getByLabel("Start Date")).toBeVisible();

    await selectShadOption(dialog.getByLabel("Project", { exact: true }), "p-acme");
    await selectShadOption(dialog.getByRole("combobox", { name: "Activity", exact: true }), "t-wires");
    await page.getByRole("button", { name: "Save" }).click();

    const newBar = page
      .locator('[data-resource-id="r-ext-northstar"]')
      .getByTestId("allocation-bar")
      .filter({ hasText: "Wireframes" });
    await expect(newBar).toBeVisible();
    await expect(newBar).not.toContainText(/\b\d+(?:\.\d+)?h\b/);
  });
}

function registerExternalPartiesExcludedTimeOffTest() {
  test("external parties are excluded from the Time off resource picker", async ({ page }) => {
    // Enable the preference so the seeded external would otherwise be eligible. Time off still
    // excludes it because external parties have no capacity.
    await openApp(page);
    await enableExternal(page);
    await page.getByRole("link", { name: "Time off" }).click();
    await page.getByRole("button", { name: "Add time off" }).click();
    const resource = page.getByRole("dialog").getByLabel("Resource");
    await resource.click();
    await expect(page.getByRole("option", { name: "Kord Industries" })).toHaveCount(0);
    await expect(page.getByRole("option", { name: "Bruce Wayne" })).toBeVisible();
  });
}

function registerTimeOffDrawModeOpTest() {
  test("time-off draw mode is a no-op on an external lane (no orphan time-off)", async ({ page }) => {
    await openApp(page);
    await enableExternal(page);
    await page.getByRole("link", { name: "Schedule" }).click();
    await setZoom(page, 4);
    await showScheduleFilters(page);
    await page.getByTestId("scheduler-grid").evaluate((el) => {
      (el as HTMLElement).scrollLeft = 0;
      (el as HTMLElement).scrollTop = (el as HTMLElement).scrollHeight;
    });
    await page.getByRole("radio", { name: "Time off", exact: true }).click();
    // A time-off gesture on an external party must be a no-op because it has no capacity. A draw
    // on a person's lane opens the time-off form.
    const lane = page.locator('[data-resource-id="r-ext-northstar"]');
    const b = await lane.boundingBox();
    if (!b) throw new Error("external lane not found");
    const y = b.y + b.height / 2;
    await page.mouse.move(b.x + 6, y);
    await page.mouse.down();
    await page.mouse.move(b.x + 6 + 48 * 2, y, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByRole("dialog", { name: "Add time off" })).toHaveCount(0);
    await expect(lane.getByTestId("timeoff-block")).toHaveCount(0);
  });
}

// the per-row destructive action archives (hidden from the active list, fully retained, not
// a hard delete). Archiving is undoable via the local store.
function registerArchivingExternalPartyUndoableTests() {
  test("archiving an external party is undoable", async ({ page }) => {
    await openApp(page);
    await enableExternal(page);
    await page.getByRole("link", { name: "Resources" }).click();

    await page
      .getByTestId("external-row")
      .filter({ hasText: "Kord Industries" })
      .getByRole("button", { name: "Archive Kord Industries" })
      .click();
    await page
      .getByRole("alertdialog", { name: "Archive resource?" })
      .getByRole("button", { name: "Archive", exact: true })
      .click();
    await expect(page.getByTestId("external-row").filter({ hasText: "Kord Industries" })).toHaveCount(0);

    await page.keyboard.press("Meta+z");
    await expect(page.getByTestId("external-row").filter({ hasText: "Kord Industries" })).toBeVisible();
  });
}

test.describe("External / 3rd parties (per-account pref, default off)", () => {
  registerHiddenDefaultSeededExternalAbsentTest();
  registerOldExternalURLRedirectsResourcesTest();
  registerTurningRevealsExternalSectionHelpTest();
  registerChoiceSurvivesNavigationCurrentDemoTest();
  registerAddsExternalPartyResourcesTabTest();
  registerAssignsActivityRowModalHasTest();
  registerExternalPartiesExcludedTimeOffTest();
  registerTimeOffDrawModeOpTest();
  registerArchivingExternalPartyUndoableTests();
});
