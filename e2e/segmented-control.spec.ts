import { test, expect, type Locator } from "./fixtures";
import {
  computedStyles,
  disableCssMotion,
  expectConnectedSelectionEdges,
  focusByKeyboard,
  openApp,
} from "./helpers";

async function selectedTreatment(segment: Locator) {
  const style = await computedStyles(segment, [
    "border-top-width",
    "border-right-width",
    "border-bottom-width",
    "border-left-width",
    "box-shadow",
    "background-color",
    "z-index",
  ]);
  return {
    borderWidths: [
      style["border-top-width"],
      style["border-right-width"],
      style["border-bottom-width"],
      style["border-left-width"],
    ],
    boxShadow: style["box-shadow"],
    backgroundColor: style["background-color"],
    zIndex: style["z-index"],
  };
}

async function expectSelectedTreatment(segment: Locator) {
  const treatment = await selectedTreatment(segment);
  expect(treatment.borderWidths).toEqual(["1px", "1px", "1px", "1px"]);
  expect(treatment.zIndex).toBe("10");
  expect(treatment.boxShadow).not.toMatch(/[1-9]\d*px/);
}

test("segmented controls keep an even selected outline at every position", async ({ page }) => {
  await openApp(page, "Wayne Enterprises", "/settings");
  await disableCssMotion(page);

  const group = page.getByRole("radiogroup", { name: "Scheduling input" });
  const segments = [
    page.getByRole("radio", { name: "Hours", exact: true }),
    page.getByRole("radio", { name: "Days", exact: true }),
    page.getByRole("radio", { name: "Blocks", exact: true }),
  ];
  const initialWidth = await group.evaluate((element) => element.getBoundingClientRect().width);

  for (const theme of ["Light", "Dark"] as const) {
    await page.getByRole("radio", { name: theme, exact: true }).click();

    await expectConnectedSelectionEdges(group, async (segment) => {
      await expectSelectedTreatment(segment);
      await expect.poll(() => group.evaluate((element) => element.getBoundingClientRect().width)).toBe(initialWidth);
    });
  }

  const selected = segments[1];
  await selected.click();
  const selectedBackground = (await selectedTreatment(selected)).backgroundColor;
  await selected.hover();
  expect((await selectedTreatment(selected)).backgroundColor).toBe(selectedBackground);
});

test("keyboard focus raises a segment above its neighbours", async ({ page }) => {
  await openApp(page, "Wayne Enterprises", "/settings");
  await disableCssMotion(page);

  const group = page.getByRole("radiogroup", { name: "Scheduling input" });
  const segments = [
    group.getByRole("radio", { name: "Hours", exact: true }),
    group.getByRole("radio", { name: "Days", exact: true }),
    group.getByRole("radio", { name: "Blocks", exact: true }),
  ];
  const [hours, days] = segments;

  // Keep this test mouse-free: prior clicks suppress modality-gated `:focus-visible`, while
  // Chromium and Firefox disagree about whether programmatic focus should reveal it.
  await focusByKeyboard(page, hours);
  await expect(hours).toBeFocused();
  expect((await selectedTreatment(hours)).zIndex).toBe("20");
  await page.keyboard.press("ArrowRight");
  await expect(days).toBeFocused();
  expect((await selectedTreatment(days)).zIndex).toBe("20");
});
