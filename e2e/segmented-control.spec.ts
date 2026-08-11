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

async function expectSelectedTreatment(segment: Locator, position: "first" | "later") {
  const treatment = await selectedTreatment(segment);
  expect(treatment.borderWidths.slice(0, 3)).toEqual(["1px", "1px", "1px"]);
  expect(treatment.zIndex).toBe("10");

  if (position === "first") {
    expect(treatment.borderWidths[3]).toBe("1px");
    expect(treatment.boxShadow).not.toMatch(/[1-9]\d*px/);
  } else {
    expect(treatment.borderWidths[3]).toBe("0px");
    expect(treatment.boxShadow).toContain("1px 0px 0px");
    expect(treatment.boxShadow).toContain("inset");
  }
}

test("segmented controls keep an even selected outline at every position", async ({ page }) => {
  await openApp(page, "Wayne Enterprises", "/settings");
  await disableCssMotion(page);

  const group = page.getByRole("radiogroup", { name: "Scheduling input" });
  const segments = [
    { locator: page.getByRole("radio", { name: "Hours", exact: true }), position: "first" as const },
    { locator: page.getByRole("radio", { name: "Days", exact: true }), position: "later" as const },
    { locator: page.getByRole("radio", { name: "Blocks", exact: true }), position: "later" as const },
  ];
  const initialWidth = await group.evaluate((element) => element.getBoundingClientRect().width);

  for (const theme of ["Light", "Dark"] as const) {
    await page.getByRole("radio", { name: theme, exact: true }).click();

    for (const segment of segments) {
      await segment.locator.click();
      await expect(segment.locator).toHaveAttribute("aria-checked", "true");
      await expectSelectedTreatment(segment.locator, segment.position);
      await expect.poll(() => group.evaluate((element) => element.getBoundingClientRect().width)).toBe(initialWidth);
    }
  }

  const selected = segments[1].locator;
  await selected.click();
  const selectedBackground = (await selectedTreatment(selected)).backgroundColor;
  await selected.hover();
  expect((await selectedTreatment(selected)).backgroundColor).toBe(selectedBackground);

  await segments[0].locator.focus();
  await expect(segments[0].locator).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(segments[1].locator).toBeFocused();
  expect((await selectedTreatment(segments[1].locator)).zIndex).toBe("10");

  const frozenWeekStart = page.getByRole("radio", { name: "Monday", exact: true });
  await expect(frozenWeekStart).toBeDisabled();
  await expect(frozenWeekStart).toHaveAttribute("aria-checked", "true");
  await expectSelectedTreatment(frozenWeekStart, "first");
});
