import { test, expect } from "./fixtures";
import {
  disableWeekSnap,
  waitForAppLanding,
  nudgeScheduler as nudge,
  openApp,
  probeSchedulerGeometry as probe,
  settledSchedulerLeftDate as settledLeftDate,
  setZoom,
  waitForWeekSnap,
} from "./browserTestSupport";

test.use({ contextOptions: { reducedMotion: "reduce" }, viewport: { width: 1440, height: 800 } });

// Covers US-SET-09. The week snap (always on, no Settings control) floors the schedule's left edge
// back to the current week's first day after a free scroll settles, so a stray nudge can't park the
// view on a Tue/Wed. With the test-only override off, the nudge sticks. Independent of Feature 1's
// always-on navigation snap (zoom / Prev-Next / date-picker), which is not under test here.
test.describe("Week snap", () => {
  test("a stray scroll nudge snaps back to the week start", async ({ page }) => {
    await openApp(page);
    await setZoom(page, 1);

    // Pre-condition: the left edge opens flush on the week start (Monday, default weekStartsOn).
    // Poll, not a single read: under parallel load (Firefox especially) the zoom-click scroll +
    // header layout can still be settling on the first probe, sampling a transient sub-pixel
    // boundary that reads as the adjacent weekend column. Polling retries until it settles on the
    // known-correct Monday; a genuinely drifted grid never settles and times out (not vacuous).
    await expect.poll(async () => (await probe(page)).leftWeekday).toBe("Mon");

    // Nudge ~2.5 weekday columns so the left edge would sit on a Wed/Thu.
    await nudge(page, 2.5);
    await waitForWeekSnap(page);

    // The floor-snap has pulled the left edge back to this week's Monday.
    await expect.poll(async () => (await probe(page)).leftWeekday).toBe("Mon");
  });

  test("the snap FLOORS to the current week (not NEAREST), even past the half-week", async ({ page }) => {
    await openApp(page);
    await setZoom(page, 1);

    // The frozen browser date is Wednesday, 3 June 2026, so the default Monday week begins on 1 June.
    // Read the settled left edge after zoom to confirm the schedule opens on that Monday.
    const mondayDate = await settledLeftDate(page);
    expect(mondayDate).toMatch(/Mon$/);

    // Nudge 4.5 weekday columns forward → the left edge lands on a Fri (Jun 5), which is past the
    // half-week. A nearest implementation would round forward to next Monday (Jun 8 → "8Mon"); a
    // correct floor pulls back to this week's Monday (Jun 1 → "1Mon"). This is the distinguishing
    // case the old ~2.5-column (Wed) test couldn't make, since there floor == nearest.
    await nudge(page, 4.5);
    await waitForWeekSnap(page);

    // The decisive assertion: same Monday date (floored back), not next Monday (rounded forward).
    // Poll the settled left edge onto the captured Monday, the floor-not-nearest oracle (it would
    // never settle to "1Mon" if the snap rounded forward to "8Mon"), so polling does not weaken it.
    await expect.poll(async () => settledLeftDate(page), { timeout: 15_000 }).toBe(mondayDate);
  });

  test("with a Sunday week-start, the free-scroll snap floors to Sunday (not a hardcoded Monday)", async ({ page }) => {
    // Set Sunday as the new company week start during creation, since this setting is fixed afterwards.
    // The free-scroll snap should return a midweek nudge to Sunday.
    await openApp(page, "Wayne Enterprises", "/settings");
    await page.getByRole("button", { name: "Switch company" }).click();
    await page.getByRole("button", { name: "New company" }).click();
    await page.getByLabel("Company name").fill("Sunday Co");
    // Select Sunday as the new company week start.
    await page.getByRole("radio", { name: "Sunday" }).click();
    await page.getByRole("button", { name: "Create company" }).click();
    // A post-create intro may precede the app; click through if it's up.
    await waitForAppLanding(page, page.locator("#main"));

    // Turn "Minimise weekends" off (device pref): with it on, a week-start Sunday is a (collapsed)
    // weekend labelled "S", indistinguishable from a Saturday, making the column-width probe
    // unreliable. Off → the Sunday reads a full "Sun" and every column is the same width.
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("switch", { name: "Minimise weekends" }).click();

    await page.getByRole("link", { name: "Schedule" }).click();
    await page.getByRole("button", { name: "Hide checklist", expanded: true }).click();
    await setZoom(page, 1);

    // The left edge now opens flush on a Sunday (the week start), not a Monday.
    await expect.poll(async () => (await probe(page)).leftWeekday).toBe("Sun");

    // Nudge ~2.5 columns off the Sunday, let the idle settle, and confirm it floors back to Sunday.
    await nudge(page, 2.5);
    await waitForWeekSnap(page);
    // Poll the settle on the known-correct Sunday (parallel-load Firefox can still be settling on a
    // single read); a grid that floored to the wrong day never settles here, so it isn't vacuous.
    await expect.poll(async () => (await probe(page)).leftWeekday).toBe("Sun");
  });

  test("with the test override OFF, the nudge sticks (and so proves the nudge moves off Monday)", async ({ page }) => {
    await disableWeekSnap(page);
    await openApp(page);
    await setZoom(page, 1);
    // Poll the open-flush precondition until the zoom-click scroll settles on Monday (parallel-load
    // Firefox can still be settling on a single read).
    await expect.poll(async () => (await probe(page)).leftWeekday).toBe("Mon");

    // With snapping disabled, the same nudge should stay on a midweek day.
    // This confirms the nudge moved away from Monday before the enabled snap test runs.
    await nudge(page, 2.5);
    await waitForWeekSnap(page);

    // A single post-settle read, not expect.poll: poll on a `not.toBe` would short-circuit on the
    // first transient non-Monday frame before any (wrong) snap could fire, passing vacuously.
    expect((await probe(page)).leftWeekday).not.toBe("Mon");
  });
});
