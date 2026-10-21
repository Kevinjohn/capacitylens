import { test, expect } from "./fixtures";
import type { APIRequestContext } from "./fixtures";
import {
  AUTH_API as API,
  AUTH_PASSWORD as PASSWORD,
  bootstrapOrg,
  seedFixtureMember,
  signUpUser as signUp,
} from "./authTestSupport";
import { waitForAppLanding } from "./browserTestSupport";

test.use({ contextOptions: { reducedMotion: "reduce" } });

// The password server on this run’s auth API lane must enforce the same viewer restrictions as the UI.

// Shared auth setup comes from authTestSupport.
const STAMP = Date.now();
const OWNER = `v-owner-${STAMP}@capacitylens.dev`;
const VIEWER = `v-viewer-${STAMP}@capacitylens.dev`;
const EDITOR = `v-editor-${STAMP}@capacitylens.dev`;
const VIEWER_AVATAR_URL = "https://images.example/viewer-person.png";

async function signInAndOpen(page: import("@playwright/test").Page, email: string) {
  await page.goto("/");
  await page.getByRole("heading", { name: "Sign in" }).waitFor();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Choose a company" })).toHaveCount(0);
  // The intro is once-per-device; on the second sign-in it won't reappear. Wait for either the intro
  // or the app (Schedule heading) to settle the race, then dismiss the intro if present.
  await waitForAppLanding(page, page.getByRole("heading", { name: "Schedule" }));
  await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();
}

async function assertViewerWriteRejected(request: APIRequestContext, accountId: string, cookie: string) {
  const newClientId = `new-client-${STAMP}`;
  const directWrite = await request.post(`${API}/api/batch`, {
    headers: { cookie, "content-type": "application/json" },
    data: {
      ops: [
        {
          method: "PUT",
          table: "clients",
          id: newClientId,
          row: {
            id: newClientId,
            accountId,
            name: "Should be rejected",
            color: "#76a5e7",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      ],
    },
  });
  expect(directWrite.status()).toBe(403);
}

async function seedViewerScenario(request: APIRequestContext) {
  const owner = await signUp(OWNER);
  const viewer = await signUp(VIEWER);
  const editor = await signUp(EDITOR);
  const accountId = await bootstrapOrg(request, owner.cookie, `Viewer Studio ${STAMP}`);
  const seededAt = new Date().toISOString();
  const clientId = `viewer-client-${STAMP}`;
  const clientWrite = await request.post(`${API}/api/batch`, {
    headers: { cookie: owner.cookie, "content-type": "application/json" },
    data: {
      ops: [
        {
          method: "PUT",
          table: "clients",
          id: clientId,
          row: {
            id: clientId,
            accountId,
            name: "Viewer-visible client",
            color: "#76a5e7",
            createdAt: seededAt,
            updatedAt: seededAt,
          },
        },
      ],
    },
  });
  expect(clientWrite.status()).toBe(200);
  const resourceId = `viewer-resource-${STAMP}`;
  const resourceWrite = await request.post(`${API}/api/batch`, {
    headers: { cookie: owner.cookie, "content-type": "application/json" },
    data: {
      ops: [
        {
          method: "PUT",
          table: "resources",
          id: resourceId,
          row: {
            id: resourceId,
            accountId,
            kind: "person",
            name: "Viewer-visible person",
            avatarUrl: VIEWER_AVATAR_URL,
            role: "Designer",
            employmentType: "permanent",
            engagement: "studio" as const,
            workingHoursPerDay: 8,
            workingDays: [1, 2, 3, 4, 5],
            color: "#76a5e7",
            createdAt: seededAt,
            updatedAt: seededAt,
          },
        },
      ],
    },
  });
  expect(resourceWrite.status()).toBe(200);
  for (const [who, role] of [
    [viewer, "viewer"],
    [editor, "editor"],
  ] as const) {
    seedFixtureMember(accountId, who.email, role);
  }
  await assertViewerWriteRejected(request, accountId, viewer.cookie);
  return { resourceId };
}

// This end-to-end permission contrast intentionally keeps both roles in one session.

test("a viewer sees no edit affordances; an editor does; a direct viewer write is 403", async ({
  page,
  request,
  context,
}) => {
  const { resourceId } = await seedViewerScenario(request);
  await page.route(VIEWER_AVATAR_URL, (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );

  await signInAndOpen(page, VIEWER);

  // Team & access remains available so a Viewer can understand the role without being shown the
  // company context, directory or management controls.
  await expect(page.getByTestId("getting-started")).toHaveCount(0);
  await page.getByRole("link", { name: "Team & access" }).click();
  const currentAccess = page.getByTestId("current-access");
  await expect(currentAccess).toContainText("Viewer");
  await expect(currentAccess.getByText("View the schedule")).toHaveCount(0);
  await currentAccess.getByTestId("capabilities-toggle").click();
  await expect(currentAccess.getByText("View the schedule")).toBeVisible();
  await expect(currentAccess.getByText("Edit scheduling data")).toHaveClass(/text-muted/);
  await expect(page.getByText(/An Owner or Admin manages invitations/)).toBeVisible();
  await expect(page.getByTestId("members-section")).toHaveCount(0);

  await page.getByRole("link", { name: "Clients" }).click();
  await expect(page.getByRole("heading", { name: "Clients" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add client" })).toHaveCount(0);
  const viewerClientRow = page.getByTestId("client-row").filter({ hasText: "Viewer-visible client" });
  await expect(viewerClientRow).toBeVisible();
  await expect(viewerClientRow.getByRole("button")).toHaveCount(0);

  await page.getByRole("link", { name: "Resources" }).click();
  const viewerResourceRow = page.getByTestId("resource-row").filter({ hasText: "Viewer-visible person" });
  await expect(viewerResourceRow).toBeVisible();
  await expect(viewerResourceRow.getByRole("button", { name: "Edit Viewer-visible person" })).toHaveCount(0);

  await page.getByRole("link", { name: "Schedule" }).click();
  const viewerScheduleTrigger = page.getByRole("button", { name: "View Viewer-visible person's schedule" });
  await expect(viewerScheduleTrigger.locator("img")).toHaveAttribute("src", VIEWER_AVATAR_URL);
  await expect(viewerScheduleTrigger.locator("img")).toHaveAttribute("referrerpolicy", "no-referrer");
  await expect(page.getByTestId("scheduler-grid")).toBeVisible();
  await page.getByRole("button", { name: "Show filters" }).click();
  await expect(page.getByRole("radiogroup", { name: "Draw mode" })).toHaveCount(0);
  await expect(page.getByTestId("undo-button")).toHaveCount(0);
  await expect(page.getByTestId("redo-button")).toHaveCount(0);

  await expect(page.getByTestId("allocation-bar")).toHaveCount(0);
  const lane = page.locator(`[data-testid="resource-lane"][data-resource-id="${resourceId}"]`);
  await expect(lane).toBeVisible();
  const box = await lane.boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    await page.mouse.move(box.x + 30, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 150, box.y + box.height / 2);
    await page.mouse.up();
  }
  await expect(page.getByRole("dialog", { name: "Add allocation" })).toHaveCount(0);
  await expect(page.getByTestId("allocation-bar")).toHaveCount(0);

  await context.clearCookies();
  await signInAndOpen(page, EDITOR);

  await expect(page.getByTestId("getting-started")).toBeVisible();
  await expect(page.getByRole("link", { name: "Invite your team" })).toHaveCount(0);
  await page.getByRole("link", { name: "Team & access" }).click();
  await expect(page.getByTestId("current-access")).toContainText("Editor");
  await expect(page.getByTestId("members-section")).toHaveCount(0);

  await page.getByRole("link", { name: "Clients" }).click();
  await expect(page.getByRole("heading", { name: "Clients" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add client" })).toBeVisible();
  const editorClientRow = page.getByTestId("client-row").filter({ hasText: "Viewer-visible client" });
  await expect(editorClientRow.getByRole("button", { name: /^Edit / })).toBeVisible();
  await expect(editorClientRow.getByRole("button", { name: "Archive Viewer-visible client" })).toBeVisible();

  await page.getByRole("link", { name: "Schedule" }).click();
  await page.getByRole("button", { name: "Show filters" }).click();
  await expect(page.getByRole("radiogroup", { name: "Draw mode" })).toBeVisible();
  await expect(page.getByTestId("undo-button")).toBeVisible();
});
