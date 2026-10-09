import { test, expect } from "./fixtures";
import { openApp } from "./browserTestSupport";

test.use({ contextOptions: { reducedMotion: "reduce" } });

// The build stamp and Send-feedback link only exist in builds made with
// VITE_CAPACITYLENS_BUILD_SHA / VITE_CAPACITYLENS_FEEDBACK_MAILTO set (the deploy script does that).
// The dev server never sets them, so against this suite the correct behaviour is ABSENCE.

test.describe("Diagnostics build stamp + feedback link", () => {
  test("no build stamp in the default dev build", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/diagnostics");
    await expect(page.getByTestId("diagnostics-report-text")).toBeVisible();
    await expect(page.getByTestId("build-stamp")).toHaveCount(0);
  });

  test("no Send feedback link in the default dev build", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/diagnostics");
    await expect(page.getByTestId("diagnostics-report-text")).toBeVisible();
    await expect(page.getByTestId("send-feedback")).toHaveCount(0);
  });
});
