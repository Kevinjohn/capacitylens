import { test, expect } from "./fixtures";
import {
  AUTH_API as API,
  AUTH_PASSWORD as PASSWORD,
  bootstrapOrg,
  seedFixtureEmailProof,
  seedFixtureLegacyEmailFlag,
  signUpUser,
} from "./authTestSupport";
import { waitForAppLanding } from "./browserTestSupport";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const STAMP = Date.now();
const OWNER = `bruce.wayne.join-${STAMP}@capacitylens.dev`;
const UNPROVEN = `selina.kyle.join-${STAMP}@capacitylens.dev`;
const PROVEN = `diana.prince.join-${STAMP}@capacitylens.dev`;
const COMPANY = `Wayne Joining Studio ${STAMP}`;

test("an existing proven password identity joins an open company as Viewer, while a legacy flag alone cannot", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const owner = await signUpUser(OWNER);
  const accountId = await bootstrapOrg(request, owner.cookie, COMPANY);
  const policy = await request.put(`${API}/api/accounts/${accountId}/joining-policy`, {
    headers: {
      cookie: owner.cookie,
      "idempotency-key": crypto.randomUUID(),
      "x-account-command-id": crypto.randomUUID(),
    },
    data: { policy: "open", approvedDomains: [] },
  });
  expect(policy.status()).toBe(200);

  await signUpUser(UNPROVEN);
  seedFixtureLegacyEmailFlag(UNPROVEN);
  const proven = await signUpUser(PROVEN);
  seedFixtureEmailProof(PROVEN);
  const before = await request.get(`${API}/api/accounts`, { headers: { cookie: proven.cookie } });
  expect(await before.json()).not.toContainEqual(expect.objectContaining({ id: accountId }));

  await page.goto(`/join/${accountId}`);
  await expect(page.getByRole("heading", { name: `Join ${COMPANY}` })).toBeVisible();
  await page.getByLabel("Email").fill(UNPROVEN);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Join company" }).click();
  await expect(page.getByText(/no current trusted proof/i)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/join/${accountId}$`));

  await page.context().clearCookies();
  await page.goto(`/join/${accountId}`);
  await page.getByLabel("Email").fill(PROVEN);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Join company" }).click();
  await expect(page).toHaveURL(/\/$/);
  await waitForAppLanding(page, page.locator("#main"));
  await page.getByRole("link", { name: "Team & access" }).click();
  await expect(page.getByTestId("current-access")).toContainText("Viewer");
  const after = await request.get(`${API}/api/accounts`, { headers: { cookie: proven.cookie } });
  expect(await after.json()).toContainEqual(expect.objectContaining({ id: accountId, role: "viewer" }));
});
