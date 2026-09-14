import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import { freezeBrowserDate } from "./helpers";

test.use({ contextOptions: { reducedMotion: "reduce" } });

// US-NAV-11: a COSMETIC demo "fake sign-in" gate shown before the company picker in the
// default (auth-off) deploy, to preview the intended "log in first, then pick a company"
// flow. There is NO real authentication and no popup — clicking just advances. The auth-ON
// deploy (the real login wall) is covered by login.auth.spec.ts, where this demo gate stays
// dormant (AppShell only mounts it when authMode === 'off').

test.describe("fake sign-in (cosmetic demo gate)", () => {
  test("precedes the company picker; signing in reveals it, then the app", async ({ page }) => {
    await freezeBrowserDate(page);
    await page.goto("/");

    // The demo sign-in is the first screen — the picker is walled off behind it.
    await expect(page.getByRole("heading", { name: "Choose an account" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Choose a company" })).toHaveCount(0);

    // No popup, no password: clicking the account advances to the picker.
    await page.getByTestId("fake-sign-in").click();
    await expect(page.getByRole("heading", { name: "Choose a company" })).toBeVisible();
    await expect(page.getByText("Signed in as Bruce Wayne")).toBeVisible();

    // Pick a company → the schedule and its non-blocking first-use orientation.
    await page.getByRole("button", { name: "Wayne Enterprises", exact: true }).click();
    await expect(page.getByRole("heading", { name: "How CapacityLens works" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Choose a company" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Schedule" })).toBeVisible();

    // Accessibility oracle while the orientation and ordinary app remain available together.
    const introResults = await new AxeBuilder({ page }).analyze();
    const introBlocking = introResults.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(
      introBlocking,
      JSON.stringify(
        introBlocking.map((v) => ({ id: v.id, nodes: v.nodes.length })),
        null,
        2,
      ),
    ).toEqual([]);

    await page.getByRole("button", { name: "Got it" }).click();
    await expect(page.getByRole("link", { name: "Schedule" })).toBeVisible();
  });

  test("staying signed in persists across reload; Sign out returns to the demo sign-in", async ({ page }) => {
    await freezeBrowserDate(page);
    await page.goto("/");
    await page.getByTestId("fake-sign-in").click();
    await expect(page.getByRole("heading", { name: "Choose a company" })).toBeVisible();

    // The sign-in persists (device-global): a reload lands straight on the picker.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Choose a company" })).toBeVisible();
    await expect(page.getByTestId("fake-sign-in")).toHaveCount(0);

    // Sign out from the picker → back behind the demo sign-in, and it sticks on reload.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { name: "Choose an account" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Choose an account" })).toBeVisible();
  });

  test("has no serious or critical accessibility violations", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Choose an account" })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(
      blocking,
      JSON.stringify(
        blocking.map((v) => ({ id: v.id, nodes: v.nodes.length })),
        null,
        2,
      ),
    ).toEqual([]);
  });
});
