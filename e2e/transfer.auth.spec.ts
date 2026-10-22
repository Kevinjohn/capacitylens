import { test, expect } from "./fixtures";
import type { APIRequestContext, Page } from "./fixtures";
import { buildBetaExport, serializeBetaExport } from "@capacitylens/shared/data/betaTransfer";
import type { AppData } from "@capacitylens/shared/types/entities";
import { AUTH_API, AUTH_PASSWORD, bootstrapOrg, signUpUser } from "./authTestSupport";
import { waitForAppLanding } from "./browserTestSupport";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const STAMP = Date.now();
const OWNER = `transfer-owner-${STAMP}@capacitylens.dev`;
const COMPANY = `Wayne Transfer Studio ${STAMP}`;

async function companyState(request: APIRequestContext, cookie: string, accountId: string): Promise<AppData> {
  const response = await request.get(
    `${AUTH_API}/api/state?accountId=${encodeURIComponent(accountId)}&includeInactive=1`,
    {
      headers: { cookie },
    },
  );
  expect(response.status()).toBe(200);
  return (await response.json()) as AppData;
}

async function chooseFile(page: Page, document: ReturnType<typeof buildBetaExport>) {
  await page.getByTestId("import-input").setInputFiles({
    name: "wayne-transfer.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeBetaExport(document)),
  });
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alertdialog", { name: "Import data?" })).toBeVisible();
}

test("an Owner previews, cancels, then confirms one password-bound company import", async ({ page, request }) => {
  const owner = await signUpUser(OWNER, "Bruce Wayne");
  const accountId = await bootstrapOrg(request, owner.cookie, COMPANY);
  const before = await companyState(request, owner.cookie, accountId);
  const document = buildBetaExport(before, { accountId, completeness: "full" });
  const account = document.data.accounts[0];
  if (!account) throw new Error("The company export is empty.");
  account.name = `Wayne Transfer Restored ${STAMP}`;

  await page.goto("/");
  await page.getByRole("heading", { name: "Sign in" }).waitFor();
  await page.getByLabel("Email").fill(OWNER);
  await page.getByLabel("Password").fill(AUTH_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await waitForAppLanding(page, page.locator("#main"));
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Import and export", exact: true }).click();

  await chooseFile(page, document);
  await page.getByRole("alertdialog", { name: "Import data?" }).getByRole("button", { name: "Cancel" }).click();
  expect((await companyState(request, owner.cookie, accountId)).accounts[0]?.name).toBe(COMPANY);

  await chooseFile(page, document);
  await page.getByRole("button", { name: "Replace data" }).click();
  await expect(
    page.getByText("Enter your current password to confirm this specific action.", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("Password").fill(AUTH_PASSWORD);
  await page.getByTestId("action-proof-confirm").click();
  await expect
    .poll(async () => (await companyState(request, owner.cookie, accountId)).accounts[0]?.name)
    .toBe(account.name);
  await page.reload();
  await expect(page.getByText(account.name).first()).toBeVisible();
});
