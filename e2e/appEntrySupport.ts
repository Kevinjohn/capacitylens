import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

// Freeze browser Date inside the June seed window so scheduler tests remain independent of the wall clock.
// Keep timers native because Firefox clock emulation can run pending scroll frames during Strict Mode layout replay.
// Noon leaves a margin for host and browser time-zone differences.
const FIXED_NOW = "2026-06-03T12:00:00";

/** Freeze only the browser's Date constructor and Date.now, leaving every timer API native. */
export async function freezeBrowserDate(page: Page): Promise<void> {
  await page.addInitScript((fixedNow) => {
    const NativeDate = Date;
    const fixedMs = new NativeDate(fixedNow).getTime();

    function FixedDate(this: Date, ...args: unknown[]) {
      if (!new.target) return new NativeDate(fixedMs).toString();
      return Reflect.construct(NativeDate, args.length ? args : [fixedMs], new.target);
    }

    Object.setPrototypeOf(FixedDate, NativeDate);
    FixedDate.prototype = NativeDate.prototype;
    Object.defineProperty(FixedDate, "name", { value: "Date" });
    Object.defineProperty(FixedDate, "now", { value: () => fixedMs });
    globalThis.Date = FixedDate as unknown as DateConstructor;
  }, FIXED_NOW);
}

/** Wait for a destination inside the application shell and clear first-use guidance when present. */
export async function waitForAppLanding(page: Page, landedOn: Locator): Promise<void> {
  await landedOn.waitFor();
  const orientation = page.getByTestId("product-orientation");
  if (await orientation.isVisible()) {
    await orientation.getByRole("button", { name: "Got it" }).click();
  }
}

// The seeded demo is multi-company, so it shows the full-screen account picker on every load. A
// server-backed login with exactly one valid company may skip it on a browser reload, but
// activeAccountId itself remains unpersisted. Almost every core spec wants the seeded company, so
// they navigate through `openApp` instead of `goto('/')`.
/** Opens a seeded company at the requested path and dismisses optional non-blocking orientation after the app shell mounts. */
export async function openApp(page: Page, company = "Wayne Enterprises", path = "/"): Promise<void> {
  // Must precede goto so the app reads the frozen date on its first render.
  await freezeBrowserDate(page);
  await page.goto(path);
  // A persisted demo sign-in flag can bypass this gate, so wait for either sign-in or the company picker.
  const signIn = page.getByTestId("fake-sign-in");
  const companyButton = page.getByRole("button", { name: company, exact: true });
  await signIn.or(companyButton).first().waitFor();
  if (await signIn.isVisible()) await signIn.click();
  // The picker lists the seeded companies; the open button's accessible name is
  // exactly the company name (the Delete button is "Delete <company>").
  // Picking an account leaves the URL intact, so a deep link like `/resources`
  // still lands on that route once the tenant gate clears.
  await companyButton.click();
  // Wait for the mounted app shell before dismissing its optional non-blocking orientation.
  await waitForAppLanding(page, page.locator("#main"));
}

/** Opens the new-company form without submitting it, so specs can inspect its initial fields. */
export async function openNewCompanyForm(page: Page): Promise<void> {
  // Must precede goto so the app reads the frozen date on its first render.
  await freezeBrowserDate(page);
  await page.goto("/");
  const signIn = page.getByTestId("fake-sign-in");
  const newCompany = page.getByRole("button", { name: "New company" });
  await signIn.or(newCompany).first().waitFor();
  if (await signIn.isVisible()) await signIn.click();
  await newCompany.click();
}

/** Submits an already-open company form and dismisses optional orientation after #main is visible. */
export async function createCompany(page: Page, name: string): Promise<void> {
  await page.getByLabel("Company name").fill(name);
  await page.getByRole("button", { name: "Create company" }).click();
  const appMain = page.locator("#main");
  await waitForAppLanding(page, appMain);
  await expect(appMain).toBeVisible();
}

/** Creates an empty demo company through cosmetic sign-in and the picker, then dismisses optional orientation. */
export async function openNewCompany(page: Page, name: string): Promise<void> {
  await openNewCompanyForm(page);
  await createCompany(page, name);
}
