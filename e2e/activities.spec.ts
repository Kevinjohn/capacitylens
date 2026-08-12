import { test, expect } from "./fixtures";
import { openApp, selectShadOption, setZoom } from "./helpers";

// Covers the runnable US-ACT-01, US-ACT-03 and US-ACT-04 flows. US-ACT-02 remains manual while
// phase management is hidden.
test.describe("Activities", () => {
  test("fills the Activity kind control with equal segments without changing its interactions", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/activities");
    await page.getByRole("button", { name: "Add activity" }).click();

    const dialog = page.getByRole("dialog", { name: "Add activity" });
    const group = dialog.getByRole("radiogroup", { name: "Activity kind" });
    const segments = group.getByRole("radio");
    const field = group.locator('xpath=ancestor::*[@data-product-layout="label-control"][1]');

    const expectEqualFullWidthSegments = async (stacked: boolean) => {
      const [fieldBox, groupBox, segmentBoxes] = await Promise.all([
        field.boundingBox(),
        group.boundingBox(),
        segments.evaluateAll((elements) =>
          elements.map((element) => {
            const bounds = element.getBoundingClientRect();
            return {
              width: bounds.width,
              clientWidth: element.clientWidth,
              scrollWidth: element.scrollWidth,
            };
          }),
        ),
      ]);
      expect(fieldBox).not.toBeNull();
      expect(groupBox).not.toBeNull();
      expect(segmentBoxes).toHaveLength(3);
      expect(
        Math.max(...segmentBoxes.map(({ width }) => width)) - Math.min(...segmentBoxes.map(({ width }) => width)),
      ).toBeLessThanOrEqual(1);
      for (const segment of segmentBoxes) expect(segment.scrollWidth).toBeLessThanOrEqual(segment.clientWidth);

      if (stacked) {
        expect(Math.abs(groupBox!.x - fieldBox!.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(groupBox!.width - fieldBox!.width)).toBeLessThanOrEqual(1);
      } else {
        const projectBox = await dialog.getByLabel("Project").boundingBox();
        expect(projectBox).not.toBeNull();
        expect(Math.abs(groupBox!.x - projectBox!.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(groupBox!.width - projectBox!.width)).toBeLessThanOrEqual(1);
        const controlStart = (groupBox!.x - fieldBox!.x) / fieldBox!.width;
        const controlShare = groupBox!.width / fieldBox!.width;
        expect(controlStart).toBeGreaterThan(0.24);
        expect(controlStart).toBeLessThan(0.32);
        expect(controlShare).toBeGreaterThan(0.68);
        expect(controlShare).toBeLessThan(0.76);
      }
    };

    await expect(segments).toHaveText(["Internal", "Cross-project", "Project-specific"]);
    await expectEqualFullWidthSegments(false);
    await selectShadOption(dialog.getByLabel("Project"), "p-acme");

    const projectSpecific = dialog.getByRole("radio", { name: "Project-specific" });
    const crossProject = dialog.getByRole("radio", { name: "Cross-project" });
    await projectSpecific.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(crossProject).toBeFocused();
    await page.keyboard.press("Space");
    await expect(crossProject).toHaveAttribute("aria-checked", "true");
    await expect(dialog.getByLabel("Project")).toHaveCount(0);

    await projectSpecific.click();
    await expect(projectSpecific).toHaveAttribute("aria-checked", "true");
    await expect(dialog.getByLabel("Project")).toContainText("Select project");

    await page.setViewportSize({ width: 360, height: 800 });
    await page.getByRole("dialog", { name: "Best in landscape" }).getByRole("button", { name: "Got it" }).click();
    await expectEqualFullWidthSegments(true);
    await expect(page.locator("html")).toHaveJSProperty("scrollWidth", 360);

    await dialog.getByRole("radio", { name: "Internal" }).click();
    await expect(dialog.getByRole("radio", { name: "Internal" })).toHaveAttribute("aria-checked", "true");
    await expect(dialog.getByLabel("Project")).toHaveCount(0);
  });

  test("adds an internal, a cross-project, and a project-specific activity into their three sections", async ({
    page,
  }) => {
    await openApp(page, "Wayne Enterprises", "/activities");

    // Internal kind → project picker hidden, lands in the "Internal activities" section.
    await page.getByRole("button", { name: "Add activity" }).click();
    await expect(page.getByRole("radiogroup", { name: "Activity kind" }).getByRole("radio")).toHaveText([
      "Internal",
      "Cross-project",
      "Project-specific",
    ]);
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Internal sync");
    await page.getByRole("radio", { name: "Internal" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(
      page.getByTestId("internal-activities").getByTestId("activity-row").filter({ hasText: "Internal sync" }),
    ).toBeVisible();

    // Cross-project kind → project-less and usable across projects, lands in the "Cross-project activities" section.
    await page.getByRole("button", { name: "Add activity" }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Discovery workshop");
    await page.getByRole("radio", { name: "Cross-project" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(
      page
        .getByTestId("cross-project-activities")
        .getByTestId("activity-row")
        .filter({ hasText: "Discovery workshop" }),
    ).toBeVisible();

    // Project-specific kind (the default) → bound to a project, lands beneath one client heading
    // and one project heading in the "Project-specific activities" section.
    await page.getByRole("button", { name: "Add activity" }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Spec review");
    await selectShadOption(page.getByLabel("Project"), "p-acme");
    await page.getByRole("button", { name: "Save" }).click();
    const projectActivities = page.getByTestId("project-specific-activities");
    await expect(projectActivities.getByRole("heading", { name: "Queen Consolidated", level: 3 })).toBeVisible();
    await expect(projectActivities.getByRole("heading", { name: "Project Watchtower", level: 4 })).toBeVisible();
    await expect(projectActivities.getByTestId("activity-row").filter({ hasText: "Spec review" })).toBeVisible();
  });

  test("groups and sorts project activities by client, project, then activity", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/activities");
    const section = page.getByTestId("project-specific-activities");

    await expect(section.getByRole("heading", { level: 3 })).toHaveText(["LexCorp", "Queen Consolidated"]);
    await expect(section.getByRole("heading", { level: 4 })).toHaveText(["Metropolis Rebrand", "Project Watchtower"]);
    await expect(section.getByTestId("activity-row")).toHaveText([
      "Brand System",
      "CMS Review",
      "Visual Design",
      "Wireframes",
    ]);
    await expect(section.getByText("LexCorp", { exact: true })).toHaveCount(1);
    await expect(section.getByText("Metropolis Rebrand", { exact: true })).toHaveCount(1);
  });

  test("edits an activity name", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/activities");
    await page
      .getByTestId("activity-row")
      .filter({ hasText: "CMS Review" })
      .getByRole("button", { name: /^Edit / })
      .click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("CMS Build");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("activity-row").filter({ hasText: "CMS Build" })).toBeVisible();
  });

  test("deletes an activity and removes its allocation bars, restorable with undo", async ({ page }) => {
    await openApp(page);
    await setZoom(page, 4);
    await page.getByTestId("scheduler-grid").evaluate((el) => {
      (el as HTMLElement).scrollLeft = 0;
    });
    await expect(page.getByTestId("allocation-bar").filter({ hasText: "Wireframes" })).toBeVisible();

    await page.getByRole("link", { name: "Activities" }).click();
    await page
      .getByTestId("activity-row")
      .filter({ hasText: "Wireframes" })
      .getByRole("button", { name: "Delete" })
      .click();
    await page.getByRole("alertdialog", { name: "Delete activity?" }).getByRole("button", { name: "Delete" }).click();
    await expect(page.getByTestId("activity-row").filter({ hasText: "Wireframes" })).toHaveCount(0);

    await page.getByRole("link", { name: "Schedule" }).click();
    await setZoom(page, 4);
    await page.getByTestId("scheduler-grid").evaluate((el) => {
      (el as HTMLElement).scrollLeft = 0;
    });
    await expect(page.getByTestId("allocation-bar").filter({ hasText: "Wireframes" })).toHaveCount(0);

    await page.keyboard.press("Meta+z");
    await expect(page.getByTestId("allocation-bar").filter({ hasText: "Wireframes" })).toBeVisible();
    await page.getByRole("link", { name: "Activities" }).click();
    await expect(page.getByTestId("activity-row").filter({ hasText: "Wireframes" })).toBeVisible();
  });
});
