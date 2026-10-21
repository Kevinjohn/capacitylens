import { test, expect } from "./fixtures";
import { API, resetServer, serverState, requireStateRows } from "./serverTestState";
import { createCompany } from "./appEntrySupport";

// The server rejects direct API updates to frozen account fields (language, weekStartsOn, and
// timezone) with 409. The read-only Settings summary is a convenience; server enforcement also
// applies when a client bypasses the UI.

test.describe("database-backed onboarding lock (P1.14)", () => {
  test.beforeEach(async ({ request }) => {
    await resetServer({ request: request, withSeed: true });
  });

  test("direct PATCHes of changeable frozen fields are rejected and unsupported language is rejected", async ({
    request,
  }) => {
    const before = await serverState(request);
    const account = requireStateRows(before, "accounts")[0];
    if (account === undefined) throw new Error("Seeded server state must include an account");

    const changes = [
      ["weekStartsOn", 1, 0],
      ["timezone", "UTC", "Europe/London"],
    ] as const;
    for (const [field, initial, target] of changes) {
      // The demo seed deliberately models legacy accounts with these optional fields absent.
      // Missing frozen fields may be initialized once; only a subsequent change is forbidden.
      const initialized = await request.patch(`${API}/api/accounts/${account.id}`, {
        data: { [field]: initial },
      });
      expect(initialized.status(), `${field} must allow one-time initialization`).toBe(200);

      const res = await request.patch(`${API}/api/accounts/${account.id}`, {
        data: { [field]: target },
      });
      expect(res.status(), `${field} must remain frozen`).toBe(409);
    }

    // English is currently the only supported language. A malformed choice is rejected
    // before frozen-field handling and cannot change stored account settings.
    const language = await request.patch(`${API}/api/accounts/${account.id}`, {
      data: { language: "fr" },
    });
    expect(language.status()).toBe(400);

    const after = await serverState(request);
    const updatedAccount = requireStateRows(after, "accounts")[0];
    if (updatedAccount === undefined) throw new Error("Server state must retain the seeded account");
    expect(updatedAccount.language).toBeUndefined();
    expect(updatedAccount).toMatchObject({
      weekStartsOn: 1,
      timezone: "UTC",
    });
  });
});

// With CAPACITYLENS_MULTI_ACCOUNT unset, start:e2e enforces a one-company limit. resetServer seeds
// the test data while bypassing the create-time gate, so the test starts at the cap. The direct API
// assertion below verifies the server's 403; hiding the New company button is only a UI cue.
test.describe("single-company-per-instance policy (client-side affordance + server backstop)", () => {
  test.beforeEach(async ({ request }) => {
    await resetServer({ request: request, withSeed: true });
  });

  test("the account picker lists both seeded companies but hides the New company button", async ({ page }) => {
    await page.goto("/");
    const signIn = page.getByTestId("fake-sign-in");
    const wayneEnterprises = page.getByRole("button", {
      name: "Wayne Enterprises",
      exact: true,
    });
    await signIn.or(wayneEnterprises).first().waitFor();
    if (await signIn.isVisible()) await signIn.click();

    await expect(wayneEnterprises).toBeVisible();
    await expect(page.getByRole("button", { name: "Stark Industries", exact: true })).toBeVisible();
    // GET /api/auth/me reports canCreateAccount: false once ≥1 account exists and
    // CAPACITYLENS_MULTI_ACCOUNT is unset, the button is hidden entirely, not merely disabled.
    await expect(page.getByTestId("new-company-button")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "New company" })).toHaveCount(0);
  });

  test("a direct API create beyond the cap is rejected 403 with the exact policy message", async ({ request }) => {
    const res = await request.post(`${API}/api/accounts`, {
      data: {
        id: `e2e-cap-check-${Date.now()}`,
        name: "Should Not Exist",
        color: "#76a5e7",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
    expect(res.status()).toBe(403);
    expect(await res.json()).toMatchObject({
      code: "FORBIDDEN",
      error: "This instance allows a single company. Set CAPACITYLENS_MULTI_ACCOUNT=1 to allow more.",
      retryable: false,
    });

    const after = await serverState(request);
    expect(requireStateRows(after, "accounts")).toHaveLength(2);
  });
});

// Example data is added by the server, so this is the server-backed half of the first-company flow:
// no companies exist, the create form offers the box ticked, and the new company opens on a schedule
// that already shows the example people and their bookings in the current week.
test.describe("first company with example data", () => {
  test.beforeEach(async ({ request }) => {
    await resetServer({ request: request, withSeed: false });
  });

  test("creating the first company with Start with example data ticked opens a populated schedule", async ({
    page,
  }) => {
    await page.goto("/");
    const signIn = page.getByTestId("fake-sign-in");
    const companyName = page.getByLabel("Company name");
    await signIn.or(companyName).first().waitFor();
    if (await signIn.isVisible()) await signIn.click();

    await expect(page.getByRole("checkbox", { name: "Start with example data" })).toBeChecked();
    await createCompany(page, "Wayne Enterprises");

    await expect(page.getByText("Dick Grayson", { exact: true })).toBeVisible();
    await expect(page.getByText("Barbara Gordon", { exact: true })).toBeVisible();
    await expect(page.getByTestId("allocation-bar").filter({ hasText: "Wireframes" }).first()).toBeVisible();
    await expect(page.getByTestId("allocation-bar").filter({ hasText: "Build" }).first()).toBeVisible();
  });
});
