import { test } from "./fixtures";

test("the global fixture rejects an uncaught browser exception after content renders", async ({ page }) => {
  test.fail(true, "The fixture must turn the probe pageerror into this expected test failure.");
  await page.setContent(`
    <main>Content rendered before the exception</main>
    <script>setTimeout(() => { throw new Error('browser error gate probe') }, 0)</script>
  `);
  await page.waitForTimeout(50);
});
