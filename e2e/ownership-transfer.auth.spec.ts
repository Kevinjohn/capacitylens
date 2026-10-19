import { test, expect } from "./fixtures";
import type { APIRequestContext, Page } from "./fixtures";
import type { BrowserContext } from "@playwright/test";
import {
  AUTH_API as API,
  AUTH_PASSWORD as PASSWORD,
  bootstrapOrg,
  seedFixtureMember,
  signUpUserWithId,
} from "./authTestSupport";
import { waitForAppLanding } from "./browserTestSupport";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const STAMP = Date.now();
const OWNER = `ot-owner-${STAMP}@capacitylens.dev`;
const ADMIN = `ot-admin-${STAMP}@capacitylens.dev`;
const EDITOR = `ot-editor-${STAMP}@capacitylens.dev`;
const COMPANY = `Ownership Studio ${STAMP}`;

async function setupMembers(request: APIRequestContext) {
  const [owner, admin, editor] = await Promise.all([
    signUpUserWithId(OWNER, "Bruce Wayne"),
    signUpUserWithId(ADMIN, "Clark Kent"),
    signUpUserWithId(EDITOR, "Diana Prince"),
  ]);
  const accountId = await bootstrapOrg(request, owner.cookie, COMPANY);
  seedFixtureMember(accountId, admin.email, "admin");
  seedFixtureMember(accountId, editor.email, "editor");
  return { owner, admin, editor, accountId };
}

async function selectAdmin(page: Page, adminUserId: string, editorUserId: string): Promise<void> {
  await page.getByTestId("ownership-transfer-nominee").click();
  const content = page.locator('[data-slot="select-content"][data-state="open"]');
  await expect(content.locator(`[role="option"][data-value$="${editorUserId}"]`)).toHaveCount(0);
  await content.locator(`[role="option"][data-value$="${adminUserId}"]`).click();
  await expect(content).toHaveCount(0);
}

async function openTeamAccess(context: BrowserContext, email: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("heading", { name: "Sign in" }).waitFor();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: COMPANY, exact: true }).click();
  await waitForAppLanding(page, page.locator("#main"));
  await page.getByRole("link", { name: "Team & access" }).click();
  return page;
}

async function readRoles(request: APIRequestContext, cookie: string, accountId: string, userIds: readonly string[]) {
  const response = await request.get(`${API}/api/accounts/${accountId}/members`, { headers: { cookie } });
  expect(response.status()).toBe(200);
  const members = (await response.json()).members as Array<{ userId: string; role: string }>;
  return userIds.map((userId) => members.find((member) => member.userId === userId)?.role);
}

test("the Owner confirms one immediate handover and both memberships refresh", async ({
  request,
  newObservedContext,
}) => {
  const { owner, admin, editor, accountId } = await setupMembers(request);
  const ownerContext = await newObservedContext({ reducedMotion: "reduce" });
  const adminContext = await newObservedContext({ reducedMotion: "reduce" });
  try {
    const ownerPage = await openTeamAccess(ownerContext, OWNER);
    const adminPage = await openTeamAccess(adminContext, ADMIN);
    await expect(ownerPage.getByTestId("current-access")).toContainText("Owner");
    await expect(adminPage.getByTestId("current-access")).toContainText("Admin");
    await expect(adminPage.getByTestId("ownership-transfer-card")).toHaveCount(0);
    const refused = await request.post(`${API}/api/accounts/${accountId}/ownership-transfer`, {
      headers: { cookie: editor.cookie },
      data: { toUserId: admin.userId },
    });
    expect(refused.status()).toBe(403);

    await ownerPage.getByTestId("ownership-transfer-open").click();
    const dialog = ownerPage.getByRole("dialog", { name: "Company ownership" });
    await expect(dialog).toBeVisible();
    await selectAdmin(ownerPage, admin.userId, editor.userId);
    await expect(dialog).toContainText("Clark Kent");
    await expect(dialog).toContainText("Admin");
    await ownerPage.getByTestId("ownership-transfer-complete").click();

    await expect
      .poll(() => readRoles(request, owner.cookie, accountId, [admin.userId, owner.userId]))
      .toEqual(["owner", "admin"]);
    await expect(ownerPage.getByTestId("current-access")).toContainText("Admin");
    await expect(ownerPage.getByTestId("ownership-transfer-card")).toHaveCount(0);
    await adminPage.reload();
    await expect(adminPage.getByTestId("current-access")).toContainText("Owner");
    await expect(adminPage.getByTestId("ownership-transfer-card")).toBeVisible();
  } finally {
    await adminContext.close();
    await ownerContext.close();
  }
});
