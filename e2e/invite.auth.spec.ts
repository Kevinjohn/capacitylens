import { test, expect } from "./fixtures";
import {
  AUTH_API as API,
  AUTH_PASSWORD as PASSWORD,
  bootstrapOrg,
  signUpUser,
  waitForJoiningMail,
} from "./auth-helpers";
import { waitForAppLanding } from "./helpers";
import { totpCode } from "./totpCode";

test.use({ contextOptions: { reducedMotion: "reduce" } });

// P1.9 — invite accept, against the auth-backed project's server (SMALLSASS_ACCOUNT_MODE=password on
// :8887 — see playwright.config.ts). Owner A signs up, bootstraps an org (via the operator bootstrap
// token, since the auth-e2e DB is seeded so A is not first-run), and mints an editor invite token via
// POST /api/invites. User B then opens /invite/<token> in the browser: the safe preview leads to
// the company-bound mailbox proof. B opens the delivered link in that browser, signs in with an
// existing account, and completes the admission. Finally we assert the API-layer single-use guarantee (re-POSTing
// the same token is 409). Browser-agnostic (no UA branching).

// The auth-e2e server is SEEDED (Wayne Enterprises + Stark Industries), so a fresh sign-up is not a first-run
// bootstrap and holds no membership — /api/orgs would 403; the BOOTSTRAP_TOKEN (from ./auth-helpers)
// is the documented operator path to provision an org on an already-populated instance. Shared
// plumbing (API/BOOTSTRAP_TOKEN/signUp) comes from ./auth-helpers.
const STAMP = Date.now();
const OWNER = `owner-${STAMP}@capacitylens.dev`;
const JOINER = `joiner-${STAMP}@capacitylens.dev`;
const NEW_JOINER = `new-joiner-${STAMP}@capacitylens.dev`;

function registerSuiteScenario1() {
  test("a signed-in user opens a valid invite link and joins; reusing the token is 409", async ({ page, request }) => {
    test.setTimeout(60_000);
    // Owner A: sign up (auto-signed-in → session cookie), bootstrap an org, mint an invite. The
    // explicit `cookie` header (not the shared jar) carries A's session on each call.
    const joinerPromise = signUpUser(JOINER);
    const ownerCookie = (await signUpUser(OWNER)).cookie;

    const accountId = await bootstrapOrg(request, ownerCookie, `Invite Studio ${STAMP}`);

    const inviteRes = await request.post(`${API}/api/invites`, {
      headers: { cookie: ownerCookie },
      data: { accountId, role: "editor", preauthEmail: JOINER },
    });
    expect(inviteRes.status()).toBe(201);
    const token = (await inviteRes.json()).token as string;
    expect(token.length).toBeGreaterThan(0);

    // User B exists (sign-up is API-only; keep B's session cookie for the API reuse check below).
    // Opening /invite/<token> in the browser has NO session. Preview is read-only and hands off
    // to the bound joining journey before any membership write.
    const joinerCookie = (await joinerPromise).cookie;
    await page.goto(`/invite/${token}`);

    // The invite page previews the safe acceptance context before asking B to prove the mailbox.
    await expect(page.getByRole("heading", { name: "Accept invite" })).toBeVisible();
    const preview = page.getByTestId("invite-preview");
    await expect(preview).toContainText(`Invite Studio ${STAMP}`);
    await expect(preview).toContainText("Invitation role");
    await expect(preview).toContainText("Editor");
    await expect(preview).toContainText("Can edit scheduling data");
    await expect(preview).toContainText("accepting keeps your existing role");
    await expect(preview).toContainText("This single-use invite expires");
    await expect(page.getByLabel("Name", { exact: true })).toHaveCount(0);
    const roleBox = await page.getByTestId("invite-role").boundingBox();
    const companyBox = await preview.getByRole("heading", { name: `Invite Studio ${STAMP}` }).boundingBox();
    expect(roleBox).not.toBeNull();
    expect(companyBox).not.toBeNull();
    expect((roleBox?.y ?? 0) + (roleBox?.height ?? 0)).toBeLessThanOrEqual(companyBox?.y ?? 0);
    expect(
      await preview
        .locator("[data-slot='item-description']")
        .evaluateAll((descriptions) =>
          descriptions.every((description) => getComputedStyle(description).webkitLineClamp === "none"),
        ),
    ).toBe(true);
    await page.getByRole("link", { name: "Verify email to join" }).click();
    await expect(page).toHaveURL(new RegExp(`/join/${accountId}\\?invite=`));
    await page.getByLabel("Email", { exact: true }).fill(JOINER);
    await page.getByRole("button", { name: "Send verification email" }).click();
    const mailLink = await waitForJoiningMail(JOINER, accountId);
    expect(mailLink.searchParams.get("invite")).toBe(token);
    await page.goto(new URL(`${mailLink.pathname}${mailLink.search}${mailLink.hash}`, page.url()).toString());
    await expect(page.getByText(/Email verified/i)).toBeVisible();
    await page.getByLabel("Password", { exact: true }).last().fill(PASSWORD);
    await page.getByRole("button", { name: "Join company", exact: true }).click();

    // Completion must land inside the joined company, not on the picker.
    await expect(page).toHaveURL(/\/$/);
    await waitForAppLanding(page, page.locator("#main"));
    // In the app, the joined company is active. Its single-company context is intentionally hidden
    // from the sidebar, so verify the authoritative current-access card instead.
    await expect(page.getByRole("heading", { name: "Choose a company" })).toHaveCount(0);
    await page.getByRole("link", { name: "Team & access" }).click();
    await expect(page.getByTestId("current-access")).toContainText("Editor");

    // Single-use guarantee at the API layer: the browser accept already consumed the token, so a
    // second accept (B's API session) of the same token is 409.
    const reuse = await request.post(`${API}/api/invites/${token}/accept`, {
      headers: { cookie: joinerCookie },
    });
    expect(reuse.status()).toBe(409);
  });
}

function registerSuiteScenario2() {
  test("a new pre-authorized identity signs up and enters the invited company", async ({ page, request }) => {
    test.setTimeout(60_000);

    const ownerCookie = (await signUpUser(`${OWNER}.signup`)).cookie;
    const accountId = await bootstrapOrg(request, ownerCookie, `Signup Invite Studio ${STAMP}`);

    // A new identity proves the addressed mailbox in this browser before any credential exists.
    const signupInvite = await request.post(`${API}/api/invites`, {
      headers: { cookie: ownerCookie },
      data: { accountId, role: "editor", preauthEmail: NEW_JOINER },
    });
    expect(signupInvite.status()).toBe(201);
    const signupToken = (await signupInvite.json()).token as string;
    await page.goto(`/invite/${signupToken}`);
    await expect(page.getByTestId("invite-preview")).toContainText(`${NEW_JOINER.split("@")[0]}@…`);
    await expect(page.getByTestId("invite-preview")).not.toContainText(NEW_JOINER);
    await page.getByRole("link", { name: "Verify email to join" }).click();
    await expect(page).toHaveURL(new RegExp(`/join/${accountId}\\?invite=`));
    await page.getByLabel("Email", { exact: true }).fill(NEW_JOINER);
    await page.getByRole("button", { name: "Send verification email" }).click();
    await expect(page.getByText(/Open it in this same browser within 15 minutes/i)).toBeVisible();
    const mailLink = await waitForJoiningMail(NEW_JOINER, accountId);
    expect(mailLink.searchParams.get("invite")).toBe(signupToken);
    // The E2E API and Vite are split origins; production serves both on one origin.
    await page.goto(new URL(`${mailLink.pathname}${mailLink.search}${mailLink.hash}`, page.url()).toString());
    await expect(page.getByText(/Email verified/i)).toBeVisible();
    await page.getByLabel("Name", { exact: true }).fill("New Joiner");
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Create account and join" }).click();

    await expect(page).toHaveURL(/\/$/);
    await waitForAppLanding(page, page.locator("#main"));
    // The joined company is active, while its single-company context is intentionally hidden from
    // the sidebar. Team & access exposes the authoritative role projection.
    await expect(page.getByRole("heading", { name: "Choose a company" })).toHaveCount(0);
    await page.getByRole("link", { name: "Team & access" }).click();
    await expect(page.getByTestId("current-access")).toContainText("Editor");
  });
}

function registerSuiteScenarioMfa() {
  test("an existing account completes TOTP before an addressed invitation grants access", async ({ page, request }) => {
    test.setTimeout(60_000);
    const email = `mfa-joiner-${STAMP}@capacitylens.dev`;
    const joiner = await signUpUser(email);
    const enabled = await request.post(`${API}/api/auth/two-factor/enable`, {
      headers: { cookie: joiner.cookie },
      data: { password: PASSWORD },
    });
    expect(enabled.status()).toBe(200);
    const setup = (await enabled.json()) as { totpURI: string };
    const secret = new URL(setup.totpURI).searchParams.get("secret");
    expect(secret).toBeTruthy();
    const enrolled = await request.post(`${API}/api/auth/two-factor/verify-totp`, {
      headers: { cookie: joiner.cookie },
      data: { code: await totpCode(secret!), trustDevice: false },
    });
    expect(enrolled.status()).toBe(200);

    const ownerCookie = (await signUpUser(`${OWNER}.mfa`)).cookie;
    const accountId = await bootstrapOrg(request, ownerCookie, `MFA Invite Studio ${STAMP}`);
    const invite = await request.post(`${API}/api/invites`, {
      headers: { cookie: ownerCookie },
      data: { accountId, role: "editor", preauthEmail: email },
    });
    expect(invite.status()).toBe(201);
    const token = (await invite.json()).token as string;

    await page.goto(`/invite/${token}`);
    await page.getByRole("link", { name: "Verify email to join" }).click();
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByRole("button", { name: "Send verification email" }).click();
    const mailLink = await waitForJoiningMail(email, accountId);
    expect(mailLink.searchParams.get("invite")).toBe(token);
    await page.goto(new URL(`${mailLink.pathname}${mailLink.search}${mailLink.hash}`, page.url()).toString());
    await expect(page.getByText(/Email verified/i)).toBeVisible();
    await page.getByLabel("Password", { exact: true }).last().fill(PASSWORD);
    await page.getByRole("button", { name: "Join company", exact: true }).click();
    await expect(page.getByLabel("Authentication code")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/join/${accountId}\\?invite=`));
    await page.getByLabel("Authentication code").fill(await totpCode(secret!));
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL(/\/$/);
    await waitForAppLanding(page, page.locator("#main"));
    await page.getByRole("link", { name: "Team & access" }).click();
    await expect(page.getByTestId("current-access")).toContainText("Editor");
  });
}

test.describe("invite accept (SMALLSASS_ACCOUNT_MODE=password)", () => {
  registerSuiteScenario1();
  registerSuiteScenario2();
  registerSuiteScenarioMfa();

  test("a maximum-length addressed hint wraps within a narrow invitation preview", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 1000 });
    const emailHint = `${"a".repeat(252)}@…`;
    await page.route("**/api/invites/*/preview", (route) =>
      route.fulfill({
        json: {
          accountName: "Wayne Enterprises",
          role: "editor",
          expiresAt: "2999-01-01T00:00:00.000Z",
          emailBound: true,
          emailHint,
        },
      }),
    );
    await page.goto("/invite/long-hint-layout");
    await expect(page.getByTestId("invite-preview")).toContainText(emailHint);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });
});
