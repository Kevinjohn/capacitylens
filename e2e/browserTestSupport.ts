import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

/** Disables the free-scroll week snap before each page load so a test can keep the grid parked mid-week.
 * Settings has no control for this preference. Call before openApp; the init script applies
 * capacitylens/snapToWeekStart on every load. The idle re-floor delay is WEEK_SNAP_IDLE_MS. */
export async function disableWeekSnap(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem("capacitylens/snapToWeekStart", "off"));
}

/** Seed the persisted explicit theme before the app's pre-paint script runs. */
export async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.addInitScript((value) => localStorage.setItem("capacitylens/theme", value), theme);
}

/** Read a small named set of computed CSS properties from one rendered element. */
export async function computedStyles<const Properties extends readonly string[]>(
  locator: Locator,
  properties: Properties,
): Promise<Record<Properties[number], string>> {
  return locator.evaluate((element, names) => {
    const style = getComputedStyle(element);
    return Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name)])) as Record<
      Properties[number],
      string
    >;
  }, properties);
}

/**
 * Reach a target through real keyboard navigation. `:focus-visible` depends on input modality, so
 * programmatic focus does not reproduce a keyboard user and can diverge across browsers. For a
 * roving-tabindex group, the selected item is the group's tab stop. Call this helper before any
 * mouse interaction in the test, or `:focus-visible` will not match.
 * @throws An error named FocusByKeyboardError when the target is not reached within 100 Tab presses.
 */
export async function focusByKeyboard(page: Page, target: Locator): Promise<number> {
  const maxTabPresses = 100;
  for (let tabPresses = 1; tabPresses <= maxTabPresses; tabPresses += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => element === document.activeElement)) return tabPresses;
  }

  const error = new Error(`Target was not reached after ${maxTabPresses} Tab presses`);
  error.name = "FocusByKeyboardError";
  throw error;
}

/** Select every connected segment and prove the active separator edges are cleared. */
export async function expectConnectedSelectionEdges(
  group: Locator,
  afterSelect?: (selected: Locator, index: number) => Promise<void>,
): Promise<void> {
  const items = group.getByRole("radio");
  const count = await items.count();
  for (let selectedIndex = 0; selectedIndex < count; selectedIndex += 1) {
    const selected = items.nth(selectedIndex);
    await selected.click();
    await expect(selected).toHaveAttribute("aria-checked", "true");
    await selected.evaluate((element) => (element as HTMLElement).blur());

    const shadows = await items.evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).boxShadow),
    );
    expect(shadows[selectedIndex]).not.toContain("inset 1px 0px");
    if (selectedIndex + 1 < count) expect(shadows[selectedIndex + 1]).not.toContain("inset 1px 0px");
    await afterSelect?.(selected, selectedIndex);
  }
}

/** Remove CSS motion before an assertion that reads rendered colours or geometry.
 *
 * `reducedMotion: 'reduce'` shortens the app's animations, but WebKit can briefly retain a
 * composited opacity frame after the animation reports as finished. Axe then samples the blended
 * frame and reports false low-contrast violations. Installing the override before opening the
 * animated surface and waiting for two paint frames makes those assertions deterministic without
 * weakening the accessibility rules being checked. */
export async function disableCssMotion(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
      }
    `,
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/** Returns the rendered bounding box.
 * @throws Error when the locator has no rendered box, so geometry assertions cannot proceed with null.
 */
export async function boundingBoxOrThrow(
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await locator.boundingBox();
  if (!b) throw new Error("no bounding box");
  return b;
}

/** Shrink to a phone-portrait viewport and dismiss the resulting "Best in landscape" hint dialog,
 * for specs that need the narrow layout without testing the hint itself (see mobile.spec.ts for
 * that coverage). */
export async function dismissLandscapeHint(page: Page): Promise<void> {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.getByRole("dialog", { name: "Best in landscape" }).getByRole("button", { name: "Got it" }).click();
}

/** Choose an option through a ShadCN Select's visible listbox, by stored value or visible label. */
export async function selectShadOption(trigger: Locator, option: string | { label: string }): Promise<void> {
  await trigger.click();
  const content = trigger.page().locator('[data-slot="select-content"][data-state="open"]');
  if (typeof option === "string") {
    await content.locator(`[role="option"][data-value="${option}"]`).click();
  } else {
    await content.getByRole("option", { name: option.label, exact: true }).click();
  }
  // Don't hand back control until the popup has actually gone: while it is open Radix puts
  // `pointer-events: none` on the body, so the caller's very next click can silently miss.
  await expect(content).toHaveCount(0);
}

/** Set the schedule toolbar's "Weeks visible" dropdown. Centralised so every zoom-dependent spec
 * goes through one locator. */
export async function setZoom(page: Page, weeks: 1 | 2 | 4 | 6 | 8): Promise<void> {
  await selectShadOption(page.getByRole("combobox", { name: "Weeks visible" }), String(weeks));
}

/** Reveal the schedule's secondary filter row when a flow needs one of its controls. */
export async function showScheduleFilters(page: Page): Promise<void> {
  const show = page.getByRole("button", { name: "Show filters" });
  const hide = page.getByRole("button", { name: "Hide filters" });
  await show.or(hide).first().waitFor();
  if (await show.isVisible()) await show.click();
  await expect(hide).toHaveAttribute("aria-expanded", "true");
}

/** Turn on the "Show placeholders" per-account pref (default off) from Settings, for specs that
 * just need placeholders visible rather than testing the toggle itself. */
export async function showPlaceholders(page: Page): Promise<void> {
  const toggle = page.getByRole("switch", { name: "Show placeholders" });
  if ((await toggle.getAttribute("aria-checked")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
}

/** Turn on workspace inline activity creation from Settings for flows that exercise the opt-in UI. */
export async function enableInlineActivityCreation(page: Page): Promise<void> {
  const toggle = page.getByRole("switch", { name: "Inline activity creation" });
  if ((await toggle.getAttribute("aria-checked")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
}

/** Re-anchor the schedule on the seeded week. `freezeBrowserDate` pins the clock to 2026-06-03,
 * whose week start is 2026-06-01, so **Today** puts the seed week's Monday at the left edge. */
export async function goToSeedWeek(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Today", exact: true }).click();
}
