import { expect, test, type APIRequestContext, type Page } from "./fixtures";
import { AUTH_API, AUTH_PASSWORD, bootstrapOrg, signUpUser } from "./auth-helpers";
import { selectShadOption, waitForAppLanding } from "./helpers";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const STAMP = Date.now();
const OWNER = `resource-owner-${STAMP}@capacitylens.dev`;
const MEMBER = `resource-member-${STAMP}@capacitylens.dev`;

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
  const owner = await signUpUser(OWNER);
  const member = await signUpUser(MEMBER);
  const accountId = await bootstrapOrg(request, owner.cookie, `Resource links ${STAMP}`);
  await putPerson(request, owner.cookie, accountId, `resource-linked-${STAMP}`, "Victor Stone");
  await putPerson(request, owner.cookie, accountId, `resource-invite-${STAMP}`, "Diana Prince");
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
  return { owner, accountId };
}

async function signInOwner(page: Page) {
  await page.goto("/");
  await page.getByRole("heading", { name: "Sign in" }).waitFor();
  await page.getByLabel("Email").fill(OWNER);
  await page.getByLabel("Password").fill(AUTH_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("an Owner links a member and creates a private resource-first invitation", async ({ page, request }) => {
  const { owner, accountId } = await setupResourceMembers(request);
  const memberName = MEMBER.split("@")[0] ?? MEMBER;
  await signInOwner(page);
  await page.getByRole("button", { name: `Resource links ${STAMP}`, exact: true }).click();
  await waitForAppLanding(page, page.locator("#main"));
  await page.getByRole("link", { name: "Resources" }).click();

  const linkedRow = page.getByTestId("resource-row").filter({ hasText: "Victor Stone" });
  await linkedRow.getByRole("button", { name: /Link existing member Victor Stone/i }).click();
  const linkDialog = page.getByRole("dialog", { name: "Link Victor Stone to a member" });
  await selectShadOption(linkDialog.getByRole("combobox", { name: "Company member for Victor Stone" }), {
    label: memberName,
  });
  await linkDialog.getByRole("button", { name: "Save link" }).click();
  await expect(linkedRow.getByRole("button", { name: /Change link Victor Stone/i })).toBeVisible();
  const members = await request.get(`${AUTH_API}/api/accounts/${accountId}/members`, {
    headers: { cookie: owner.cookie },
  });
  const linkedMember = (
    (await members.json()).members as Array<{ email: string; resourceLink?: { resourceId: string } }>
  ).find((member) => member.email === MEMBER);
  expect(linkedMember?.resourceLink?.resourceId).toBe(`resource-linked-${STAMP}`);

  const inviteRequests: string[] = [];
  page.on("request", (requestEvent) => {
    if (requestEvent.method() === "POST" && requestEvent.url().endsWith("/api/invites"))
      inviteRequests.push(requestEvent.postData() ?? "");
  });
  const inviteRow = page.getByTestId("resource-row").filter({ hasText: "Diana Prince" });
  await inviteRow.getByRole("button", { name: /Invite to company Diana Prince/i }).click();
  const inviteDialog = page.getByRole("dialog", { name: "Invite for Diana Prince" });
  await selectShadOption(inviteDialog.getByRole("combobox", { name: "Invite role" }), "viewer");
  await inviteDialog.getByRole("button", { name: "Create invite" }).click();
  await expect(inviteDialog.getByRole("status")).toContainText("Invitation created");
  expect(inviteRequests).toHaveLength(1);
  const inviteBody = inviteRequests[0];
  expect(inviteBody).toBeDefined();
  expect(JSON.parse(inviteBody!)).toMatchObject({
    role: "viewer",
    proposedResourceId: `resource-invite-${STAMP}`,
  });
  expect(inviteBody).not.toContain("/invite/");
});
