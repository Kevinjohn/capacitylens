import { test, expect } from "./fixtures";
import { openApp, selectShadOption } from "./helpers";
import { resetServer, serverState } from "./db-helpers";

// DB-backed E2E: this project's app is built with VITE_CAPACITYLENS_API, so persistence
// runs through the entity-level ServerSyncAdapter against the real SQLite server.
// Everything is driven through the same UI flows as the in-memory demo specs — the
// difference that matters is that a reload re-hydrates purely from GET /api/state
// (there is no localStorage fallback), so a surviving record proves a real server
// round-trip: UI → store → adapter → PUT/DELETE → SQLite → GET on reload.

test.describe("database-backed persistence", () => {
  test.beforeEach(async ({ request }) => {
    await resetServer(request, true); // wipe + re-seed before each test
  });

  test("hydrates the seeded dataset from the server on load", async ({ page }) => {
    await openApp(page); // picks "Studio North" from the server-seeded accounts
    // "Tyler Nix" is part of the server seed; seeing it proves GET /api/state → UI.
    await expect(page.getByText("Tyler Nix")).toBeVisible();
  });

  test("create + reload: a new client round-trips through the DB", async ({ page, request }) => {
    await openApp(page);
    await page.getByRole("link", { name: "Clients" }).click();
    await page.getByRole("button", { name: "Add client" }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Persisted DB Co");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Persisted DB Co")).toBeVisible();

    // The write is debounced; confirm it actually reached the server tables.
    await expect
      .poll(async () => (await serverState(request)).clients.some((c) => c.name === "Persisted DB Co"), {
        timeout: 10_000,
      })
      .toBe(true);

    // Reload re-hydrates from the DB (no localStorage). The client must still show.
    await openApp(page);
    await page.getByRole("link", { name: "Clients" }).click();
    await expect(page.getByText("Persisted DB Co")).toBeVisible();
  });

  test("repeat creation persists all allocation PUTs through one atomic client batch", async ({ page, request }) => {
    const before = (await serverState(request)).allocations;
    const batchBodies: Array<{ ops?: Array<{ method?: string; table?: string; id?: string }> }> = [];
    page.on("request", (outgoing) => {
      if (outgoing.method() === "POST" && outgoing.url().endsWith("/api/batch")) {
        batchBodies.push(outgoing.postDataJSON() as { ops?: Array<{ method?: string; table?: string; id?: string }> });
      }
    });
    await openApp(page);
    await page.getByRole("button", { name: "Add allocation for Nike Spiros" }).click();
    const dialog = page.getByRole("dialog", { name: "New allocation" });
    await selectShadOption(dialog.getByLabel("Project", { exact: true }), "p-acme");
    await selectShadOption(dialog.getByRole("combobox", { name: "Activity", exact: true }), "t-wires");
    await dialog.getByLabel("Start Date").fill("2026-06-10");
    await dialog.getByLabel(/^End/).fill("2026-06-10");
    await selectShadOption(dialog.getByRole("combobox", { name: "Repeat" }), "weekly");
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect
      .poll(async () => (await serverState(request)).allocations.length, { timeout: 10_000 })
      .toBe(before.length + 14);
    expect(batchBodies).toHaveLength(1);
    expect(batchBodies[0].ops).toHaveLength(14);
    expect(batchBodies[0].ops?.every((op) => op.method === "PUT" && op.table === "allocations")).toBe(true);

    await openApp(page);
    const afterReload = (await serverState(request)).allocations;
    expect(afterReload).toHaveLength(before.length + 14);
    expect(before.every((row) => afterReload.some((persisted) => persisted.id === row.id))).toBe(true);
  });

  test("edit + reload: a rename round-trips through the DB", async ({ page, request }) => {
    await openApp(page);
    await page.getByRole("link", { name: "Clients" }).click();
    await page.getByRole("button", { name: "Add client" }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Rename Me Co");
    await page.getByRole("button", { name: "Save" }).click();
    const row = page.getByTestId("client-row").filter({ hasText: "Rename Me Co" });
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: /^Edit / }).click();
    // Scope the field to the Edit dialog: the row's "Archive Rename Me Co" button (P2.5b) also matches
    // a bare getByLabel('Name') — "Re*name* Me Co" contains "Name" — so an unscoped lookup is ambiguous.
    await page.getByRole("dialog").getByRole("textbox", { name: "Name", exact: true }).fill("Renamed Co");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("client-row").filter({ hasText: "Renamed Co" })).toBeVisible();

    await expect
      .poll(async () => (await serverState(request)).clients.some((c) => c.name === "Renamed Co"), {
        timeout: 10_000,
      })
      .toBe(true);

    await openApp(page);
    await page.getByRole("link", { name: "Clients" }).click();
    await expect(page.getByTestId("client-row").filter({ hasText: "Renamed Co" })).toBeVisible();
    await expect(page.getByTestId("client-row").filter({ hasText: "Rename Me Co" })).toHaveCount(0);
  });

  // P2.5b: the per-row destructive action ARCHIVES (server-authoritative — the UI POSTs the dedicated
  // /api/clients/:id/archive route, then reloads the active slice). An archived client is RETAINED in
  // the DB (the archive route sets archivedAt; it is NOT a hard delete), but it is HIDDEN from the
  // active views (useActiveScopedData) and STAYS hidden across a reload — the real server round-trip
  // this proves: UI archive → POST .../archive → reload → still absent from the active list.
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
      .poll(async () => (await serverState(request)).clients.some((c) => c.name === "Doomed Co"), {
        timeout: 10_000,
      })
      .toBe(true);

    await row.getByRole("button", { name: "Archive Doomed Co" }).click();
    await page
      .getByRole("alertdialog", { name: "Archive client?" })
      .getByRole("button", { name: "Archive", exact: true })
      .click();
    // Gone from the active UI list (the archive route ran + the post-archive reload re-hydrated).
    await expect(page.getByTestId("client-row").filter({ hasText: "Doomed Co" })).toHaveCount(0);

    // It is RETAINED in the DB but now carries archivedAt (the archive route, not a hard delete).
    await expect
      .poll(async () => (await serverState(request)).clients.find((c) => c.name === "Doomed Co")?.archivedAt ?? null, {
        timeout: 10_000,
      })
      .toBeTruthy();

    // A reload re-hydrates from the DB's ACTIVE slice, so the archived client stays out of the list.
    await openApp(page);
    await page.getByRole("link", { name: "Clients" }).click();
    await expect(page.getByTestId("client-row").filter({ hasText: "Doomed Co" })).toHaveCount(0);
  });
});
