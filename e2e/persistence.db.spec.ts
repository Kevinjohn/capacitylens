import { test, expect } from "./dbFixtures";
import { openApp, selectShadOption } from "./browserTestSupport";
import { resetServer, serverState, requireStateRows } from "./serverTestState";

// This database-backed project uses VITE_CAPACITYLENS_API, so persistence runs through ServerSyncAdapter and SQLite.
// The specs use the same UI flows as the in-memory demo, but reloads hydrate from GET /api/state without a
// localStorage fallback. A record that survives reload proves the full UI-to-database round trip.

function registerBeforeEachHooks() {
  test.beforeEach(async ({ request }) => {
    await resetServer({ request: request, withSeed: true });
  });
}

function registerHydratesSeededDatasetServerLoadTest() {
  test("hydrates the seeded dataset from the server on load", async ({ page }) => {
    await openApp(page);
    // "Bruce Wayne" is part of the server seed; seeing it proves GET /api/state → UI.
    await expect(page.getByText("Bruce Wayne")).toBeVisible();
  });
}

function registerCreateReloadNewClientRoundTest() {
  test("create + reload: a new client round-trips through the DB", async ({ page, request }) => {
    await openApp(page);
    await page.getByRole("link", { name: "Clients" }).click();
    await page.getByRole("button", { name: "Add client" }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Persisted DB Co");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Persisted DB Co")).toBeVisible();

    // The write is debounced; confirm it actually reached the server tables.
    await expect
      .poll(
        async () => requireStateRows(await serverState(request), "clients").some((c) => c.name === "Persisted DB Co"),
        {
          timeout: 10_000,
        },
      )
      .toBe(true);

    await openApp(page);
    await page.getByRole("link", { name: "Clients" }).click();
    await expect(page.getByText("Persisted DB Co")).toBeVisible();
  });
}

function registerRepeatCreationPersistsAllAllocationTest() {
  test("repeat creation persists one typed allocation group request", async ({ page, request }) => {
    const before = requireStateRows(await serverState(request), "allocations");
    let groupRequests = 0;
    let batchRequests = 0;
    page.on("request", (outgoing) => {
      if (outgoing.method() !== "POST") return;
      if (outgoing.url().endsWith("/api/batch")) batchRequests++;
      if (outgoing.url().endsWith("/allocations/create-group")) groupRequests++;
    });
    await openApp(page);
    await page.getByRole("button", { name: "Add allocation for Clark Kent" }).click();
    const dialog = page.getByRole("dialog", { name: "New allocation" });
    await selectShadOption(dialog.getByLabel("Project", { exact: true }), "p-acme");
    await selectShadOption(dialog.getByRole("combobox", { name: "Activity", exact: true }), "t-wires");
    await dialog.getByLabel("Start Date").fill("2026-06-10");
    await dialog.getByLabel(/^End/).fill("2026-06-10");
    await selectShadOption(dialog.getByRole("combobox", { name: "Repeat" }), "weekly");
    await dialog.getByLabel("Repeat until").fill("2026-09-10");
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect
      .poll(async () => requireStateRows(await serverState(request), "allocations").length, { timeout: 10_000 })
      .toBe(before.length + 14);
    expect(groupRequests).toBe(1);
    expect(batchRequests).toBe(0);

    await openApp(page);
    const afterReload = requireStateRows(await serverState(request), "allocations");
    expect(afterReload).toHaveLength(before.length + 14);
    expect(before.every((row) => afterReload.some((persisted) => persisted.id === row.id))).toBe(true);
    const repeated = afterReload.filter((row) => !before.some(({ id }) => id === row.id));
    const firstRepeated = repeated[0];
    if (firstRepeated === undefined) throw new Error("Repeat creation must persist new allocations");
    expect(firstRepeated.seriesId).toEqual(expect.any(String));
    expect(new Set(repeated.map(({ seriesId }) => seriesId)).size).toBe(1);
  });
}

function registerEditReloadRenameRoundTripsTest() {
  test("edit + reload: a rename round-trips through the DB", async ({ page, request }) => {
    await openApp(page);
    await page.getByRole("link", { name: "Clients" }).click();
    await page.getByRole("button", { name: "Add client" }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Rename Me Co");
    await page.getByRole("button", { name: "Save" }).click();
    const row = page.getByTestId("client-row").filter({ hasText: "Rename Me Co" });
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: /^Edit / }).click();
    // Scope the field to the Edit dialog because the row's archive control shares the same name.
    // a bare getByLabel('Name'), "Re*name* Me Co" contains "Name", so an unscoped lookup is ambiguous.
    await page.getByRole("dialog").getByRole("textbox", { name: "Name", exact: true }).fill("Renamed Co");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("client-row").filter({ hasText: "Renamed Co" })).toBeVisible();

    await expect
      .poll(async () => requireStateRows(await serverState(request), "clients").some((c) => c.name === "Renamed Co"), {
        timeout: 10_000,
      })
      .toBe(true);

    await openApp(page);
    await page.getByRole("link", { name: "Clients" }).click();
    await expect(page.getByTestId("client-row").filter({ hasText: "Renamed Co" })).toBeVisible();
    await expect(page.getByTestId("client-row").filter({ hasText: "Rename Me Co" })).toHaveCount(0);
  });
}

function registerEditFreshHydrationEngagementHalfTest() {
  test("edit + fresh hydration: engagement and half days survive the server round-trip", async ({ page, request }) => {
    await openApp(page);
    await page.getByRole("link", { name: "Resources" }).click();
    const bruce = page.getByTestId("resource-row").filter({ hasText: "Bruce Wayne" });
    await bruce.getByRole("button", { name: "Edit Bruce Wayne" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit resource" });
    await dialog.getByRole("radio", { name: "Supplementary" }).click();
    await dialog.getByRole("radio", { name: "Tuesday Half day" }).click();
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect
      .poll(async () => {
        const persisted = requireStateRows(await serverState(request), "resources").find(({ id }) => id === "r-tyler");
        return { engagement: persisted?.engagement, halfDays: persisted?.halfDays };
      })
      .toEqual({ engagement: "supplementary", halfDays: [2] });

    // Start again from the document root so the client discards its in-memory snapshot and hydrates
    // a new account slice from GET /api/state, matching a later browser session.
    await openApp(page);
    await page.getByRole("link", { name: "Resources" }).click();
    const supplementary = page.getByRole("heading", { name: "Supplementary" }).locator("..");
    await expect(supplementary.getByTestId("resource-row")).toContainText("Bruce Wayne");

    await page
      .getByTestId("resource-row")
      .filter({ hasText: "Bruce Wayne" })
      .getByRole("button", { name: "Edit Bruce Wayne" })
      .click();
    await expect(page.getByRole("radio", { name: "Supplementary" })).toBeChecked();
    await expect(page.getByRole("radio", { name: "Tuesday Half day" })).toBeChecked();
  });
}

// The per-row destructive action archives a client through the server-authoritative /api/clients/:id/archive route.
// The route sets archivedAt and preserves the record; reload then confirms it is absent from active views.
function registerArchiveReloadArchivedClientRetainedTests() {
  test("archive + reload: an archived client is retained in the DB but hidden from the active view", async ({
    page,
    request,
  }) => {
    await openApp(page);
    await page.getByRole("link", { name: "Clients" }).click();
    await page.getByRole("button", { name: "Add client" }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Doomed Co");
    await page.getByRole("button", { name: "Save" }).click();
    const row = page.getByTestId("client-row").filter({ hasText: "Doomed Co" });
    await expect(row).toBeVisible();
    await expect
      .poll(async () => requireStateRows(await serverState(request), "clients").some((c) => c.name === "Doomed Co"), {
        timeout: 10_000,
      })
      .toBe(true);

    await row.getByRole("button", { name: "Archive Doomed Co" }).click();
    await page
      .getByRole("alertdialog", { name: "Archive client?" })
      .getByRole("button", { name: "Archive", exact: true })
      .click();
    await expect(page.getByTestId("client-row").filter({ hasText: "Doomed Co" })).toHaveCount(0);

    await expect
      .poll(
        async () =>
          requireStateRows(await serverState(request), "clients").find((c) => c.name === "Doomed Co")?.archivedAt ??
          null,
        {
          timeout: 10_000,
        },
      )
      .toBeTruthy();

    await openApp(page);
    await page.getByRole("link", { name: "Clients" }).click();
    await expect(page.getByTestId("client-row").filter({ hasText: "Doomed Co" })).toHaveCount(0);
  });
}

test.describe("database-backed persistence", () => {
  registerBeforeEachHooks();
  registerHydratesSeededDatasetServerLoadTest();
  registerCreateReloadNewClientRoundTest();
  registerRepeatCreationPersistsAllAllocationTest();
  registerEditReloadRenameRoundTripsTest();
  registerEditFreshHydrationEngagementHalfTest();
  registerArchiveReloadArchivedClientRetainedTests();
});
