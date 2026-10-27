import { expect, test } from "./fixtures";
import type { Page, Request } from "@playwright/test";
import { AUTH_API, AUTH_PASSWORD, bootstrapOrg, seedFixtureMember, signUpUser } from "./authTestSupport";
import { waitForAppLanding } from "./browserTestSupport";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const STAMP = Date.now();
const OWNER_EMAIL = `masq-owner-${STAMP}@capacitylens.dev`;
const VIEWER_EMAIL = `masq-viewer-${STAMP}@capacitylens.dev`;
const EDITOR_EMAIL = `masq-editor-${STAMP}@capacitylens.dev`;
const COMPANY = `Masquerade Studio ${STAMP}`;

async function signIn(page: Page, email: string) {
  await page.goto("/");
  await page.getByRole("heading", { name: "Sign in" }).waitFor();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(AUTH_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Choose a company" })).toHaveCount(0);
  await waitForAppLanding(page, page.getByRole("heading", { name: "Schedule" }));
  await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();
}

async function expectNoOnboardingNoise(page: Page, requests: string[]) {
  await expect(page.getByTestId("getting-started-progress")).toHaveCount(0);
  await expect(page.getByTestId("getting-started")).toHaveCount(0);
  await expect(page.getByText("Getting started could not be refreshed. Try again.", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
  expect(requests).toEqual([]);
}

test.describe("member masquerade", () => {
  test("an owner sees the viewer projection until End now restores the real account", async ({ page, request }) => {
    const owner = await signUpUser(OWNER_EMAIL);
    const viewer = await signUpUser(VIEWER_EMAIL);
    const accountId = await bootstrapOrg(request, owner.cookie, COMPANY);
    seedFixtureMember(accountId, viewer.email, "viewer");

    await page.goto("/");
    await page.getByRole("heading", { name: "Sign in" }).waitFor();
    await page.getByLabel("Email").fill(OWNER_EMAIL);
    await page.getByLabel("Password").fill(AUTH_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Choose a company" })).toHaveCount(0);
    await waitForAppLanding(page, page.getByRole("heading", { name: "Schedule" }));

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
    await expect(page.getByTestId("current-access")).toContainText("Viewer");
    await expect(page.getByTestId("members-section")).toHaveCount(0);

    await banner.getByRole("button", { name: "End now" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();
    await expect(page.getByTestId("masquerade-banner")).toHaveCount(0);
    await expect(page.getByTestId("getting-started")).toBeVisible();
    await page.getByRole("link", { name: "Team & access" }).click();
    await expect(page.getByTestId("current-access")).toContainText("Owner");
    await expect(page.getByTestId("members-section")).toBeVisible();
  });

  test("an Editor projection skips onboarding requests and the real Editor still gets onboarding", async ({
    page,
    request,
    context,
    newObservedContext,
  }) => {
    const owner = await signUpUser(`masq-editor-owner-${STAMP}@capacitylens.dev`, "Bruce Wayne");
    const editor = await signUpUser(EDITOR_EMAIL, "Clark Kent");
    const accountId = await bootstrapOrg(request, owner.cookie, `Wayne Enterprises ${STAMP}`);
    seedFixtureMember(accountId, editor.email, "editor");

    await signIn(page, owner.email);
    await expect(page.getByTestId("getting-started")).toBeVisible();

    const onboardingPath = `/api/accounts/${accountId}/getting-started`;
    const ownerRouteRead = page.waitForResponse(
      (response) =>
        response.status() === 200 &&
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === onboardingPath,
    );
    await page.getByRole("link", { name: "Team & access" }).click();
    await expect(page.getByTestId("current-access")).toContainText("Owner");
    await ownerRouteRead;

    const onboardingRequests: string[] = [];
    const observeOnboardingRequest = (browserRequest: Request) => {
      const url = new URL(browserRequest.url());
      if (url.pathname === onboardingPath) onboardingRequests.push(`${browserRequest.method()} ${url.pathname}`);
    };
    page.on("request", observeOnboardingRequest);

    const editorRow = page.getByTestId("member-row").filter({ hasText: editor.email });
    await editorRow.getByTestId("member-masquerade").click();
    const confirmation = page.getByRole("alertdialog");
    await expect(confirmation).toContainText(editor.email);
    await confirmation.getByRole("button", { name: "Start masquerade" }).click();

    const banner = page.getByTestId("masquerade-banner");
    await expect(banner).toContainText("Masquerading as");
    await expect(page.getByTestId("current-access")).toContainText("Editor");
    await expectNoOnboardingNoise(page, onboardingRequests);

    const projectionCookies = await context.cookies(AUTH_API);
    const cookie = projectionCookies.map(({ name, value }) => `${name}=${value}`).join("; ");
    expect(cookie).not.toBe("");
    const headers = { cookie, "sec-fetch-site": "same-origin" };
    const planning = await request.get(`${AUTH_API}/api/accounts/${accountId}/planning`, { headers });
    expect(planning.status()).toBe(200);
    const revision = ((await planning.json()) as { revision: number }).revision;
    const refusedWrite = await request.post(`${AUTH_API}/api/accounts/${accountId}/clients`, {
      headers,
      data: {
        mutationId: crypto.randomUUID(),
        baseRevision: revision,
        intent: {
          operation: "catalogue.create",
          entity: {
            entity: "clients",
            id: crypto.randomUUID(),
            fields: { name: "Kord Industries", color: "#76a5e7" },
          },
        },
      },
    });
    expect(refusedWrite.status()).toBe(403);
    expect((await refusedWrite.json()).code).toBe("MASQUERADE_READ_ONLY");

    await page.getByRole("link", { name: "Resources" }).click();
    await expect(page.getByRole("heading", { name: "Resources" })).toBeVisible();
    await expectNoOnboardingNoise(page, onboardingRequests);
    await page.getByRole("link", { name: "Activities" }).click();
    await expect(page.getByRole("heading", { name: "Activities", exact: true })).toBeVisible();
    await expectNoOnboardingNoise(page, onboardingRequests);
    await page.getByRole("link", { name: "Schedule" }).click();
    await expect(page.getByTestId("scheduler-grid")).toBeVisible();
    await expectNoOnboardingNoise(page, onboardingRequests);

    page.off("request", observeOnboardingRequest);
    await banner.getByRole("button", { name: "End now" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("masquerade-banner")).toHaveCount(0);
    await expect(page.getByTestId("getting-started")).toBeVisible();
    await page.getByRole("link", { name: "Team & access" }).click();
    await expect(page.getByTestId("current-access")).toContainText("Owner");

    const editorContext = await newObservedContext({
      baseURL: new URL(page.url()).origin,
      reducedMotion: "reduce",
    });
    try {
      const editorPage = await editorContext.newPage();
      await signIn(editorPage, editor.email);
      await expect(editorPage.getByTestId("getting-started-progress")).toBeVisible();
      await expect(editorPage.getByTestId("getting-started")).toBeVisible();
      await editorPage.getByRole("link", { name: "Team & access" }).click();
      await expect(editorPage.getByTestId("current-access")).toContainText("Editor");
      await expect(editorPage.getByTestId("getting-started-progress")).toBeVisible();
    } finally {
      await editorContext.close();
    }
  });
});
