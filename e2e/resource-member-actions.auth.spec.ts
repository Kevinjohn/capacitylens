import { expect, test, type APIRequestContext, type Page } from "./fixtures";
import { AUTH_API, AUTH_PASSWORD, bootstrapOrg, signUpUser } from "./auth-helpers";
import { selectShadOption, waitForAppLanding } from "./helpers";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const STAMP = Date.now();
const OWNER = `resource-bruce-wayne-${STAMP}@capacitylens.dev`;
const MEMBER = `resource-clark-kent-${STAMP}@capacitylens.dev`;

async function putPerson(request: APIRequestContext, cookie: string, accountId: string, id: string, name: string) {
  const timestamp = new Date().toISOString();
  const response = await request.put(`${AUTH_API}/api/resources/${id}`, {
    headers: { cookie, "content-type": "application/json" },
    data: {
      id,
      accountId,
      createdAt: timestamp,
      updatedAt: timestamp,
      kind: "person",
      name,
      role: "Developer",
      employmentType: "permanent",
      engagement: "studio",
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      color: "#3b82f6",
    },
  });
  expect(response.status()).toBe(200);
}

async function setupResourceMembers(request: APIRequestContext) {
  const owner = await signUpUser(OWNER, "Bruce Wayne");
  const member = await signUpUser(MEMBER, "Clark Kent");
  const accountId = await bootstrapOrg(request, owner.cookie, `Wayne Enterprises ${STAMP}`);
  await putPerson(request, owner.cookie, accountId, `resource-linked-${STAMP}`, "Bruce Wayne");
  await putPerson(request, owner.cookie, accountId, `resource-invite-${STAMP}`, "Clark Kent");
  const invitation = await request.post(`${AUTH_API}/api/invites`, {
    headers: { cookie: owner.cookie },
    data: { accountId, role: "editor" },
  });
  expect(invitation.status()).toBe(201);
  const token = (await invitation.json()).token as string;
  const accepted = await request.post(`${AUTH_API}/api/invites/${token}/accept`, {
    headers: { cookie: member.cookie },
  });
  expect(accepted.status()).toBe(200);
  return { owner, member, accountId };
}

async function signIn(page: Page, email: string) {
  await page.goto("/");
  await page.getByRole("heading", { name: "Sign in" }).waitFor();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(AUTH_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/* eslint-disable max-lines-per-function */
test("an Owner links, changes, removes, and invites from resource rows while denied roles see no controls", async ({
  page,
  request,
  newObservedContext,
}) => {
  const { owner, accountId } = await setupResourceMembers(request);
  await signIn(page, OWNER);
  await page.getByRole("button", { name: `Wayne Enterprises ${STAMP}`, exact: true }).click();
  await waitForAppLanding(page, page.locator("#main"));
  await page.getByRole("link", { name: "Resources" }).click();

  const linkedRow = page.getByTestId("resource-row").filter({ hasText: "Bruce Wayne" });
  await linkedRow.getByRole("button", { name: /Link existing member Bruce Wayne/i }).click();
  const linkDialog = page.getByRole("dialog", { name: "Link Bruce Wayne to a member" });
  await selectShadOption(linkDialog.getByRole("combobox", { name: "Company member for Bruce Wayne" }), {
    label: "Clark Kent",
  });
  await linkDialog.getByRole("button", { name: "Save link" }).click();
  await expect(linkedRow.getByRole("button", { name: /Change link Bruce Wayne/i })).toBeVisible();
  const members = await request.get(`${AUTH_API}/api/accounts/${accountId}/members`, {
    headers: { cookie: owner.cookie },
  });
  const linkedMember = (
    (await members.json()).members as Array<{ email: string; resourceLink?: { resourceId: string } }>
  ).find((member) => member.email === MEMBER);
  expect(linkedMember?.resourceLink?.resourceId).toBe(`resource-linked-${STAMP}`);

  await linkedRow.getByRole("button", { name: /Change link Bruce Wayne/i }).click();
  const changeDialog = page.getByRole("dialog", { name: "Link Bruce Wayne to a member" });
  await selectShadOption(changeDialog.getByRole("combobox", { name: "Company member for Bruce Wayne" }), {
    label: "Bruce Wayne",
  });
  await changeDialog.getByRole("button", { name: "Save link" }).click();
  await expect(linkedRow.getByRole("button", { name: /Remove link Bruce Wayne/i })).toBeVisible();
  const changedMembers = await request.get(`${AUTH_API}/api/accounts/${accountId}/members`, {
    headers: { cookie: owner.cookie },
  });
  const changedRows = (await changedMembers.json()).members as Array<{
    email: string;
    resourceLink?: { resourceId: string };
  }>;
  expect(changedRows.find((row) => row.email === OWNER)?.resourceLink?.resourceId).toBe(`resource-linked-${STAMP}`);
  expect(changedRows.find((row) => row.email === MEMBER)?.resourceLink).toBeNull();

  await linkedRow.getByRole("button", { name: /Remove link Bruce Wayne/i }).click();
  await expect(linkedRow.getByRole("button", { name: /Link existing member Bruce Wayne/i })).toBeVisible();

  const inviteRequests: string[] = [];
  page.on("request", (requestEvent) => {
    if (requestEvent.method() === "POST" && requestEvent.url().endsWith("/api/invites"))
      inviteRequests.push(requestEvent.postData() ?? "");
  });
  const inviteRow = page.getByTestId("resource-row").filter({ hasText: "Clark Kent" });
  await inviteRow.getByRole("button", { name: /Invite to company Clark Kent/i }).click();
  await expect(page).toHaveURL(/\/team$/);
  const invitePanel = page.getByTestId("invites-section");
  await selectShadOption(invitePanel.getByTestId("invite-role"), "viewer");
  await expect(invitePanel.getByTestId("invite-person")).toContainText("Clark Kent");
  await invitePanel.getByTestId("invite-submit").click();
  await expect(invitePanel.getByTestId("invite-created-status")).toContainText("Invite created");
  expect(inviteRequests).toHaveLength(1);
  const inviteBody = inviteRequests[0];
  expect(inviteBody).toBeDefined();
  expect(JSON.parse(inviteBody!)).toMatchObject({
    role: "viewer",
    proposedResourceId: `resource-invite-${STAMP}`,
  });
  expect(inviteBody).not.toContain("/invite/");

  const memberContext = await newObservedContext();
  const memberPage = await memberContext.newPage();
  await signIn(memberPage, MEMBER);
  await memberPage.getByRole("button", { name: `Wayne Enterprises ${STAMP}`, exact: true }).click();
  await waitForAppLanding(memberPage, memberPage.locator("#main"));
  await memberPage.getByRole("link", { name: "Resources" }).click();
  await expect(memberPage.getByTestId("resource-member-actions")).toHaveCount(0);
  await memberContext.close();
});
/* eslint-enable max-lines-per-function */
