import { test, expect, type Locator } from "./fixtures";
import { computedStyles, disableCssMotion, expectConnectedSelectionEdges, openApp } from "./helpers";

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

  await segments[0].focus();
  await expect(segments[0]).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(segments[1]).toBeFocused();
  expect((await selectedTreatment(segments[1])).zIndex).toBe("20");
});
