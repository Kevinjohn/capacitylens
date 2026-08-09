import { test, expect } from "./fixtures";
import {
  dismissIntroIfPresent,
  nudgeScheduler as nudge,
  openApp,
  probeSchedulerGeometry as probe,
  settledSchedulerLeftDate as settledLeftDate,
  setZoom,
  waitForWeekSnap,
} from "./helpers";

test.use({ contextOptions: { reducedMotion: "reduce" }, viewport: { width: 1440, height: 800 } });

// Covers US-SET-09. "Snap to week start" (device-global, default ON) floors the schedule's left
// edge back to the current week's first day after a FREE scroll settles, so a stray nudge can't
// park the view on a Tue/Wed. Off → the nudge sticks. Independent of Feature 1's always-on
// navigation snap (zoom / Prev-Next / date-picker), which is not under test here.
test.describe("Snap to week start", () => {
  test("the setting is on by default and persists across reload", async ({ page }) => {
    await openApp(page, "Studio North", "/settings");
    const toggle = page.getByRole("switch", { name: "Snap to week start" });
    await expect(toggle).toHaveAttribute("aria-checked", "true"); // default on

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    await page.reload();
    // Re-pick the company after reload (activeAccountId is never persisted) and re-open Settings.
    await page.getByRole("button", { name: "Studio North", exact: true }).click();
    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page.getByRole("switch", { name: "Snap to week start" })).toHaveAttribute("aria-checked", "false");
  });

  test("with the setting ON, a stray scroll nudge snaps back to the week start", async ({ page }) => {
    await openApp(page); // snap on by default
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
    await openApp(page); // snap on by default
    await setZoom(page, 1);

    // Pre-condition: the left edge opens flush on this week's Monday. Frozen clock 2026-06-03 (Wed),
    // week origin Monday 2026-06-01 → the leading day NUMBER here is "1". Read it only once the zoom-
    // click scroll has come to rest (settledLeftDate), so we capture the real Monday — not a transient
    // mid-scroll cell — and can prove the snap returns to the SAME Monday, not a different one.
    const mondayDate = await settledLeftDate(page); // "1Mon"
    expect(mondayDate).toMatch(/Mon$/);

    // Nudge 4.5 weekday columns forward → the left edge lands on a Fri (Jun 5), which is PAST the
    // half-week. A NEAREST implementation would round FORWARD to next Monday (Jun 8 → "8Mon"); a
    // correct FLOOR pulls BACK to this week's Monday (Jun 1 → "1Mon"). This is the distinguishing
    // case the old ~2.5-column (Wed) test couldn't make, since there floor == nearest.
    await nudge(page, 4.5);
    await waitForWeekSnap(page);

    // The decisive assertion: SAME Monday date (floored back), NOT next Monday (rounded forward).
    // Poll the settled left edge onto the captured Monday — the floor-not-nearest oracle (it would
    // never settle to "1Mon" if the snap rounded forward to "8Mon"), so polling does not weaken it.
    await expect.poll(async () => settledLeftDate(page), { timeout: 15_000 }).toBe(mondayDate);
  });

  test("with a Sunday week-start, the free-scroll snap floors to Sunday (not a hardcoded Monday)", async ({ page }) => {
    // weekStartsOn is FROZEN after creation (P1.14), so it can no longer be flipped in Settings;
    // capture Sunday at company creation via the onboarding form instead. With the snap ON, a free
    // nudge must then floor onto a SUNDAY — guarding against a hardcoded-Monday floor. (The snap pref
    // is device-global, default ON, so it needs no setup here.)
    await openApp(page, "Studio North", "/settings"); // land in the app first
    await page.getByRole("button", { name: "Switch company" }).click();
    await page.getByRole("button", { name: "New company" }).click();
    await page.getByLabel("Company name").fill("Sunday Co");
    await page.getByRole("radio", { name: "Sunday" }).click(); // capture the Sunday week-start
    await page.getByRole("button", { name: "Create company" }).click();
    // A post-create intro may precede the app; click through if it's up.
    await dismissIntroIfPresent(page, page.locator("#main"));

    // Turn "Minimise weekends" OFF (device pref): with it on, a week-start Sunday is a (collapsed)
    // weekend labelled "S", indistinguishable from a Saturday, making the column-width probe
    // unreliable. Off → the Sunday reads a full "Sun" and every column is the same width.
    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByRole("switch", { name: "Minimise weekends" }).click();

    await page.getByRole("link", { name: "Schedule" }).click();
    await page.getByTestId("getting-started-dismiss").click();
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

  test("with the setting OFF, the nudge sticks (and so proves the nudge moves off Monday)", async ({ page }) => {
    await openApp(page, "Studio North", "/settings");
    const toggle = page.getByRole("switch", { name: "Snap to week start" });
    await toggle.click(); // → off
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    await page.getByRole("link", { name: "Schedule" }).click();
    await setZoom(page, 1);
    // Poll the open-flush precondition until the zoom-click scroll settles on Monday (parallel-load
    // Firefox can still be settling on a single read).
    await expect.poll(async () => (await probe(page)).leftWeekday).toBe("Mon");

    // Same nudge as the ON test — with the pref off it must STICK on the mid-week day. This
    // doubles as the proof that the nudge actually leaves Monday (otherwise the ON test is vacuous).
    await nudge(page, 2.5);
    await waitForWeekSnap(page);

    // A single post-settle read, NOT expect.poll: poll on a `not.toBe` would short-circuit on the
    // first transient non-Monday frame before any (wrong) snap could fire, passing vacuously.
    expect((await probe(page)).leftWeekday).not.toBe("Mon");
  });
});
