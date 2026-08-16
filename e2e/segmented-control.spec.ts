import { test, expect, type Locator } from "./fixtures";
import { disableCssMotion, openApp } from "./helpers";

async function selectedTreatment(segment: Locator) {
  return segment.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      borderWidths: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
      boxShadow: style.boxShadow,
      backgroundColor: style.backgroundColor,
      zIndex: style.zIndex,
    };
  });
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

    for (const segment of segments) {
      await segment.click();
      await expect(segment).toHaveAttribute("aria-checked", "true");
      await segment.evaluate((element) => (element as HTMLElement).blur());
      await expectSelectedTreatment(segment);
      await expect.poll(() => group.evaluate((element) => element.getBoundingClientRect().width)).toBe(initialWidth);
    }
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
