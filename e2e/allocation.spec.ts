import { test, expect } from "./fixtures";
import { openApp, resetSchedulerScroll, selectShadOption, setZoom, showPlaceholders } from "./helpers";

// Covers US-ALL-01..08. The allocation editor (modal) opened from the row "+" or by
// clicking a bar. Seed bars live in June 2026 and are visible at 4w with scroll reset.
test.describe("Allocation editor", () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await setZoom(page, 4);
    await resetSchedulerScroll(page);
  });

  test("creates an allocation from the row + button (assignee preselected)", async ({ page }) => {
    await expect(page.getByTestId("allocation-bar")).toHaveCount(6);
    const before = await page.getByTestId("allocation-bar").count();
    await page.getByRole("button", { name: "Add allocation for Clark Kent" }).click();
    const dialog = page.getByRole("dialog", { name: "New allocation" });
    // In row-create mode the assignee is fixed to the clicked row, so there's no
    // Assignee select — the dialog title names them instead.
    await expect(dialog.getByRole("heading")).toContainText("Clark Kent");
    await expect(dialog.getByLabel("Assignee")).toHaveCount(0);
    await selectShadOption(dialog.getByLabel("Project", { exact: true }), "p-acme");
    await selectShadOption(dialog.getByRole("combobox", { name: "Activity", exact: true }), "t-wires");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("allocation-bar")).toHaveCount(before + 1);
  });

  test("separates allocation scopes, sorts choices and uses compact status and note controls", async ({ page }) => {
    await page.getByRole("button", { name: "Add allocation for Clark Kent" }).click();
    const dialog = page.getByRole("dialog", { name: "New allocation" });
    const project = dialog.getByLabel("Project", { exact: true });
    await expect(project).toHaveText("Internal");

    await project.click();
    await expect(page.getByRole("option")).toHaveText([
      "Internal",
      "Any Project",
      "LexCorp / Metropolis Rebrand",
      "Queen Consolidated / Project Watchtower",
    ]);
    await expect(page.locator('[data-slot="select-separator"]')).toHaveCount(1);
    await page.getByRole("option", { name: "Internal", exact: true }).click();

    const activity = dialog.getByRole("combobox", { name: "Activity", exact: true });
    await activity.click();
    await expect(page.getByRole("option")).toHaveText(["Admin / Internal"]);
    await page.keyboard.press("Escape");

    await project.click();
    await page.getByRole("option", { name: "Any Project", exact: true }).click();
    await activity.click();
    await expect(page.getByRole("option")).toHaveText(["Design", "Workshop"]);
    await page.keyboard.press("Escape");

    await selectShadOption(project, "p-acme");
    await activity.click();
    await expect(page.getByRole("option")).toHaveText(["CMS Review", "Visual Design", "Wireframes"]);
    await page.keyboard.press("Escape");

    const status = dialog.getByRole("radiogroup", { name: "Status" });
    await expect(status.getByRole("radio")).toHaveText(["Confirmed", "Tentative", "Completed"]);
    await status.getByRole("radio", { name: "Tentative" }).click();
    await expect(status.getByRole("radio", { name: "Tentative" })).toBeChecked();
    await expect(dialog.getByLabel("Note")).toHaveJSProperty("tagName", "INPUT");
  });

  test("creates and undoes a weekly repeat batch", async ({ page }) => {
    await expect(page.getByTestId("allocation-bar")).toHaveCount(6);
    await page.getByRole("button", { name: "Add allocation for Clark Kent" }).click();
    const dialog = page.getByRole("dialog", { name: "New allocation" });
    await selectShadOption(dialog.getByLabel("Project", { exact: true }), "p-acme");
    await selectShadOption(dialog.getByRole("combobox", { name: "Activity", exact: true }), "t-wires");
    await dialog.getByLabel("Start Date").fill("2026-06-10");
    await dialog.getByLabel(/^End/).fill("2026-06-12");
    await selectShadOption(dialog.getByRole("combobox", { name: "Repeat" }), "weekly");
    const repeatUntil = dialog.getByLabel("Repeat until");
    await expect(repeatUntil).toHaveValue("2026-08-31");
    await expect(repeatUntil).toHaveAttribute("min", "2026-06-10");
    await expect(repeatUntil).toHaveAttribute("max", "2026-12-10");
    await repeatUntil.fill("2026-09-10");
    await expect(dialog).toContainText("Creates 14 linked allocations through Thu 10th Sep. Last start: Wed 9th Sep.");
    const dialogBox = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect(dialogBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(dialogBox!.y).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(viewport!.height);
    await dialog.getByRole("button", { name: "Save" }).scrollIntoViewIfNeeded();
    await expect(dialog.getByRole("button", { name: "Save" })).toBeInViewport();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("allocation-bar")).toHaveCount(20);
    const linkedBar = page.locator('[data-testid="allocation-bar"][aria-label*="series through 11 Sep"]').first();
    await expect(linkedBar.getByTestId("allocation-series-icon")).toBeVisible();
    await linkedBar.hover();
    await expect(page.getByTestId("allocation-popover")).toContainText("Series through 11 Sep");
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.getByTestId("allocation-bar")).toHaveCount(6);
  });

  test("creates every-three-weeks from direct date input", async ({ page }) => {
    await page.getByRole("button", { name: "Add allocation for Clark Kent" }).click();
    const dialog = page.getByRole("dialog", { name: "New allocation" });
    await selectShadOption(dialog.getByLabel("Project", { exact: true }), "p-acme");
    await selectShadOption(dialog.getByRole("combobox", { name: "Activity", exact: true }), "t-wires");
    // Fri 2026-06-12: since #257 a new allocation must start on an effective working day —
    // there is no ignored-creation escape hatch, so the anchor itself moves to a weekday.
    await dialog.getByLabel("Start Date").fill("2026-06-12");
    await dialog.getByLabel(/^End/).fill("2026-06-12");
    await selectShadOption(dialog.getByRole("combobox", { name: "Repeat" }), "every-three-weeks");
    await dialog.getByLabel("Repeat until").fill("2026-09-13");
    await expect(dialog).toContainText("Creates 5 linked allocations through Sun 13th Sep. Last start: Fri 4th Sep.");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("allocation-bar")).toHaveCount(11);
  });

  test("edits one monthly occurrence, deletes its series tail and restores the tail with one Undo", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Add allocation for Clark Kent" }).click();
    let dialog = page.getByRole("dialog", { name: "New allocation" });
    await selectShadOption(dialog.getByLabel("Project", { exact: true }), "p-acme");
    await selectShadOption(dialog.getByRole("combobox", { name: "Activity", exact: true }), "t-wires");
    // Fri 2026-06-12 anchor (weekday start required since #257); later monthly occurrences may
    // drift onto weekends and are still created — that is the advisory contract under test.
    await dialog.getByLabel("Start Date").fill("2026-06-12");
    await dialog.getByLabel(/^End/).fill("2026-06-12");
    await selectShadOption(dialog.getByRole("combobox", { name: "Repeat" }), "monthly");
    await dialog.getByLabel("Repeat until").fill("2026-09-13");
    await expect(dialog).toContainText("Creates 4 linked allocations through Sun 13th Sep. Last start: Sat 12th Sep.");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("allocation-bar")).toHaveCount(10);

    const julyOccurrence = page.locator('[data-testid="allocation-bar"][aria-label*="12 Jul to 12 Jul"]');
    await julyOccurrence.click();
    let editor = page.getByRole("dialog", { name: "Edit allocation" });
    await expect(editor.getByRole("combobox", { name: "Repeat" })).toHaveCount(0);
    await editor.getByLabel("Note").fill("Edited independently");
    await editor.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("allocation-bar")).toHaveCount(10);

    await julyOccurrence.click();
    editor = page.getByRole("dialog", { name: "Edit allocation" });
    await expect(editor.getByRole("button", { name: "Duplicate" })).toHaveCount(0);
    await editor.getByRole("button", { name: "Delete" }).click();
    const repeatedDelete = page.getByRole("alertdialog", { name: "Delete repeated allocation?" });
    await expect(repeatedDelete.getByRole("button", { name: "Delete this occurrence" })).toBeVisible();
    await repeatedDelete.getByRole("button", { name: "Delete this and future occurrences" }).click();
    await expect(page.getByTestId("allocation-bar")).toHaveCount(7);
    const survivingOccurrence = page.locator('[data-testid="allocation-bar"][aria-label*="12 Jun to 12 Jun"]');
    await expect(survivingOccurrence).toBeVisible();
    await expect(survivingOccurrence).toHaveAttribute("aria-label", /series through 12 Jun/i);
    await expect(julyOccurrence).toHaveCount(0);

    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.getByTestId("allocation-bar")).toHaveCount(10);
    await expect(julyOccurrence).toBeVisible();

    await page.getByRole("button", { name: "Add allocation for Clark Kent" }).click();
    dialog = page.getByRole("dialog", { name: "New allocation" });
    await selectShadOption(dialog.getByLabel("Project", { exact: true }), "p-acme");
    await selectShadOption(dialog.getByRole("combobox", { name: "Activity", exact: true }), "t-wires");
    // Fri 2027-01-29: a weekday day-29 anchor (weekday start required since #257) that still
    // exercises the February month-length clamp without any month-end fallback copy.
    await dialog.getByLabel("Start Date").fill("2027-01-29");
    await dialog.getByLabel(/^End/).fill("2027-01-29");
    await selectShadOption(dialog.getByRole("combobox", { name: "Repeat" }), "monthly");
    await dialog.getByLabel("Repeat until").fill("2027-04-30");
    await expect(dialog).toContainText("Creates 4 linked allocations through Fri 30th Apr. Last start: Thu 29th Apr.");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("edits an allocation and reflects the change on the bar", async ({ page }) => {
    await page.getByTestId("allocation-bar").filter({ hasText: "Wireframes" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit allocation" });
    await selectShadOption(dialog.getByRole("combobox", { name: "Hours / day" }), "4");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("allocation-bar").filter({ hasText: "Wireframes" })).toContainText("4h");
  });

  test("duplicates an allocation from the edit dialog", async ({ page }) => {
    await expect(page.getByTestId("allocation-bar")).toHaveCount(6);
    const before = await page.getByTestId("allocation-bar").count();
    await page.getByTestId("allocation-bar").filter({ hasText: "Brand System" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit allocation" });
    await expect(dialog.getByRole("combobox", { name: "Repeat" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Duplicate" }).click();
    await expect(page.getByTestId("allocation-bar")).toHaveCount(before + 1);
  });

  test("deletes an allocation from the edit dialog and ⌘Z restores it", async ({ page }) => {
    await expect(page.getByTestId("allocation-bar")).toHaveCount(6);
    const before = await page.getByTestId("allocation-bar").count();
    const original = page.getByTestId("allocation-bar").filter({ hasText: "Brand System" });
    const allocationId = await original.getAttribute("data-alloc-id");
    const originalStatus = await original.getAttribute("data-status");
    const originalLabel = await original.getAttribute("aria-label");
    const originalResourceId = await original
      .locator("xpath=ancestor::*[@data-resource-id][1]")
      .getAttribute("data-resource-id");
    expect(allocationId).toBeTruthy();
    expect(originalResourceId).toBeTruthy();

    await original.click();
    const editor = page.getByRole("dialog", { name: "Edit allocation" });
    await editor.getByRole("button", { name: "Delete" }).click();

    const confirmation = page.getByRole("alertdialog", { name: "Delete allocation?" });
    await expect(confirmation.getByRole("button", { name: "Delete" })).toBeVisible();
    await expect(confirmation.getByRole("button", { name: "Cancel" })).toBeVisible();
    await confirmation.getByRole("button", { name: "Cancel" }).click();

    // Cancel returns to the editor and preserves the exact allocation.
    await expect(editor).toBeVisible();
    await expect(page.getByTestId("allocation-bar")).toHaveCount(before);
    await expect(page.locator(`[data-alloc-id="${allocationId}"]`)).toHaveAttribute("aria-label", originalLabel!);

    await editor.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("alertdialog", { name: "Delete allocation?" }).getByRole("button", { name: "Delete" }).click();
    await expect(page.getByTestId("allocation-bar")).toHaveCount(before - 1);
    await expect(page.locator(`[data-alloc-id="${allocationId}"]`)).toHaveCount(0);

    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.getByTestId("allocation-bar")).toHaveCount(before);
    const restored = page.locator(`[data-alloc-id="${allocationId}"]`);
    await expect(restored).toHaveAttribute("data-status", originalStatus!);
    await expect(restored).toHaveAttribute("aria-label", originalLabel!);
    await expect(restored.locator("xpath=ancestor::*[@data-resource-id][1]")).toHaveAttribute(
      "data-resource-id",
      originalResourceId!,
    );
  });

  test("adds a new activity inline and uses it for the allocation", async ({ page }) => {
    await page.getByRole("button", { name: "Add allocation for Clark Kent" }).click();
    const dialog = page.getByRole("dialog", { name: "New allocation" });
    await selectShadOption(dialog.getByLabel("Project", { exact: true }), "p-acme");
    await dialog.getByLabel("New activity name").fill("Inline Activity");
    await dialog.getByRole("button", { name: "Add activity" }).click();
    await expect(dialog.getByRole("combobox", { name: "Activity", exact: true })).toHaveText("Inline Activity");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("allocation-bar").filter({ hasText: "Inline Activity" })).toBeVisible();
  });

  test("reassigns an allocation to another resource via the dialog", async ({ page }) => {
    await page.getByTestId("allocation-bar").filter({ hasText: "Brand System" }).click();
    await selectShadOption(page.getByRole("dialog", { name: "Edit allocation" }).getByLabel("Assignee"), "r-nike");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(
      page.locator('[data-resource-id="r-nike"]').getByTestId("allocation-bar").filter({ hasText: "Brand System" }),
    ).toBeVisible();
  });

  test("snaps the project to a placeholder bound project when chosen", async ({ page }) => {
    // Placeholders are hidden by default (per-account pref) — turn them on in Settings first so
    // the seeded placeholder's lane (and its "+" button) appears in the schedule.
    await page.getByRole("link", { name: "Settings" }).click();
    await showPlaceholders(page);
    await page.getByRole("link", { name: "Schedule" }).click();
    await setZoom(page, 4);
    await resetSchedulerScroll(page);
    // Open create mode from the placeholder's OWN row (in create mode the assignee is fixed to the
    // clicked row). The seeded "Senior Designer" slot shows as "Placeholder" and is bound to p-acme.
    await page.getByRole("button", { name: "Add allocation for Placeholder" }).click();
    const dialog = page.getByRole("dialog", { name: "New allocation" });
    const project = dialog.getByLabel("Project", { exact: true });
    await expect(project).toHaveText(/Project Watchtower/); // bound project preselected
    // "Locked" = restricted to the bound project + both project-less scopes, but the select stays
    // ENABLED so a placeholder can still take Internal or Any Project work. A non-bound project
    // ("Metropolis Rebrand") is not offered.
    await expect(project).toBeEnabled();
    await project.click();
    await expect(page.getByRole("option", { name: "Internal", exact: true })).toBeVisible();
    await expect(page.getByRole("option", { name: "Any Project", exact: true })).toBeVisible();
    await expect(page.getByRole("option", { name: /Metropolis Rebrand/ })).toHaveCount(0);
  });

  test("rejects empty dates and accepts a listed hours option", async ({ page }) => {
    await page.getByRole("button", { name: "Add allocation for Clark Kent" }).click();
    const dialog = page.getByRole("dialog", { name: "New allocation" });
    await selectShadOption(dialog.getByLabel("Project", { exact: true }), "p-acme");
    await selectShadOption(dialog.getByRole("combobox", { name: "Activity", exact: true }), "t-wires");

    await dialog.getByLabel("Start").fill("");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("alert")).toContainText(/start and end dates are required/i);

    await dialog.getByLabel("Start").fill("2026-06-01");
    // A required field's label carries a trailing " *", so an exact match won't do.
    await dialog.getByLabel(/^End/).fill("2026-06-02");
    await selectShadOption(dialog.getByRole("combobox", { name: "Hours / day" }), "1");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);
  });
});
