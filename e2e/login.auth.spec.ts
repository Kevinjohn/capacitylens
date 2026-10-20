import { test, expect } from "./fixtures";
import type { APIRequestContext } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import {
  AUTH_API as API,
  AUTH_PASSWORD as PASSWORD,
  BOOTSTRAP_ADMIN,
  bootstrapOrg,
  signUpUser,
} from "./authTestSupport";

test.use({ contextOptions: { reducedMotion: "reduce" } });

// This spec exercises the password-mode login wall; the core demo project uses cosmetic sign-in.

// Shared auth helpers come from authTestSupport. A fresh user has no membership, so GET /api/accounts
// returns no companies. The first-company route provisions a company for the signed-in owner.
const EMAIL = "tester@capacitylens.dev";
const ORG_NAME = `Login Studio ${Date.now()}`;

// This path signs up through the API because the test does not need the form. It tolerates
// USER_ALREADY_EXISTS (422) when rerun against a reused server. It uses the request cookie jar because
// this test does not need the returned session; the shared signUpUser helper requires a fresh signup.
async function seedUser(request: APIRequestContext, email = EMAIL) {
  const res = await request.post(`${API}/api/auth/sign-up`, {
    data: { email, password: PASSWORD, name: "Tester" },
  });
  if (!res.ok()) expect(res.status()).toBe(422);
}

function registerUnauthenticatedVisitShowsLoginScreenTest() {
  test("unauthenticated visit shows the login screen, not the app — and the API 401s", async ({ page, request }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Choose a company" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Schedule" })).toHaveCount(0);
    expect((await request.get(`${API}/api/state`)).status()).toBe(401);

    await seedUser(request);
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(
      blocking,
      JSON.stringify(
        blocking.map((v) => ({ id: v.id, nodes: v.nodes.length })),
        null,
        2,
      ),
    ).toEqual([]);
  });
}

function registerSigningRevealsAppSigningOutTest() {
  test("signing in reveals the app; signing out from Account via the sidebar returns to the login screen", async ({
    page,
    request,
  }) => {
    // A fresh per-run user guarantees the sign-up cookie (no 422 on a reused DB); /api/orgs
    // creates the first company and makes the caller its Owner.
    const { email, cookie } = await signUpUser(`login-${Date.now()}@capacitylens.dev`);
    await bootstrapOrg(request, cookie, ORG_NAME);

    const unscopedStateReads: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/state" && !url.searchParams.has("accountId")) unscopedStateReads.push(url.href);
    });

    await page.goto("/");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    expect(unscopedStateReads).toEqual([]);

    // The server selects this login's only company and the active account hydrates its slice via
    // GET /api/state?accountId= without showing a company picker.
    await expect(page.getByRole("heading", { name: "Choose a company" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "How CapacityLens works" })).toBeVisible();
    await page.getByRole("button", { name: "Got it" }).click();
    await expect(page.getByRole("link", { name: "Settings", exact: true })).toBeVisible();

    await page.getByRole("link", { name: "Account", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
    await expect(page.getByText(email, { exact: true })).toBeVisible();
    await expect(page.getByRole("columnheader")).toHaveText(["Avatar", "Name", "Email", "Actions"]);
    const actions = page.getByTestId("account-identity-row").locator("td").nth(3);
    await expect(actions.getByRole("button")).toHaveText(["Change password", "Sign out"]);
    await actions.getByRole("button", { name: "Change password" }).click();
    const passwordDialog = page.getByRole("dialog", { name: "Change password" });
    await expect(passwordDialog.locator('[data-product-layout="label-control"]')).toHaveCount(3);
    await expect(passwordDialog.locator('[data-slot="dialog-footer"] button')).toHaveText([
      "Cancel",
      "Change password",
    ]);
    await expect(passwordDialog.getByLabel("Current password")).toBeFocused();
    await passwordDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(passwordDialog).toHaveCount(0);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });
}

function registerCreateOwnerAdminAdminBootstrapTest() {
  test("the --create-owner-admin-admin bootstrap credential signs in through the real form", async ({
    page,
    request,
  }, testInfo) => {
    // The disposable server pins an administrator credential, allowing this test to exercise access recovery without company membership.
    const suffix = `${Date.now()}-${testInfo.workerIndex}`;
    const controlOrgName = `Wayne Enterprises ${suffix}`;
    const controlOwner = await signUpUser(`bootstrap-control-${suffix}@capacitylens.dev`);
    await bootstrapOrg(request, controlOwner.cookie, controlOrgName);

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await page.getByLabel("Email").fill(BOOTSTRAP_ADMIN.email);
    await page.getByLabel("Password").fill(BOOTSTRAP_ADMIN.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Start planning" })).toBeVisible();
    await expect(page.getByText("Ask an admin for an invite to join a company.")).toBeVisible();
    await expect(page.getByRole("button", { name: controlOrgName, exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "New company" })).toHaveCount(0);
  });
}

function registerLoginWithoutMembershipTests() {
  test("a login with NO memberships sees no company data (tenant isolation — no cross-tenant leak)", async ({
    page,
    request,
  }, testInfo) => {
    // A user with no account memberships sees no company data. Company creation requires the owner
    // or admin role enforced by POST /api/orgs, so the empty state tells them to request an invitation.
    const isolationSuffix = `${Date.now()}-${testInfo.workerIndex}`;
    const controlOrgName = `Isolation Control ${isolationSuffix}`;
    const controlOwner = await signUpUser(`isolation-owner-${isolationSuffix}@capacitylens.dev`);
    await bootstrapOrg(request, controlOwner.cookie, controlOrgName);

    const lonely = `lonely-${isolationSuffix}@capacitylens.dev`;
    await seedUser(request, lonely);
    await page.goto("/");
    await page.getByLabel("Email").fill(lonely);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("heading", { name: "Start planning" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Choose a company" })).toHaveCount(0);
    await expect(page.getByText("Ask an admin for an invite to join a company.")).toBeVisible();
    await expect(page.getByRole("button", { name: controlOrgName, exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "New company" })).toHaveCount(0);
  });
}

test.describe("login screen (CAPACITYLENS_MODE=password)", () => {
  registerUnauthenticatedVisitShowsLoginScreenTest();
  registerSigningRevealsAppSigningOutTest();
  registerCreateOwnerAdminAdminBootstrapTest();
  registerLoginWithoutMembershipTests();
});
