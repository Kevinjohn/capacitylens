import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import { freezeBrowserDate } from "./browserTestSupport";

test.use({ contextOptions: { reducedMotion: "reduce" } });

// US-NAV-11 covers the cosmetic demo sign-in gate before company selection when auth is disabled.
// It previews the "log in first, then pick a company" flow without authentication or a popup;
// clicking Continue advances to the picker. The real login flow is covered by login.auth.spec.ts.
// AppShell mounts this demo gate only when authMode is 'off'.

test.describe("fake sign-in (cosmetic demo gate)", () => {
  test("precedes the company picker; signing in reveals it, then the app", async ({ page }) => {
    await freezeBrowserDate(page);
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Choose an account" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Choose a company" })).toHaveCount(0);

    await page.getByTestId("fake-sign-in").click();
    await expect(page.getByRole("heading", { name: "Choose a company" })).toBeVisible();
    await expect(page.getByText("Signed in as Bruce Wayne")).toBeVisible();

    await page.getByRole("button", { name: "Wayne Enterprises", exact: true }).click();
    await expect(page.getByRole("heading", { name: "How CapacityLens works" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Choose a company" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Schedule" })).toBeVisible();

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

    // Dismissal removes the orientation itself; the surrounding app was already usable behind it,
    // so the schedule link is not evidence of the dismissal.
    await page.getByRole("button", { name: "Got it" }).click();
    await expect(page.getByTestId("product-orientation")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "How CapacityLens works" })).toHaveCount(0);
  });

  test("staying signed in persists across reload; Sign out returns to the demo sign-in", async ({ page }) => {
    await freezeBrowserDate(page);
    await page.goto("/");
    await page.getByTestId("fake-sign-in").click();
    await expect(page.getByRole("heading", { name: "Choose a company" })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: "Choose a company" })).toBeVisible();
    await expect(page.getByTestId("fake-sign-in")).toHaveCount(0);

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
