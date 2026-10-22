import { test, expect } from "./fixtures";
import { selectShadOption, setZoom, showScheduleFilters } from "./browserTestSupport";
import { openApp } from "./appEntrySupport";
import { resetSchedulerScroll } from "./schedulerGeometrySupport";

// Covers US-CLI-04, the built-in "Internal" pseudo-client.
test.describe("Internal client", () => {
  test("Internal is HIDDEN from the Clients management list, but stays selectable + a binding target", async ({
    page,
  }) => {
    await openApp(page, "Wayne Enterprises", "/clients");
    await expect(page.getByTestId("client-row").filter({ hasText: "Internal" })).toHaveCount(0);
    const queenRow = page.getByTestId("client-row").filter({ hasText: "Queen" });
    await expect(queenRow).toBeVisible();
    await expect(queenRow.getByRole("button", { name: /^Edit / })).toBeVisible();
    await expect(queenRow.getByRole("button", { name: "Archive Queen Consolidated" })).toBeVisible();

    // It is still selectable as a project's client in ProjectForm's client picker (name chosen
    // without "Internal" in it, so the client-label assertion below can't pass by accident).
    // Navigate in-app; a fresh page.goto would re-show the account picker because the active
    // account is not persisted.
    await page.getByRole("link", { name: "Projects" }).click();
    await page.getByRole("button", { name: "Add project" }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Quarterly planning");
    await selectShadOption(page.getByLabel("Client"), { label: "Internal" });
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByTestId("project-row").filter({ hasText: "Quarterly planning" })).toContainText("· Internal");
  });

  test("an activity can be created under Internal with no project (internal kind)", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/activities");
    await page.getByRole("button", { name: "Add activity" }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Team retro");
    await page.getByRole("radio", { name: "Internal" }).click();
    await expect(page.getByLabel("Project")).toHaveCount(0);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(
      page.getByTestId("internal-activities").getByTestId("activity-row").filter({ hasText: "Team retro" }),
    ).toBeVisible();
  });

  test("Filter by client → Internal shows project-less (Internal-bucketed) work", async ({ page }) => {
    await openApp(page);
    await showScheduleFilters(page);
    // Widen + scroll to the origin so the seed's project-less all-projects "Design" booking (Barry,
    // 8–10 June) is on-screen.
    await setZoom(page, 4);
    await resetSchedulerScroll(page);
    await expect(page.getByTestId("allocation-bar").filter({ hasText: "Brand System" })).toBeVisible();
    const barryRow = page.getByTestId("scheduler-row").filter({ hasText: "Barry Allen" });
    const internalDesignBar = barryRow.getByTestId("allocation-bar").filter({ hasText: "Design" });
    await expect(internalDesignBar).toBeVisible();
    await selectShadOption(page.getByLabel("Filter by client"), {
      label: "Internal",
    });
    await expect(page.getByTestId("allocation-bar").filter({ hasText: "Brand System" })).toHaveCount(0);
    await expect(internalDesignBar).toBeVisible();
    await expect(page.getByTestId("allocation-bar")).toHaveCount(1);
  });
});
