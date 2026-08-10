import { test, expect, type Locator } from "./fixtures";
import {
  goToSeedWeek,
  openApp,
  probeSchedulerGeometry as probe,
  schedulerLeftMonthLabel,
  selectShadOption,
  setZoom,
  settledSchedulerLeftDate,
  waitForWeekSnap,
} from "./helpers";

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("no bounding box");
  return b;
}

test.describe("Scheduler", () => {
  test("shows seeded resources, grouping and capacity cues", async ({ page }) => {
    await openApp(page);
    await expect(page.getByText("Bruce Wayne")).toBeVisible();
    await expect(page.getByTestId("discipline-group").filter({ hasText: "Design" })).toBeVisible();
    // Seed over-allocates Bruce on 3-4 June; weekends/time off are unavailable.
    const overMarker = page.getByTestId("over-marker").first();
    await expect(overMarker).toBeVisible();
    // The over-capacity day reads as a CLEAR, saturated red background (the dedicated
    // `danger-cell` token), not a faint blush. Resolve the computed fill to true sRGB bytes
    // by painting it onto a canvas and reading the pixel back — robust whether the engine
    // serialises the `color-mix(in oklab,…)` result as `rgb(…)`, `oklab(…)`, or `color(…)`.
    const rgba = await overMarker.evaluate((el) => {
      const bg = getComputedStyle(el).backgroundColor;
      const c = document.createElement("canvas");
      c.width = c.height = 1;
      const ctx = c.getContext("2d")!;
      // Opaque base so a (regressed) translucent fill blends toward white, not black —
      // a near-invisible alpha tint then reads as a near-white pixel and FAILS the gate.
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 1, 1);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a };
    });
    // Opaque fill (the old /12 alpha would composite away above; the cell itself is solid).
    expect(rgba.a).toBe(255);
    // Real saturation: R must lead the other channels by a wide margin. Light `danger-cell`
    // is ~rgb(251,158,161) → R − max(G,B) ≈ 90; a blush like rgb(255,230,230) (≈25) FAILS.
    expect(rgba.r - Math.max(rgba.g, rgba.b)).toBeGreaterThan(60);
    await expect(page.getByTestId("unavailable-day").first()).toBeVisible();
    await expect(page.getByTestId("utilization").first()).toBeVisible();
  });

  test("draws a new allocation on an empty part of a lane", async ({ page }) => {
    await openApp(page);
    await setZoom(page, 4);

    await expect(page.getByTestId("allocation-bar")).toHaveCount(6);
    const before = await page.getByTestId("allocation-bar").count();

    // reset horizontal scroll (scroll-to-today shifts the grid on mount)
    await page.getByTestId("scheduler-grid").evaluate((el) => {
      (el as HTMLElement).scrollLeft = 0;
    });
    const lane = page.getByTestId("resource-lane").first();
    const b = await box(lane);
    const y = b.y + b.height / 2;
    // The far-left of the lane (timeline origin) is empty for the first resource.
    await page.mouse.move(b.x + 6, y);
    await page.mouse.down();
    await page.mouse.move(b.x + 6 + 48 * 2, y, { steps: 8 });
    await page.mouse.up();

    await expect(page.getByRole("dialog", { name: "New allocation" })).toBeVisible();
    await selectShadOption(page.getByLabel("Project", { exact: true }), "p-acme");
    await selectShadOption(page.getByRole("combobox", { name: "Activity", exact: true }), "t-wires");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByTestId("allocation-bar")).toHaveCount(before + 1);
  });

  test("drags a bar to move it later", async ({ page }) => {
    await openApp(page);
    await setZoom(page, 4);

    const bar = page.getByTestId("allocation-bar").filter({ hasText: "Brand System" });
    const b0 = await box(bar);
    const cx = b0.x + b0.width / 2;
    const cy = b0.y + b0.height / 2;

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 60, cy, { steps: 8 }); // ~1 day right
    await page.mouse.up();

    const b1 = await box(bar);
    expect(b1.x).toBeGreaterThan(b0.x + 20);
  });

  test("resizes a bar via its end handle", async ({ page }) => {
    await openApp(page);
    await setZoom(page, 4);

    // "Wireframes" (4 days) keeps its right edge on-screen, unlike the 9-day "Brand System".
    const bar = page.getByTestId("allocation-bar").filter({ hasText: "Wireframes" });
    const b0 = await box(bar);
    const handle = bar.getByTestId("resize-end");
    const h = await box(handle);

    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + h.width / 2 + 60, h.y + h.height / 2, {
      steps: 8,
    }); // extend ~1 day
    await page.mouse.up();

    const b1 = await box(bar);
    expect(b1.width).toBeGreaterThan(b0.width + 20);
  });

  test("zooming to more weeks shrinks the day columns (same bar gets narrower)", async ({ page }, testInfo) => {
    await openApp(page);
    await expect(page.getByTestId("scheduler-grid")).toBeVisible();
    const bar = page.getByTestId("allocation-bar").filter({ hasText: "Brand System" });

    await setZoom(page, 1);
    await expect(page.getByRole("combobox", { name: "Weeks visible" })).toHaveText("1 week");
    const wide = await box(bar);
    await page.screenshot({
      path: testInfo.outputPath("capacitylens_1week.png"),
    });

    await setZoom(page, 8);
    await expect(page.getByRole("combobox", { name: "Weeks visible" })).toHaveText("8 weeks");
    const narrow = await box(bar);
    await page.screenshot({
      path: testInfo.outputPath("capacitylens_8week.png"),
    });

    // Same 9-day allocation is physically narrower when more weeks are visible.
    expect(narrow.width).toBeLessThan(wide.width);
  });

  test("clicking Today re-centres the timeline after scrolling away", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 800 });
    await openApp(page, "Wayne Enterprises", "/settings");

    // Turn F2 ("Snap to week start") OFF first. With the free-scroll snap armed, the 120ms idle
    // timer (WEEK_SNAP_IDLE_MS) re-floors the left edge to a Monday between our park and the probe
    // on slow runners, so a mid-week precondition can never be made stable. With it OFF the park
    // sticks, and the Monday landing after Today is attributable to Today's re-anchor alone.
    const snap = page.getByRole("switch", { name: "Snap to week start" });
    await snap.click();
    await expect(snap).toHaveAttribute("aria-checked", "false");

    await page.getByRole("link", { name: "Schedule" }).click();
    await setZoom(page, 1);
    const grid = page.getByTestId("scheduler-grid");
    await expect(grid).toBeVisible();

    // Scroll far to the right, then keep nudging by half a weekday column until the left edge sits
    // MID-WEEK (a fixed pixel offset can coincidentally align to a Monday — minimised weekend
    // columns make the week pitch non-uniform, so no single offset is safe on every start date).
    // The mid-week precondition is what proves Today actively re-anchors to the week start, rather
    // than the view having merely stayed put on a Monday.
    const { weekdayWidth } = await probe(page);
    await grid.evaluate((el) => {
      (el as HTMLElement).scrollLeft = 5000;
    });
    for (let attempt = 0; attempt < 10 && /Mon$/.test((await probe(page)).leftDate); attempt += 1) {
      await grid.evaluate(
        (el, dx) => {
          (el as HTMLElement).scrollLeft += dx;
        },
        Math.max(1, Math.round(weekdayWidth / 2)),
      );
    }
    // Let the idle timer elapse; the snap is OFF, so the mid-week park must STICK.
    await waitForWeekSnap(page);
    const scrolled = await grid.evaluate((el) => (el as HTMLElement).scrollLeft);
    expect(scrolled).toBeGreaterThan(800);
    expect((await probe(page)).leftDate).not.toMatch(/Mon$/);

    await page.getByRole("button", { name: "Today", exact: true }).click();

    // The grid re-scrolls back towards today (much smaller scrollLeft than where we were)…
    await expect.poll(() => grid.evaluate((el) => (el as HTMLElement).scrollLeft)).toBeLessThan(scrolled - 400);
    // …AND the left edge lands flush on the focus week's start (Monday), not a coarse pixel target.
    await expect.poll(async () => (await probe(page)).leftDate).toMatch(/Mon$/);
  });

  // This used to jump straight to August through the date picker. That picker is hidden as of
  // #173, so the same "the header follows the window into another month" behaviour is driven by
  // the controls that remain: Today, then Next a week at a time.
  test("paning forward moves the timeline into the next month", async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId("scheduler-grid")).toBeVisible();

    await goToSeedWeek(page); // left edge = Mon 2026-06-01
    await expect.poll(() => schedulerLeftMonthLabel(page)).toBe("Jun 2026");

    // Five weeks on from 1 June is Mon 6 July — the first left edge that is fully in July.
    for (let week = 0; week < 5; week += 1) await page.getByRole("button", { name: "Next" }).click();
    await expect.poll(() => schedulerLeftMonthLabel(page)).toBe("Jul 2026");
    expect(await settledSchedulerLeftDate(page)).toContain("Mon");
  });

  test("shows a detail popover on hover (US-SCH-15)", async ({ page }) => {
    await openApp(page);
    await setZoom(page, 4);
    await page.getByTestId("scheduler-grid").evaluate((el) => {
      (el as HTMLElement).scrollLeft = 0;
    });
    await page.getByTestId("allocation-bar").filter({ hasText: "Brand System" }).hover();
    const pop = page.getByTestId("allocation-popover");
    await expect(pop).toBeVisible();
    await expect(pop).toContainText("Metropolis Rebrand"); // project name in the popover
  });

  test("shows overall and per-discipline utilisation summaries (US-SCH-14)", async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId("overall-utilization")).toContainText("%");
    await expect(page.getByTestId("discipline-group").first()).toContainText(/avg utilisation/);
  });

  test("the week-range toggle recomputes utilisation over the visible window (US-SCH-14)", async ({ page }) => {
    await openApp(page);
    // Own the visible window explicitly instead of relying on the global frozen clock plus the
    // grid's first-measure scroll effect. A slow CI render can otherwise leave this test looking
    // at a zero-utilisation window outside the June seed even though the same fixture is stable
    // locally. June 1 is the shared left edge this zoom comparison is actually meant to exercise.
    await goToSeedWeek(page);
    await expect(page.getByText("Jun 2026")).toBeVisible();
    const overall = page.getByTestId("overall-utilization");
    const pct = async () => Number.parseInt((await overall.textContent())?.replace("%", "") ?? "", 10);

    // Per-person % for a known seeded resource row (Bruce Wayne). Its utilisation lives in the row
    // header's `utilization` testid, scoped to Bruce's scheduler-row so it can't pick up another
    // person's cell. Bruce is FRONT-LOADED in the seed (8h/day Mon–Thu of the frozen-clock week +
    // a tentative bar) → dense week 1 that idle later weeks dilute as the span widens.
    const bruceUtil = page.getByTestId("scheduler-row").filter({ hasText: "Bruce Wayne" }).getByTestId("utilization");
    const brucePct = async () => Number.parseInt((await bruceUtil.textContent())?.replace("%", "") ?? "", 10);

    // Read the overall + Bruce % for a given zoom AFTER it settles: click the toggle, wait for the
    // label to track the zoom, then poll BOTH numbers to a STABLE value (two equal reads in a row) —
    // the visible window re-anchors via a rAF after the scroll settles, so a bare read can race that.
    const readAtZoom = async (weeks: 1 | 2 | 4 | 8): Promise<{ overall: number; bruce: number }> => {
      await setZoom(page, weeks);
      await expect(page.getByRole("combobox", { name: "Weeks visible" })).toHaveText(
        weeks === 1 ? "1 week" : `${weeks} weeks`,
      );
      // The label tracks the zoom (no longer a fixed "next 2w").
      await expect(page.getByText(`Utilisation · ${weeks}w`)).toBeVisible();
      await expect(bruceUtil).toBeVisible(); // selector resolves to exactly Bruce's per-person cell
      let prev = { overall: NaN, bruce: NaN };
      await expect
        .poll(async () => {
          const next = { overall: await pct(), bruce: await brucePct() };
          // On a slower runner the account shell can render an initial 0%/0% frame before the
          // seeded scheduler model settles. Two fast reads of that placeholder are not evidence
          // that the zoom calculation has finished, so require the known seeded rows to carry
          // real utilisation before accepting a stable pair.
          const populated = next.overall > 0 && next.bruce > 0;
          const stable = populated && next.overall === prev.overall && next.bruce === prev.bruce;
          prev = next;
          return stable;
        })
        .toBe(true);
      return prev;
    };

    // The seed concentrates work in week 1 (early June, the frozen-clock week) and tapers off, so the
    // utilisation read over the visible window FALLS as the span widens (idle later weeks dilute the
    // dense first week). Monotone non-increasing because every span shares the same left edge.
    const wk1 = await readAtZoom(1);
    const wk2 = await readAtZoom(2);
    const wk4 = await readAtZoom(4);
    const wk8 = await readAtZoom(8);
    expect(wk1.overall).toBeGreaterThan(0);
    // Changing the toggle genuinely changes the OVERALL number to reflect the visible span.
    expect(wk1.overall).toBeGreaterThan(wk8.overall);
    expect(wk2.overall).toBeLessThanOrEqual(wk1.overall);
    expect(wk4.overall).toBeLessThanOrEqual(wk2.overall);
    expect(wk8.overall).toBeLessThanOrEqual(wk4.overall);
    // Per-person % moves in the SAME direction for a front-loaded resource: Bruce's dense week 1
    // reads higher at 1w than at 8w (the idle later weeks dilute it). Direction/inequality only —
    // no flaky exact-number race for the intermediate spans.
    expect(wk1.bruce).toBeGreaterThan(0);
    expect(wk1.bruce).toBeGreaterThanOrEqual(wk8.bruce);
  });

  test("stacks overlapping allocations onto a taller row (US-SCH-08)", async ({ page }) => {
    await openApp(page);
    await setZoom(page, 4);
    await page.getByTestId("scheduler-grid").evaluate((el) => {
      (el as HTMLElement).scrollLeft = 0;
    });
    // Bruce has two overlapping seed bars (3-4 June) -> 2 lanes; Clark has one -> 1 lane.
    const bruceBars = page.locator('[data-resource-id="r-tyler"]').getByTestId("allocation-bar");
    await expect(bruceBars).toHaveCount(2);
    const bruceRow = await page.getByTestId("scheduler-row").filter({ hasText: "Bruce Wayne" }).boundingBox();
    const clarkRow = await page.getByTestId("scheduler-row").filter({ hasText: "Clark Kent" }).boundingBox();
    expect(bruceRow!.height).toBeGreaterThan(clarkRow!.height); // stacked -> taller
  });

  test("marks today with a vertical line when in range (US-SCH-12)", async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId("today-line").first()).toBeVisible();
  });

  test("allocation status and note are visually distinct on the bar (US-SCH-19)", async ({ page }) => {
    await openApp(page);
    await setZoom(page, 4);
    await page.getByTestId("scheduler-grid").evaluate((el) => {
      (el as HTMLElement).scrollLeft = 0;
    });

    // Seed: Bruce's Visual Design bar is tentative (the placeholder also has a confirmed one).
    await expect(
      page.locator('[data-resource-id="r-tyler"]').getByTestId("allocation-bar").filter({ hasText: "Visual Design" }),
    ).toHaveAttribute("data-status", "tentative");

    // Mark Wireframes completed + add a note -> ✓ prefix and • marker.
    await page.getByTestId("allocation-bar").filter({ hasText: "Wireframes" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit allocation" });
    await selectShadOption(dialog.getByLabel("Status"), { label: "Completed" });
    await dialog.getByLabel("Note").fill("Handed off to QA");
    await page.getByRole("button", { name: "Save" }).click();

    const done = page.getByTestId("allocation-bar").filter({ hasText: "Wireframes" });
    await expect(done).toHaveAttribute("data-status", "completed");
    await expect(done).toContainText("✓");
    await expect(done).toContainText("•");
  });

  // Feature 1 (ALWAYS on): a zoom click and a Prev/Next pan re-anchor the grid's left edge to the
  // week start (account weekStartsOn, default Monday) — INDEPENDENT of Feature 2's "Snap to week
  // start" free-scroll pref. The audit found this test was CONFOUNDED: because F2 defaults ON, the
  // idle free-scroll snap masked the F1 navigation snap (disabling only F1 still left it green).
  // So we turn F2 OFF first — now a free nudge to a mid-week day STICKS, and the ONLY thing that can
  // re-anchor the left edge to a Monday is the navigation branch under test (zoom / Next / Prev).
  // Frozen clock 2026-06-03 (Wed); week origin Monday 2026-06-01 → the 1w view opens flush on "1Mon".
  test("navigation re-anchors the left edge to the week start (with the free-scroll snap OFF)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 800 });
    await openApp(page, "Wayne Enterprises", "/settings");

    // Turn F2 ("Snap to week start") OFF so the idle free-scroll snap can't mask the navigation snap.
    const snap = page.getByRole("switch", { name: "Snap to week start" });
    await snap.click();
    await expect(snap).toHaveAttribute("aria-checked", "false");

    await page.getByRole("link", { name: "Schedule" }).click();
    await setZoom(page, 1);

    // Header day cells read "<dayNum><EEE>", e.g. "1Mon"; a minimised weekend collapses to "<n>S".
    // We assert on the weekday suffix, and capture the leading day NUMBER to prove the window moved.
    const grid = page.getByTestId("scheduler-grid");
    const start = await probe(page);
    expect(start.leftDate).toMatch(/Mon$/); // the focused left edge opens on the current week's Monday
    const nudge = Math.round(start.weekdayWidth * 2.5);
    const dayNum = (s: string) => Number.parseInt(s, 10); // leading day number, e.g. "12Wed" → 12
    // The idle snap is OFF, so a nudge to a mid-week day must STICK — proving any later return to
    // Monday is attributable to NAVIGATION, not the free-scroll snap. (If the nudge didn't move off
    // Monday, every assertion below would be vacuous.)
    const nudgeOffMonday = async () => {
      await grid.evaluate((el, px) => {
        (el as HTMLElement).scrollLeft = px;
      }, nudge);
      await waitForWeekSnap(page);
      expect((await probe(page)).leftDate).not.toMatch(/Mon$/);
    };

    // (1) ZOOM snaps even with the pref OFF.
    await nudgeOffMonday();
    await setZoom(page, 2);
    await expect.poll(async () => (await probe(page)).leftDate).toMatch(/Mon$/);
    const afterZoom = dayNum((await probe(page)).leftDate);

    // (2) NEXT pans forward AND snaps: the window advances ~a week and lands on a Monday.
    await nudgeOffMonday();
    await page.getByRole("button", { name: "Next" }).click();
    await expect.poll(async () => (await probe(page)).leftDate).toMatch(/Mon$/);
    const afterNext = dayNum((await probe(page)).leftDate);
    expect(afterNext).toBeGreaterThan(afterZoom); // moved roughly a week forward (still a Monday)

    // (3) PREV pans backward AND snaps (this branch was previously UNtested). It must land on a
    // Monday EARLIER than the Next position — i.e. a real backward week step, not a no-op.
    await nudgeOffMonday();
    await page.getByRole("button", { name: "Prev" }).click();
    await expect.poll(async () => (await probe(page)).leftDate).toMatch(/Mon$/);
    const afterPrev = dayNum((await probe(page)).leftDate);
    expect(afterPrev).toBeLessThan(afterNext); // moved a week earlier (still a Monday)
  });
});
