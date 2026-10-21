import { test, expect } from "./fixtures";
import { openApp } from "./browserTestSupport";
import { EXPORT_SCHEMA_VERSION } from "@capacitylens/shared/types/entities";

const EMPTY_CAPACITYLENS = JSON.stringify({
  schemaVersion: 2,
  data: {
    disciplines: [],
    resources: [],
    clients: [],
    projects: [],
    phases: [],
    activities: [],
    allocations: [],
    timeOff: [],
  },
});

// A small but complete linked graph. Importing nothing is refused (it would silently wipe the
// account), and a resource-only fixture would not prove that replacement preserves relationships
// across the whole scoped slice.
const NONEMPTY_CAPACITYLENS = JSON.stringify({
  schemaVersion: 2,
  data: {
    disciplines: [],
    clients: [
      {
        id: "imp-c",
        accountId: "X",
        createdAt: "t",
        updatedAt: "t",
        name: "Imported Client",
        color: "#3b82f6",
      },
    ],
    projects: [
      {
        id: "imp-p",
        accountId: "X",
        createdAt: "t",
        updatedAt: "t",
        name: "Imported Project",
        clientId: "imp-c",
        color: "#3b82f6",
      },
    ],
    phases: [],
    activities: [
      {
        id: "imp-t",
        accountId: "X",
        createdAt: "t",
        updatedAt: "t",
        name: "Imported Activity",
        kind: "project",
        projectId: "imp-p",
      },
    ],
    allocations: [
      {
        id: "imp-a",
        accountId: "X",
        createdAt: "t",
        updatedAt: "t",
        resourceId: "imp-r",
        activityId: "imp-t",
        startDate: "2026-06-01",
        endDate: "2026-06-05",
        hoursPerDay: 8,
        status: "confirmed",
      },
    ],
    timeOff: [],
    resources: [
      {
        id: "imp-r",
        accountId: "X",
        createdAt: "t",
        updatedAt: "t",
        kind: "person",
        name: "Imported Person",
        role: "Designer",
        employmentType: "permanent",
        engagement: "studio" as const,
        workingHoursPerDay: 8,
        workingDays: [1, 2, 3, 4, 5],
        color: "#3b82f6",
      },
    ],
  },
});

type Page = import("@playwright/test").Page;

// Open Settings before importing so this helper works from any application route.
const importFile = async (page: Page, name: string, body: string) => {
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  if (!(await page.getByTestId("settings-data-tools").isVisible())) {
    await page.getByRole("button", { name: "Import and export", exact: true }).click();
  }
  await expect(page.getByTestId("settings-data-tools")).toBeVisible();
  await page.getByTestId("import-input").setInputFiles({
    name,
    mimeType: "application/json",
    buffer: Buffer.from(body),
  });
};

const openSchedule = (page: Page) => page.getByRole("link", { name: "Schedule", exact: true }).click();

// Covers US-DAT-02..04 and demo first-load seeding. Export round-trip and reset-on-reload behavior
// are exercised in e2e/crud.spec.ts; database persistence cases are in persistence.db.spec.ts.
function registerSeedsDemoDatasetFirstLoadTest() {
  test("seeds a demo dataset on first load", async ({ page }) => {
    await openApp(page);
    await expect(page.getByText("Bruce Wayne")).toBeVisible();
  });
}

function registerImportShowsConfirmationReplacesAllTest() {
  test("import shows a confirmation that replaces all data; Cancel keeps the data", async ({ page }) => {
    await openApp(page);
    await importFile(page, "incoming.json", NONEMPTY_CAPACITYLENS);

    const dialog = page.getByRole("alertdialog", { name: "Import data?" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("incoming.json");
    await expect(dialog).toContainText(/replaces this company’s data/i);
    await expect(dialog).toContainText(/1 resource/i);
    await expect(dialog).toContainText(/1 client/i);
    await expect(dialog).toContainText(/1 project/i);
    await expect(dialog).toContainText(/1 activit(?:y|ies)/i);
    await expect(dialog).toContainText(/1 allocation/i);
    // Scheduler Undo covers bookings only, so the confirmation must not promise to reverse an import.
    await expect(dialog).not.toContainText(/undo/i);
    await dialog.getByRole("button", { name: "Cancel" }).click();

    await openSchedule(page);
    await expect(page.getByText("Bruce Wayne")).toBeVisible();
  });
}

function registerConfirmingImportReplacesDatasetUndoKeepsItTest() {
  test("confirming an import replaces the dataset, and ⌘Z leaves it imported", async ({ page }) => {
    await openApp(page);
    await expect(page.getByText("Bruce Wayne")).toBeVisible();
    await importFile(page, "incoming.json", NONEMPTY_CAPACITYLENS);
    await page.getByRole("alertdialog", { name: "Import data?" }).getByRole("button", { name: "Replace data" }).click();

    await openSchedule(page);
    await expect(page.getByText("Imported Person")).toBeVisible();
    await expect(page.getByTestId("allocation-bar").filter({ hasText: "Imported Activity" })).toBeVisible();
    await expect(page.getByText("Bruce Wayne")).toHaveCount(0);
    await expect(page.getByText("Imported 5 records.", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "Clients" }).click();
    await expect(page.getByText("Imported Client")).toBeVisible();
    await page.getByRole("link", { name: "Projects" }).click();
    await expect(page.getByText("Imported Project")).toBeVisible();
    await page.getByRole("link", { name: "Activities" }).click();
    await expect(page.getByText("Imported Activity")).toBeVisible();

    // Undo covers bookings only, so the imported graph stays in place.
    await page.keyboard.press("Meta+z");
    await expect(page.getByText("Imported Activity")).toBeVisible();
    await page.getByRole("link", { name: "Clients" }).click();
    await expect(page.getByRole("button", { name: "Add client" })).toBeVisible();
    await expect(page.getByText("Imported Client")).toBeVisible();
    await expect(page.getByText("Queen Consolidated", { exact: true })).toHaveCount(0);
    await page.getByRole("link", { name: "Schedule" }).click();
    await expect(page.getByText("Bruce Wayne")).toHaveCount(0);
  });
}

function registerRejectsNonCapacitylensFileNoticeTest() {
  test("rejects a non-CapacityLens file with a notice and preserves existing data", async ({ page }) => {
    await openApp(page);
    await importFile(page, "random.json", JSON.stringify({ hello: "world" }));

    // Assert the specific refusal message so changing toast markup does not weaken error coverage.
    await expect(page.getByText(/not CapacityLens data/i)).toBeVisible();
    await openSchedule(page);
    await expect(page.getByText("Bruce Wayne")).toBeVisible();
  });
}

function registerRejectsEMPTYCapacitylensFileWouldTest() {
  test("rejects an EMPTY CapacityLens file (would silently wipe the account) with a notice", async ({ page }) => {
    await openApp(page);
    await importFile(page, "empty.json", EMPTY_CAPACITYLENS);

    await expect(page.getByText(/no CapacityLens records/i)).toBeVisible();
    await expect(page.getByRole("alertdialog", { name: "Import data?" })).toHaveCount(0);
    await openSchedule(page);
    await expect(page.getByText("Bruce Wayne")).toBeVisible();
  });
}

const refusalCases: Array<{
  name: string;
  fileName: string;
  body: () => string;
  message: RegExp;
}> = [
  {
    name: "invalid JSON",
    fileName: "truncated.json",
    body: () => '{ "schemaVersion":',
    message: /isn't valid JSON/i,
  },
  {
    name: "a damaged non-list table",
    fileName: "damaged.json",
    body: () =>
      JSON.stringify({
        schemaVersion: EXPORT_SCHEMA_VERSION,
        data: { clients: {} },
      }),
    message: /damaged: a data table is not a list/i,
  },
  {
    name: "a newer schema version",
    fileName: "newer.json",
    body: () =>
      JSON.stringify({
        schemaVersion: EXPORT_SCHEMA_VERSION + 1,
        data: { clients: [{}] },
      }),
    message: new RegExp(
      `Schema version ${EXPORT_SCHEMA_VERSION + 1} is newer than this app supports \\(${EXPORT_SCHEMA_VERSION}\\)`,
      "i",
    ),
  },
];

function registerRejectsRefusalNamePreciseNoticeTests() {
  for (const refusal of refusalCases) {
    test(`rejects ${refusal.name} with its precise notice and preserves existing data`, async ({ page }) => {
      await openApp(page);
      await importFile(page, refusal.fileName, refusal.body());

      await expect(page.getByText(refusal.message)).toBeVisible();
      await expect(page.getByRole("alertdialog", { name: "Import data?" })).toHaveCount(0);
      await openSchedule(page);
      await expect(page.getByText("Bruce Wayne")).toBeVisible();
    });
  }
}

test.describe("Data import/export", () => {
  registerSeedsDemoDatasetFirstLoadTest();
  registerImportShowsConfirmationReplacesAllTest();
  registerConfirmingImportReplacesDatasetUndoKeepsItTest();
  registerRejectsNonCapacitylensFileNoticeTest();
  registerRejectsEMPTYCapacitylensFileWouldTest();
  registerRejectsRefusalNamePreciseNoticeTests();
});
