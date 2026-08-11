import { test, expect } from "./fixtures";
import { freezeBrowserDate, openApp } from "./helpers";

// Covers US-NAV-01, 02, 06. (Loading gate, persist-error banner, toast and error
// boundary are covered by unit tests / manual scripts — impractical to trigger reliably in E2E.)
const deepDestinations = [
  ["/resources", "Resources"],
  ["/disciplines", "Disciplines"],
  ["/clients", "Clients"],
  ["/projects", "Projects"],
  ["/activities", "Activities"],
  ["/timeoff", "Time off"],
  ["/team", "Team & access"],
  ["/settings", "Settings"],
] as const;

test.describe("Navigation & shell", () => {
  // #216: exercise real document navigations, not React Router transitions. The Vite history
  // fallback must serve index.html, then the session-only company gate must preserve the URL.
  for (const [path, heading] of deepDestinations) {
    test(`valid deep link ${path} survives a browser reload`, async ({ page }) => {
      await freezeBrowserDate(page);
      const directResponse = await page.goto(path);
      expect(directResponse?.status()).toBe(200);
      expect(directResponse?.headers()["content-type"]).toContain("text/html");

      const signIn = page.getByTestId("fake-sign-in");
      const company = page.getByRole("button", { name: "Wayne Enterprises", exact: true });
      await signIn.or(company).first().waitFor();
      if (await signIn.isVisible()) await signIn.click();
      await company.click();

      const destinationHeading = page.getByRole("heading", { name: heading, exact: true });
      const intro = page.getByTestId("intro-continue");
      await intro.or(destinationHeading).first().waitFor();
      if (await intro.isVisible()) await intro.click();
      await expect(destinationHeading).toBeVisible();

      const reloadResponse = await page.reload();
      expect(reloadResponse?.status()).toBe(200);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole("heading", { name: "Choose a company" })).toBeVisible();

      await company.click();
      await expect(destinationHeading).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
    });
  }

  test("an unknown extensionless path reaches the application's Not Found screen", async ({ page }) => {
    await openApp(page);
    const unknownResponse = await page.goto("/stale-bookmark-that-does-not-exist");
    expect(unknownResponse?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });

  test("sidebar links route to each section", async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId("scheduler-grid")).toBeVisible();

    const sections: [string, () => Promise<void>][] = [
      ["Resources", async () => void (await expect(page.getByRole("button", { name: "Add resource" })).toBeVisible())],
      [
        "Team & access",
        async () => void (await expect(page.getByTestId("current-access")).toContainText("Demo access")),
      ],
      [
        "Disciplines",
        async () => void (await expect(page.getByRole("button", { name: "Add discipline" })).toBeVisible()),
      ],
      ["Clients", async () => void (await expect(page.getByRole("button", { name: "Add client" })).toBeVisible())],
      ["Projects", async () => void (await expect(page.getByRole("button", { name: "Add project" })).toBeVisible())],
      ["Activities", async () => void (await expect(page.getByRole("button", { name: "Add activity" })).toBeVisible())],
      ["Time off", async () => void (await expect(page.getByRole("button", { name: "Add time off" })).toBeVisible())],
      [
        "Settings",
        async () =>
          void (await expect(
            page.getByRole("heading", { name: "Account Options Selected at Creation" }),
          ).toBeVisible()),
      ],
    ];
    for (const [link, assert] of sections) {
      await page.getByRole("link", { name: link, exact: true }).click();
      await assert();
    }
    await page.getByRole("link", { name: "Schedule" }).click();
    await expect(page.getByTestId("scheduler-grid")).toBeVisible();
  });

  // Issues #169/#172. Assert real DOM order and the account block below it — mere presence of the
  // links passed under the old layout too, so only order proves the move happened.
  test("pins Team & access and Settings below the working destinations, above the account block", async ({ page }) => {
    await openApp(page);

    const hrefs = await page.locator("nav a").evaluateAll((links) => links.map((l) => l.getAttribute("href")));
    expect(hrefs).toEqual([
      "/",
      "/resources",
      "/disciplines",
      "/clients",
      "/projects",
      "/activities",
      "/timeoff",
      "/team",
      "/settings",
    ]);

    // Switch company then the avatar'd sign-out, both below the nav landmark.
    await expect(page.getByRole("button", { name: "Switch company" })).toBeVisible();
    await expect(page.getByTestId("nav-sign-out")).toBeVisible();

    // Import/export is gone from the sidebar and lives on Settings instead (#169).
    await expect(page.getByTestId("export-data")).toHaveCount(0);
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Import & export" })).toBeVisible();
    await page.getByRole("button", { name: "Import & export", exact: true }).click();
    await expect(page.getByTestId("export-data")).toBeVisible();
    await expect(page.getByTestId("import-data")).toBeVisible();
  });

  test("settings toggles the colour theme", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/settings");
    // Light is the default preference.
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.getByRole("radio", { name: "Light" })).toHaveAttribute("aria-checked", "true");

    await page.getByRole("radio", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.getByRole("radio", { name: "Light" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  // WCAG 2.4.2 (Page Titled): each route sets a descriptive document.title of "<nav label> · CapacityLens",
  // derived from the SAME nav labels — so the tab/history/bookmark differs per page rather than the
  // static "CapacityLens" index.html sets. Assert a couple of routes are distinct AND descriptive.
  test("each route sets a descriptive, distinct document.title", async ({ page }) => {
    await openApp(page);
    // The index route reads as the scheduler's nav label, not the bare brand.
    await expect(page).toHaveTitle("Schedule · CapacityLens");

    await page.getByRole("link", { name: "Resources", exact: true }).click();
    await expect(page).toHaveTitle("Resources · CapacityLens");

    await page.getByRole("link", { name: "Team & access", exact: true }).click();
    await expect(page).toHaveTitle("Team & access · CapacityLens");

    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page).toHaveTitle("Settings · CapacityLens");

    // Distinct from the static fallback and from each other (the bug was every route == "CapacityLens").
    await page.getByRole("link", { name: "Schedule", exact: true }).click();
    await expect(page).toHaveTitle("Schedule · CapacityLens");
    await expect(page).not.toHaveTitle("CapacityLens");
  });

  test("the active section is marked aria-current", async ({ page }) => {
    await openApp(page);
    await page.getByRole("link", { name: "Resources" }).click();
    await expect(page.getByRole("link", { name: "Resources" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: "Clients" })).not.toHaveAttribute("aria-current", "page");
  });

  test("uses blue identity, green positive actions and red destructive actions", async ({ page }) => {
    await openApp(page);

    await expect(page.getByText("CapacityLens", { exact: true }).first()).toHaveAttribute(
      "data-visual-intent",
      "brand",
    );

    await page.getByRole("link", { name: "Clients", exact: true }).click();
    await page.getByRole("button", { name: "Add client" }).click();
    const clientDialog = page.getByRole("dialog", { name: "Add client" });
    await expect(clientDialog.getByRole("button", { name: "Save" })).toHaveAttribute("data-variant", "default");
    await clientDialog.getByRole("button", { name: "Cancel" }).click();

    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Device data", exact: true }).click();
    await expect(page.getByTestId("clear-local-storage")).toHaveAttribute("data-variant", "danger-soft");
  });

  test("renders in dark mode", async ({ page }) => {
    // Dark is now an explicit preference, not OS-driven: seed the stored theme so
    // the pre-paint script in index.html resolves the app to dark.
    await page.addInitScript(() => localStorage.setItem("capacitylens/theme", "dark"));
    await openApp(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByTestId("scheduler-grid")).toBeVisible();
    await expect(page.getByText("Bruce Wayne")).toBeVisible();
  });

  // The sidebar collapse toggle's hover label is the shadcn Radix Tooltip (ui/tooltip.tsx),
  // not a native `title`. This runs cross-engine (e2e:browsers → Chromium/WebKit/Firefox) on
  // purpose: Radix Tooltip's hover behavior was the uncertainty that deferred this pass.
  test("the collapse toggle reveals its shadcn Tooltip on hover", async ({ page }) => {
    await openApp(page);
    // Desktop default = sidebar open, so the focusable toggle reads "Collapse menu" and
    // keeps that aria-label as its accessible name (the tooltip is supplementary).
    const toggle = page.getByRole("button", { name: "Collapse menu" });
    await expect(toggle).toBeVisible();
    // Closed: Radix mounts the tooltip only while open, so there's no role=tooltip yet.
    await expect(page.getByRole("tooltip", { name: "Collapse menu" })).toHaveCount(0);
    // Hover reveals it instantly (the provider uses delayDuration 0). This is the cross-engine
    // behavior the pass was deferred over; the toggle's aria-label stays its accessible name.
    await toggle.hover();
    await expect(page.getByRole("tooltip", { name: "Collapse menu" })).toBeVisible();
  });
});
