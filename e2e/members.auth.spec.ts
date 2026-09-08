import { test, expect, type APIRequestContext, type Page } from "./fixtures";
import type { BrowserContext } from "@playwright/test";
import {
  AUTH_API as API,
  AUTH_PASSWORD as PASSWORD,
  bootstrapOrg,
  signUpUser as signUp,
  signUpUserWithId,
} from "./auth-helpers";
import { dismissIntroIfPresent, selectShadOption } from "./helpers";

test.use({ contextOptions: { reducedMotion: "reduce" } });

// P1.11 — Owner/Admin member management, against the auth-backed project's server
// (SMALLSASS_ACCOUNT_MODE=password on :8887 — see playwright.config.ts). Owner A bootstraps an org and
// invites admin B + editor C (both accept via the API). Then, as B (admin), we drive the Team &
// access UI: list members, change C editor→viewer, mint a viewer invite (the link appears once),
// revoke it. We assert the Owner option is ABSENT for B in the UI, and at the API layer that nobody
// can assign Owner through PATCH (400), cannot touch owner A (→ 403), cannot transfer ownership
// (→ 403), that owner membership cannot be removed through the ordinary member endpoint (→ 403),
// and — the cross-tenant headline — that B cannot read ANOTHER account's members (→ 403). Then owner
// A drives the gear menu to disable and restore C, and finally transfers ownership through the API
// (#175 removed the per-row transfer button) so the live shell reprojects A as Admin on its next
// authoritative read. Browser-agnostic (no UA branching).

// Shared plumbing (API/PASSWORD/BOOTSTRAP_TOKEN/signUp/signUpUserWithId) comes from ./auth-helpers.
const STAMP = Date.now();
const OWNER = `m-owner-${STAMP}@capacitylens.dev`;
const ADMIN = `m-admin-${STAMP}@capacitylens.dev`;
const EDITOR = `m-editor-${STAMP}@capacitylens.dev`;

async function setupMembersApi(request: APIRequestContext) {
  const [owner, admin, editor] = await Promise.all([signUpUserWithId(OWNER), signUp(ADMIN), signUpUserWithId(EDITOR)]);
  const accountId = await bootstrapOrg(request, owner.cookie, `Members Studio ${STAMP}`);
  for (const [who, role] of [
    [admin, "admin"],
    [editor, "editor"],
  ] as const) {
    const inv = await request.post(`${API}/api/invites`, {
      headers: { cookie: owner.cookie },
      data: { accountId, role },
    });
    expect(inv.status()).toBe(201);
    const token = (await inv.json()).token as string;
    const accept = await request.post(`${API}/api/invites/${token}/accept`, { headers: { cookie: who.cookie } });
    expect(accept.status()).toBe(200);
  }
  const grant = await request.patch(`${API}/api/accounts/${accountId}/members/${editor.userId}`, {
    headers: { cookie: admin.cookie },
    data: { role: "owner" },
  });
  expect(grant.status()).toBe(400);
  const touchOwner = await request.patch(`${API}/api/accounts/${accountId}/members/${owner.userId}`, {
    headers: { cookie: admin.cookie },
    data: { role: "editor" },
  });
  expect(touchOwner.status()).toBe(403);
  const adminTransfer = await request.post(`${API}/api/accounts/${accountId}/transfer-ownership`, {
    headers: { cookie: admin.cookie },
    data: { toUserId: editor.userId },
  });
  expect(adminTransfer.status()).toBe(403);
  const selfRemove = await request.delete(`${API}/api/accounts/${accountId}/members/${owner.userId}`, {
    headers: { cookie: owner.cookie },
  });
  expect(selfRemove.status()).toBe(403);
  const crossTenant = await request.get(`${API}/api/accounts/some-other-account-${STAMP}/members`, {
    headers: { cookie: admin.cookie },
  });
  expect(crossTenant.status()).toBe(403);
  return { owner, admin, editor, accountId };
}

async function manageAdminMembers(
  page: Page,
  request: APIRequestContext,
  scenario: Awaited<ReturnType<typeof setupMembersApi>>,
) {
  const { admin, editor, accountId } = scenario;
  await page.goto("/");
  await page.getByRole("heading", { name: "Sign in" }).waitFor();
  await page.getByLabel("Email").fill(ADMIN);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: `Members Studio ${STAMP}`, exact: true }).click();
  await expect(page.getByRole("heading", { name: "Welcome to CapacityLens" })).toBeVisible();
  await page.getByTestId("intro-continue").click();
  await expect(page.getByTestId("getting-started")).toBeVisible();
  await expect(page.getByRole("link", { name: "Invite your team" })).toHaveAttribute("href", "/team");
  await page.getByRole("link", { name: "Team & access" }).click();
  await expect(page.getByTestId("current-access")).toContainText("Admin");
  await expect(page.getByRole("heading", { name: "Members", exact: true })).toBeVisible();
  await expect(page.getByText("View the schedule")).toHaveCount(0);
  await page.getByTestId("capabilities-toggle").click();
  await expect(page.getByText("View the schedule")).toBeVisible();
  await page.getByTestId("capabilities-toggle").click();
  const rows = page.getByTestId("member-row");
  await expect(rows).toHaveCount(3);
  await expect(page.getByText(OWNER)).toBeVisible();
  await expect(page.getByText(EDITOR)).toBeVisible();
  await expect(page.locator('[data-testid="invite-role"] option[value="owner"]')).toHaveCount(0);
  await expect(page.getByTestId("member-make-owner")).toHaveCount(0);
  const editorRow = rows.filter({ hasText: EDITOR });
  await editorRow.getByTestId("member-edit").click();
  await selectShadOption(page.getByRole("dialog").getByTestId("member-role-select").getByRole("combobox"), "viewer");
  await expect(page.getByRole("dialog")).toContainText(EDITOR);
  await expect(page.getByRole("dialog")).toContainText("Read-only schedule access");
  await page.getByRole("dialog").getByTestId("member-role-save").click();
  await expect
    .poll(async () => {
      const res = await request.get(`${API}/api/accounts/${accountId}/members`, { headers: { cookie: admin.cookie } });
      const members = (await res.json()).members as Array<{ userId: string; role: string }>;
      return members.find((member) => member.userId === editor.userId)?.role;
    })
    .toBe("viewer");
  await selectShadOption(page.getByTestId("invite-role"), "viewer");
  await page.getByTestId("invite-submit").click();
  await expect(page.getByTestId("invite-link")).toContainText("/invite/");
  const mintedInviteLink = await page.getByTestId("invite-link").textContent();
  await editorRow.getByTestId("member-edit").click();
  await selectShadOption(page.getByRole("dialog").getByTestId("member-role-select").getByRole("combobox"), "editor");
  await page.getByRole("dialog").getByTestId("member-role-save").click();
  await expect(page.getByTestId("invite-link")).toHaveText(mintedInviteLink ?? "");
  const inviteRows = page.getByTestId("invite-row");
  await expect(inviteRows).toHaveCount(3);
  await inviteRows.first().getByTestId("invite-revoke").click();
  await expect(inviteRows).toHaveCount(2);
  await expect(page.getByTestId("invite-link")).toHaveCount(0);
}

async function manageOwnerMembers(
  newObservedContext: (options?: { reducedMotion?: "reduce" }) => Promise<BrowserContext>,
  request: APIRequestContext,
  scenario: Awaited<ReturnType<typeof setupMembersApi>>,
) {
  const { owner, editor, accountId } = scenario;
  const ownerContext = await newObservedContext({ reducedMotion: "reduce" });
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto("/");
  await ownerPage.getByRole("heading", { name: "Sign in" }).waitFor();
  await ownerPage.getByLabel("Email").fill(OWNER);
  await ownerPage.getByLabel("Password").fill(PASSWORD);
  await ownerPage.getByRole("button", { name: "Sign in" }).click();
  await ownerPage.getByRole("button", { name: `Members Studio ${STAMP}`, exact: true }).click();
  await dismissIntroIfPresent(ownerPage, ownerPage.locator("#main"));
  await ownerPage.getByRole("link", { name: "Team & access" }).click();
  await expect(ownerPage.getByTestId("current-access")).toContainText("Owner");
  const ownerTarget = ownerPage.getByTestId("member-row").filter({ hasText: EDITOR });
  await ownerTarget.getByTestId("member-menu").click();
  await ownerPage.getByTestId("member-disable").click();
  await ownerPage.getByRole("alertdialog").getByRole("button", { name: "Disable user" }).click();
  await expect(
    ownerPage.getByTestId("members-table").getByTestId("member-row").filter({ hasText: EDITOR }),
  ).toHaveCount(0);
  const inactiveToggle = ownerPage.getByTestId("members-inactive-toggle");
  await expect(inactiveToggle).toHaveAttribute("aria-expanded", "false");
  await inactiveToggle.click();
  const inactiveTarget = ownerPage
    .getByTestId("members-inactive-table")
    .getByTestId("member-row")
    .filter({ hasText: EDITOR });
  await expect(inactiveTarget).toContainText("Disabled");
  await expect
    .poll(async () => {
      const res = await request.get(`${API}/api/accounts/${accountId}/members`, { headers: { cookie: owner.cookie } });
      const members = (await res.json()).members as Array<{ userId: string; status: string }>;
      return members.find((member) => member.userId === editor.userId)?.status;
    })
    .toBe("disabled");
  const disabledRead = await request.get(`${API}/api/state?accountId=${accountId}`, {
    headers: { cookie: editor.cookie },
  });
  expect(disabledRead.status()).toBe(403);
  await inactiveTarget.getByTestId("member-menu").click();
  await expect(ownerPage.getByTestId("member-disable")).toHaveCount(0);
  await ownerPage.getByTestId("member-restore").click();
  await ownerPage.getByRole("alertdialog").getByRole("button", { name: "Restore access" }).click();
  await expect(ownerTarget).not.toContainText("Disabled");
  await expect(ownerPage.getByTestId("members-inactive-toggle")).toHaveCount(0);
  await expect(ownerPage.getByTestId("member-make-owner")).toHaveCount(0);
  const transfer = await request.post(`${API}/api/accounts/${accountId}/transfer-ownership`, {
    headers: { cookie: owner.cookie },
    data: { toUserId: editor.userId },
  });
  expect(transfer.status()).toBe(200);
  await ownerPage.reload();
  await expect(ownerPage).toHaveURL(/\/team$/);
  await expect(ownerPage.getByRole("heading", { name: "Members", exact: true })).toBeVisible();
  await expect(ownerPage.getByTestId("active-role")).toContainText("Admin");
  await expect
    .poll(async () => {
      const res = await request.get(`${API}/api/accounts/${accountId}/members`, { headers: { cookie: owner.cookie } });
      const members = (await res.json()).members as Array<{ userId: string; role: string }>;
      return [
        members.find((member) => member.userId === editor.userId)?.role,
        members.find((member) => member.userId === owner.userId)?.role,
      ];
    })
    .toEqual(["owner", "admin"]);
  await ownerContext.close();
}

test("admin manages members but not owner-only ops; ownership changes only by transfer; no cross-tenant leak", async ({
  page,
  request,
  newObservedContext,
}) => {
  const { owner, admin, editor, accountId } = await setupMembersApi(request);

  await manageAdminMembers(page, request, { owner, admin, editor, accountId });

  await manageOwnerMembers(newObservedContext, request, { owner, admin, editor, accountId });
});
