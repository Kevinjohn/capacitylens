import { expect, test } from "./fixtures";
import { AUTH_API, AUTH_PASSWORD, bootstrapOrg, signUpUser } from "./auth-helpers";
import { dismissIntroIfPresent } from "./helpers";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const STAMP = Date.now();
const OWNER_EMAIL = `masq-owner-${STAMP}@capacitylens.dev`;
const VIEWER_EMAIL = `masq-viewer-${STAMP}@capacitylens.dev`;
const COMPANY = `Masquerade Studio ${STAMP}`;

test.describe("member masquerade", () => {
  test("an owner sees the viewer projection until End now restores the real account", async ({ page, request }) => {
    const owner = await signUpUser(OWNER_EMAIL);
    const viewer = await signUpUser(VIEWER_EMAIL);
    const accountId = await bootstrapOrg(request, owner.cookie, COMPANY);
    const invitation = await request.post(`${AUTH_API}/api/invites`, {
      headers: { cookie: owner.cookie },
      data: { accountId, role: "viewer" },
    });
    expect(invitation.status()).toBe(201);
    const token = ((await invitation.json()) as { token: string }).token;
    const accepted = await request.post(`${AUTH_API}/api/invites/${token}/accept`, {
      headers: { cookie: viewer.cookie },
    });
    expect(accepted.status()).toBe(200);

    await page.goto("/");
    await page.getByRole("heading", { name: "Sign in" }).waitFor();
    await page.getByLabel("Email").fill(OWNER_EMAIL);
    await page.getByLabel("Password").fill(AUTH_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("button", { name: COMPANY, exact: true }).click();
    await dismissIntroIfPresent(page, page.getByRole("heading", { name: "Schedule" }));

    await page.getByRole("link", { name: "Team & access" }).click();
    const viewerRow = page.getByTestId("member-row").filter({ hasText: VIEWER_EMAIL });
    await viewerRow.getByTestId("member-masquerade").click();
    const confirmation = page.getByRole("alertdialog");
    await expect(confirmation).toContainText(VIEWER_EMAIL);
    await confirmation.getByRole("button", { name: "Start masquerade" }).click();

    const banner = page.getByTestId("masquerade-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("role", "status");
    await expect(banner).toContainText("Masquerading as");
    await expect(banner.getByRole("button", { name: "End now" })).toBeVisible();
    await expect(page.getByTestId("view-only")).toBeVisible();
    await expect(page.getByTestId("members-section")).toHaveCount(0);

    await banner.getByRole("button", { name: "End now" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();
    await expect(page.getByTestId("masquerade-banner")).toHaveCount(0);
    await expect(page.getByTestId("view-only")).toHaveCount(0);
    await expect(page.getByTestId("getting-started")).toBeVisible();
  });
});
