import { test, expect, type APIRequestContext, type Page } from "./fixtures";
import type { BrowserContext } from "@playwright/test";
import { AUTH_API as API, AUTH_PASSWORD as PASSWORD, bootstrapOrg, signUpUserWithId } from "./auth-helpers";
import { dismissIntroIfPresent } from "./helpers";

test.use({ contextOptions: { reducedMotion: "reduce" } });

// #780 — the ownership transfer ceremony, end to end in the browser, against the auth-backed
// project's server (see playwright.config.ts). Owner A bootstraps an org and invites Admin B, who
// accepts through the API. Then both people drive the real UI: A nominates B, B agrees, A confirms,
// and the two roles swap. We also assert the two things the ceremony exists for — that nobody else
// can see the request, and that nobody but B can give B's consent. Browser-agnostic (no UA branching).

const STAMP = Date.now();
const OWNER = `ot-owner-${STAMP}@capacitylens.dev`;
const ADMIN = `ot-admin-${STAMP}@capacitylens.dev`;
const EDITOR = `ot-editor-${STAMP}@capacitylens.dev`;
const COMPANY = `Ownership Studio ${STAMP}`;
// Sign-up derives a display name from the address, and the card names people by it: the ceremony
// copies no name of its own into the workflow row.
const ownerName = OWNER.split("@")[0] as string;
const adminName = ADMIN.split("@")[0] as string;

async function setupCeremony(request: APIRequestContext) {
  const [owner, admin, editor] = await Promise.all([
    signUpUserWithId(OWNER),
    signUpUserWithId(ADMIN),
    signUpUserWithId(EDITOR),
  ]);
  const accountId = await bootstrapOrg(request, owner.cookie, COMPANY);
  for (const [who, role] of [
    [admin, "admin"],
    [editor, "editor"],
  ] as const) {
    const invite = await request.post(`${API}/api/invites`, {
      headers: { cookie: owner.cookie },
      data: { accountId, role },
    });
    expect(invite.status()).toBe(201);
    const token = (await invite.json()).token as string;
    const accept = await request.post(`${API}/api/invites/${token}/accept`, { headers: { cookie: who.cookie } });
    expect(accept.status()).toBe(200);
  }
  return { owner, admin, editor, accountId };
}

/** Open the nominee picker, prove the only choices are active Admins, and choose one. The option
 *  value carries the member id, so this never depends on how a display name is rendered. */
async function nominate(page: Page, adminUserId: string, editorUserId: string): Promise<void> {
  const trigger = page.getByTestId("ownership-transfer-nominee");
  await trigger.click();
  const content = page.locator('[data-slot="select-content"][data-state="open"]');
  await expect(content.locator(`[role="option"][data-value$="${editorUserId}"]`)).toHaveCount(0);
  await content.locator(`[role="option"][data-value$="${adminUserId}"]`).click();
  await expect(content).toHaveCount(0);
}

/** Sign one participant in and leave them on Team & access, where the ceremony card lives. */
async function openTeamAccess(context: BrowserContext, email: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("heading", { name: "Sign in" }).waitFor();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: COMPANY, exact: true }).click();
  await dismissIntroIfPresent(page, page.locator("#main"));
  await page.getByRole("link", { name: "Team & access" }).click();
  return page;
}

async function readRoles(
  request: APIRequestContext,
  cookie: string,
  accountId: string,
  userIds: readonly string[],
): Promise<Array<string | undefined>> {
  const response = await request.get(`${API}/api/accounts/${accountId}/members`, { headers: { cookie } });
  const members = (await response.json()).members as Array<{ userId: string; role: string }>;
  return userIds.map((userId) => members.find((member) => member.userId === userId)?.role);
}

test("an owner nominates an admin, the admin agrees, the owner confirms, and the two roles swap", async ({
  request,
  newObservedContext,
}) => {
  const { owner, admin, editor, accountId } = await setupCeremony(request);

  const ownerContext = await newObservedContext({ reducedMotion: "reduce" });
  const ownerPage = await openTeamAccess(ownerContext, OWNER);
  await expect(ownerPage.getByTestId("current-access")).toContainText("Owner");

  // NOMINATE. Only active Admins are offered, so the editor must not appear as a candidate.
  const card = ownerPage.getByTestId("ownership-transfer-card");
  await expect(card).toBeVisible();
  await nominate(ownerPage, admin.userId, editor.userId);
  await ownerPage.getByTestId("ownership-transfer-start").click();
  await expect(ownerPage.getByTestId("ownership-transfer-state")).toContainText(adminName);
  // Nothing has happened yet: the Owner cannot confirm a nomination nobody has agreed to.
  await expect(ownerPage.getByTestId("ownership-transfer-complete")).toHaveCount(0);

  // A bystander sees no ceremony at all — the card is a participant-only projection.
  const editorContext = await newObservedContext({ reducedMotion: "reduce" });
  const editorPage = await openTeamAccess(editorContext, EDITOR);
  await expect(editorPage.getByTestId("ownership-transfer-card")).toHaveCount(0);
  await editorContext.close();

  // Nor can a bystander consent through the API on the nominee's behalf.
  const live = await request.get(`${API}/api/accounts/${accountId}/ownership-transfer`, {
    headers: { cookie: owner.cookie },
  });
  expect(live.status()).toBe(200);
  const request_ = (await live.json()).live as { id: string; revision: string };
  const stolenConsent = await request.post(
    `${API}/api/accounts/${accountId}/ownership-transfer/${request_.id}/accept`,
    { headers: { cookie: owner.cookie }, data: { expectedRevision: request_.revision } },
  );
  expect(stolenConsent.status()).toBe(403);

  // AGREE, as the nominee and nobody else.
  const adminContext = await newObservedContext({ reducedMotion: "reduce" });
  const adminPage = await openTeamAccess(adminContext, ADMIN);
  await expect(adminPage.getByTestId("ownership-transfer-state")).toContainText(ownerName);
  await expect(adminPage.getByTestId("ownership-transfer-complete")).toHaveCount(0);
  await adminPage.getByTestId("ownership-transfer-accept").click();
  await expect(adminPage.getByTestId("ownership-transfer-withdraw")).toBeVisible();

  // CONFIRM, by the same Owner who nominated.
  await ownerPage.reload();
  await ownerPage.getByTestId("ownership-transfer-complete").click();

  // The swap: the nominee is the Owner, the person who handed it over is an Admin.
  await expect
    .poll(async () => readRoles(request, owner.cookie, accountId, [admin.userId, owner.userId]))
    .toEqual(["owner", "admin"]);
  await expect(ownerPage.getByTestId("active-role")).toContainText("Admin");
  await adminPage.reload();
  await expect(adminPage.getByTestId("current-access")).toContainText("Owner");
  // The new Owner now holds the ceremony themselves: their card offers a nomination rather than a
  // request, and offers it to the person who just handed the company over.
  await expect(adminPage.getByTestId("ownership-transfer-start")).toBeVisible();

  await adminContext.close();
  await ownerContext.close();
});
