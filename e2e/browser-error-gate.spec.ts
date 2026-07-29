import { test } from "./fixtures";

test("the global fixture rejects an uncaught browser exception after content renders", async ({ page }) => {
  test.fail(true, "The fixture must turn the probe pageerror into this expected test failure.");
  await page.setContent(`
    <main>Content rendered before the exception</main>
    <script>setTimeout(() => { throw new Error('browser error gate probe') }, 0)</script>
  `);
  await page.waitForTimeout(50);
});

test("the global fixture rejects an uncaught exception on a registered secondary page", async ({
  newObservedContext,
}) => {
  test.fail(true, "The fixture must turn the secondary-page error into this expected test failure.");
  const context = await newObservedContext();
  const page = await context.newPage();
  await page.setContent(`<script>setTimeout(() => { throw new Error('secondary page error gate probe') }, 0)</script>`);
  await page.waitForTimeout(50);
  await context.close();
});
