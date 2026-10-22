import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { WEEK_SNAP_IDLE_MS } from "../src/lib/schedulerConfig";

/** Snap the scheduler grid's horizontal scroll back to 0. A literal DOM write resetting to the
 * timeline origin, deliberately not `goToSeedWeek`, which drives app navigation instead. */
export async function resetSchedulerScroll(page: Page): Promise<void> {
  await page.getByTestId("scheduler-grid").evaluate((el) => {
    (el as HTMLElement).scrollLeft = 0;
    el.dispatchEvent(new Event("scroll"));
  });
}

/** Reports the visible timeline's left edge, day count, and weekday column width. */
export interface SchedulerGeometryProbe {
  leftDate: string;
  leftWeekday: string;
  visibleDays: number;
  weekdayWidth: number;
}

/**
 * Read settled scheduler geometry through semantic test hooks. Shared by every scroll/zoom spec so
 * sticky-column measurement, double-rAF settling and weekday-width selection cannot drift.
 * The scheduler grid, resource header and date tier must be mounted.
 * @throws When required DOM hooks are absent, rather than returning a substitute measurement.
 */
export async function probeSchedulerGeometry(page: Page): Promise<SchedulerGeometryProbe> {
  return page.evaluate(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const grid = document.querySelector('[data-testid="scheduler-grid"]') as HTMLElement;
    const resourceHeader = document.querySelector('[data-testid="scheduler-resource-header"]') as HTMLElement;
    const dayTier = document.querySelector('[data-testid="scheduler-day-tier"]') as HTMLElement;
    const cells = dayTier ? Array.from(dayTier.children) : [];
    const gridRect = grid.getBoundingClientRect();
    const laneLeft = resourceHeader.getBoundingClientRect().right;
    const weekdayLabel = (cell: Element) => {
      const spans = cell.querySelectorAll("span");
      return (spans[spans.length - 1]?.textContent || "").trim();
    };
    let leftDate = "";
    let leftWeekday = "";
    let visibleDays = 0;
    let weekdayWidth = 0;
    for (const cell of cells) {
      const rect = (cell as HTMLElement).getBoundingClientRect();
      const label = weekdayLabel(cell);
      if (!leftDate && rect.right > laneLeft + 1) {
        leftDate = (cell.textContent || "").trim();
        leftWeekday = label;
      }
      if (rect.right > laneLeft && rect.left < gridRect.right) visibleDays += 1;
      if (!weekdayWidth && label.length === 3) weekdayWidth = rect.width;
    }
    return { leftDate, leftWeekday, visibleDays, weekdayWidth };
  });
}

/** Waits for horizontal scrolling to settle, then returns the date at the timeline's left edge. */
export async function settledSchedulerLeftDate(page: Page): Promise<string> {
  const grid = page.getByTestId("scheduler-grid");
  let last = Number.NaN;
  await expect
    .poll(
      async () => {
        const current = await grid.evaluate((node) => (node as HTMLElement).scrollLeft);
        const stable = current === last;
        last = current;
        return stable;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return (await probeSchedulerGeometry(page)).leftDate;
}

/** Scrolls the timeline by the measured width of the requested number of weekday columns. */
export async function nudgeScheduler(page: Page, columns: number): Promise<void> {
  const { weekdayWidth } = await probeSchedulerGeometry(page);
  await page.getByTestId("scheduler-grid").evaluate(
    (node, delta) => {
      (node as HTMLElement).scrollLeft += delta;
    },
    Math.round(weekdayWidth * columns),
  );
}

/** The month label covering the left edge of the visible timeline (e.g. "Jun 2026"). The date header
 * always renders every month in the window, so `getByText("Jul 2026")` proves nothing about where
 * the window sits, this reads the month block that actually spans the first visible column. */
export async function schedulerLeftMonthLabel(page: Page): Promise<string> {
  return page.evaluate(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const header = document.querySelector('[role="columnheader"][aria-colindex="2"]') as HTMLElement;
    const resourceHeader = document.querySelector('[data-testid="scheduler-resource-header"]') as HTMLElement;
    const laneLeft = resourceHeader.getBoundingClientRect().right;
    const monthTier = header.firstElementChild as HTMLElement;
    for (const block of Array.from(monthTier.children)) {
      if (block.getBoundingClientRect().right > laneLeft + 1) return (block.textContent || "").trim();
    }
    return "";
  });
}

/** Leave the production idle timer plus layout/paint margin before asserting snap or no-snap. */
export async function waitForWeekSnap(page: Page): Promise<void> {
  await page.waitForTimeout(WEEK_SNAP_IDLE_MS + 280);
}
