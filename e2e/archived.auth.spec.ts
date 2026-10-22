import { expect, test } from "./fixtures";
import { AUTH_API, AUTH_PASSWORD, bootstrapOrg, signUpUser } from "./authTestSupport";
import { waitForAppLanding } from "./browserTestSupport";

const suffix = Date.now();

test("an Owner archives, restores and anonymises a resource, then confirms a whole-company scrub", async ({
  page,
  request,
}) => {
  const email = `bruce-wayne-lifecycle-${suffix}@capacitylens.dev`;
  const owner = await signUpUser(email, "Bruce Wayne");
  const accountId = await bootstrapOrg(request, owner.cookie, `Wayne Lifecycle Studio ${suffix}`);
  const now = new Date().toISOString();
  const resources = [
    { id: crypto.randomUUID(), name: "Barry Allen" },
    { id: crypto.randomUUID(), name: "Clark Kent" },
  ];
  for (const resource of resources) {
    const response = await request.post(`${AUTH_API}/api/batch`, {
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      data: {
        ops: [
          {
            method: "PUT",
            table: "resources",
            id: resource.id,
            row: {
              id: resource.id,
              accountId,
              createdAt: now,
              updatedAt: now,
              kind: "person",
              name: resource.name,
              role: "Planner",
              employmentType: "permanent",
              engagement: "studio",
              workingHoursPerDay: 8,
              workingDays: [1, 2, 3, 4, 5],
              halfDays: [],
              color: "#76a5e7",
            },
          },
        ],
      },
    });
    expect(response.status()).toBe(200);
  }

  await page.goto("/");
  await page.getByRole("heading", { name: "Sign in" }).waitFor();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(AUTH_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await waitForAppLanding(page, page.locator("#main"));
  await page.getByRole("link", { name: "Resources" }).click();

  const row = page.getByTestId("resource-row").filter({ hasText: "Barry Allen" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Archive Barry Allen" }).click();
  await page.getByRole("alertdialog", { name: "Archive resource?" }).getByRole("button", { name: "Archive" }).click();
  const archive = page.getByTestId("archived-resources-section");
  const archived = archive.getByTestId("archived-row").filter({ hasText: "Barry Allen" });
  await expect(archived).toBeVisible();
  await archived.getByRole("button", { name: "Restore Barry Allen" }).click();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Archive Barry Allen" }).click();
  await page.getByRole("alertdialog", { name: "Archive resource?" }).getByRole("button", { name: "Archive" }).click();
  await archive
    .getByTestId("archived-row")
    .filter({ hasText: "Barry Allen" })
    .getByRole("button", { name: "Anonymise Barry Allen" })
    .click();
  await page
    .getByRole("alertdialog", { name: "Anonymise resource?" })
    .getByRole("button", { name: "Anonymise" })
    .click();
  await expect(archive.getByTestId("archived-row").filter({ hasText: /Removed person/ })).toBeVisible();

  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByTestId("settings-company-anonymise").getByRole("button", { name: "Anonymise all resources" }).click();
  await page
    .getByRole("dialog", { name: "Anonymise all company resources?" })
    .getByRole("button", { name: "Anonymise all resources" })
    .click();
  await page.getByLabel("Password").fill(AUTH_PASSWORD);
  const reloaded = page.waitForEvent("load");
  await page.getByRole("dialog", { name: "Confirm it's you" }).getByRole("button", { name: "Confirm" }).click();
  await reloaded;
  await waitForAppLanding(page, page.locator("#main"));

  const stateResponse = await request.get(`${AUTH_API}/api/state`, { headers: { cookie: owner.cookie } });
  expect(stateResponse.status()).toBe(200);
  const state = (await stateResponse.json()) as {
    accounts: Array<{ id: string }>;
    resources: Array<{ id: string; name: string; role: string; avatarUrl: string | null }>;
  };
  expect(state.accounts.some((account) => account.id === accountId)).toBe(true);
  for (const resource of resources) {
    const scrubbed = state.resources.find((row) => row.id === resource.id);
    expect(scrubbed?.name).toMatch(/^Removed person/);
    expect(scrubbed?.role).toBe("Removed resource");
    expect(scrubbed?.avatarUrl).toBeNull();
  }
});
