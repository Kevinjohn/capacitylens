import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { openApp } from "./browserTestSupport";
import { buildBetaExport, serializeBetaExport } from "@capacitylens/shared/data/betaTransfer";
import { seedForCurrentWeek } from "@capacitylens/shared/data/seed";

const ACCOUNT_ID = "a-studio";

function restoredDocument() {
  const document = buildBetaExport(seedForCurrentWeek(), { accountId: ACCOUNT_ID, completeness: "full" });
  const person = document.data.resources.find((row) => row.name === "Bruce Wayne");
  if (!person) throw new Error("The demo person fixture is missing.");
  person.name = "Terry McGinnis";
  return document;
}

async function importFile(page: Page, body: string) {
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Import and export", exact: true }).click();
  await page.getByTestId("import-input").setInputFiles({
    name: "company-transfer.json",
    mimeType: "application/json",
    buffer: Buffer.from(body),
  });
}

test.describe("Beta company transfer in the demo", () => {
  test("starts with the seeded company", async ({ page }) => {
    await openApp(page);
    await expect(page.getByText("Bruce Wayne")).toBeVisible();
  });

  test("previews a full document without writing and Cancel keeps the current company", async ({ page }) => {
    await openApp(page);
    await importFile(page, serializeBetaExport(restoredDocument()));
    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Import data?" });
    await expect(dialog).toContainText("company-transfer.json");
    await expect(dialog).toContainText(/replaces this company’s data/i);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("link", { name: "Schedule", exact: true }).click();
    await expect(page.getByText("Bruce Wayne")).toBeVisible();
    await expect(page.getByText("Terry McGinnis")).toHaveCount(0);
  });

  test("replaces the selected company in memory and a reload restores the demo seed", async ({ page }) => {
    await openApp(page);
    await importFile(page, serializeBetaExport(restoredDocument()));
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Replace data" }).click();
    await page.getByRole("link", { name: "Schedule", exact: true }).click();
    await expect(page.getByText("Terry McGinnis")).toBeVisible();
    await expect(page.getByText("Bruce Wayne")).toHaveCount(0);
    await page.keyboard.press("Meta+z");
    await expect(page.getByText("Terry McGinnis")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Bruce Wayne")).toBeVisible();
    await expect(page.getByText("Terry McGinnis")).toHaveCount(0);
  });

  const refusals: Array<[string, string, RegExp]> = [
    ["invalid JSON", '{ "format":', /valid JSON/i],
    ["unrelated JSON", '{ "hello": "world" }', /beta-native CapacityLens export/i],
    [
      "redacted document",
      serializeBetaExport(buildBetaExport(seedForCurrentWeek(), { accountId: ACCOUNT_ID, completeness: "redacted" })),
      /full|redacted/i,
    ],
    ["unsupported schema", JSON.stringify({ ...restoredDocument(), schemaVersion: 2 }), /unsupported/i],
  ];
  for (const [name, body, message] of refusals) {
    test(`refuses ${name} and preserves the current company`, async ({ page }) => {
      await openApp(page);
      await importFile(page, body);
      await expect(page.getByRole("alert")).toContainText(message);
      await expect(page.getByRole("alertdialog", { name: "Import data?" })).toHaveCount(0);
      await page.getByRole("link", { name: "Schedule", exact: true }).click();
      await expect(page.getByText("Bruce Wayne")).toBeVisible();
    });
  }
});
