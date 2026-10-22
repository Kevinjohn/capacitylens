import { test, expect } from "./fixtures";
import { openApp, resetSchedulerScroll, setZoom } from "./browserTestSupport";

test("privacy cleanup warns once, preserves the cancelled draft and skips warning after Restore is cleared", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openApp(page);
  await setZoom(page, 4);
  await resetSchedulerScroll(page);
  await expect(page.getByTestId("allocation-bar")).toHaveCount(6);
  await page.getByTestId("allocation-bar").filter({ hasText: "Brand System" }).click();
  await page.getByRole("dialog", { name: "Edit allocation" }).getByRole("button", { name: "Delete" }).click();
  await page.getByRole("alertdialog", { name: "Delete allocation?" }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByTestId("allocation-bar")).toHaveCount(5);
  await expect(page.getByTestId("undo-button")).toBeEnabled();

  await page.getByRole("link", { name: "Projects", exact: true }).click();
  const project = page.getByTestId("project-row").filter({ hasText: "Project Watchtower" });
  await project.getByRole("button", { name: /^Edit / }).click();
  const editor = page.getByRole("dialog", { name: "Edit project" });
  await editor.getByRole("switch", { name: "Use code name" }).click();
  await editor.getByLabel("Code name", { exact: true }).fill("Nightwatch");
  await editor.getByRole("button", { name: "Save", exact: true }).click();

  const warning = page.getByRole("alertdialog", { name: "This change clears 1 restorable item" });
  await expect(warning).toHaveCount(1);
  await expect(warning).toContainText("including unrelated deleted items");
  await page.screenshot({
    path: process.env.CAPACITYLENS_RESTORE_CAPTURE_PATH ?? testInfo.outputPath("restoration_cleanup_confirmation.png"),
  });
  await warning.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(warning).toHaveCount(0);
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel("Code name", { exact: true })).toHaveValue("Nightwatch");
  await expect(editor.getByRole("alert")).toHaveCount(0);

  // The second warning still counts the deleted booking, proving cancellation retained Restore.
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(warning).toHaveCount(1);
  await warning.getByRole("button", { name: "Save change", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(warning).toHaveCount(0);

  await project.getByRole("button", { name: /^Edit / }).click();
  await expect(editor.getByLabel("Code name", { exact: true })).toHaveValue("Nightwatch");
  await editor.getByLabel("Code name", { exact: true }).fill("Nightwing");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByTestId("restoration-cleanup-confirmation")).toHaveCount(0);

  await page.getByRole("link", { name: "Schedule", exact: true }).click();
  await resetSchedulerScroll(page);
  await expect(page.getByTestId("allocation-bar")).toHaveCount(5);
  await expect(page.getByTestId("undo-button")).toBeDisabled();
});
