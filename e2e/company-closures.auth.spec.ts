import { test, expect, type APIRequestContext, type Page } from "./fixtures";
import { AUTH_API, AUTH_PASSWORD, bootstrapOrg, signUpUser } from "./auth-helpers";
import { dismissIntroIfPresent, freezeBrowserDate, goToSeedWeek, setZoom } from "./helpers";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const STAMP = `${Date.now()}`;
const ORG = `Gotham Closures ${STAMP}`;
const OWNER = `closure-owner-${STAMP}@capacitylens.dev`;
const EDITOR = `closure-editor-${STAMP}@capacitylens.dev`;
const IDS = {
  person: `barbara-${STAMP}`,
  external: `kord-${STAMP}`,
};

async function putEntity(
  request: APIRequestContext,
  cookie: string,
  entity: string,
  id: string,
  data: Record<string, unknown>,
) {
  const response = await request.put(`${AUTH_API}/api/${entity}/${id}`, {
    headers: { cookie, "content-type": "application/json" },
    data: { id, ...data },
  });
  expect(response.status(), `seed ${entity}/${id}`).toBe(200);
}

async function signInAsEditor(page: Page) {
  await freezeBrowserDate(page);
  await page.goto("/");
  await page.getByRole("heading", { name: "Sign in" }).waitFor();
  await page.getByLabel("Email").fill(EDITOR);
  await page.getByLabel("Password").fill(AUTH_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: ORG, exact: true }).click();
  await dismissIntroIfPresent(page, page.getByRole("heading", { name: "Schedule" }));
}

test("an editor creates, sees, edits and deletes a literal company closure band", async ({ page, request }) => {
  const owner = await signUpUser(OWNER);
  const editor = await signUpUser(EDITOR);
  const accountId = await bootstrapOrg(request, owner.cookie, ORG);
  const seededAt = new Date().toISOString();
  const scoped = { accountId, createdAt: seededAt, updatedAt: seededAt };

  const accountUpdate = await request.patch(`${AUTH_API}/api/accounts/${accountId}`, {
    headers: { cookie: owner.cookie },
    data: { externalEnabled: true },
  });
  expect(accountUpdate.status()).toBe(200);

  await putEntity(request, owner.cookie, "resources", IDS.person, {
    ...scoped,
    kind: "person",
    name: "Barbara Gordon",
    role: "Designer",
    employmentType: "permanent",
    engagement: "studio",
    workingHoursPerDay: 8,
    workingDays: [1, 2, 3, 4, 5],
    halfDays: [],
    color: "#3b82f6",
  });
  await putEntity(request, owner.cookie, "resources", IDS.external, {
    ...scoped,
    kind: "external",
    name: "Kord Industries",
    role: "Partner studio",
    employmentType: "permanent",
    engagement: "studio",
    workingHoursPerDay: 0,
    workingDays: [1, 2, 3, 4, 5],
    halfDays: [],
    color: "#64748b",
  });

  const invitation = await request.post(`${AUTH_API}/api/invites`, {
    headers: { cookie: owner.cookie },
    data: { accountId, role: "editor" },
  });
  expect(invitation.status()).toBe(201);
  const invitationToken = ((await invitation.json()) as { token: string }).token;
  const accepted = await request.post(`${AUTH_API}/api/invites/${invitationToken}/accept`, {
    headers: { cookie: editor.cookie },
  });
  expect(accepted.status()).toBe(200);

  await signInAsEditor(page);
  await page.getByRole("link", { name: "Time off" }).click();
  await expect(page.getByTestId("company-closures-empty")).toBeVisible();
  await page.getByRole("button", { name: "Add closure" }).click();
  const create = page.getByRole("dialog", { name: "Add closure" });
  await create.getByLabel("Name").fill("Long weekend");
  await create.getByLabel("Start").fill("2026-06-05");
  await create.getByLabel("End").fill("2026-06-08");
  await create.getByRole("button", { name: "Save" }).click();

  const closureRow = page.getByTestId("company-closure-row");
  await expect(closureRow).toContainText("Long weekend");
  await expect(closureRow).toContainText("Fri 5th Jun – Mon 8th Jun");

  let closureId = "";
  await expect
    .poll(async () => {
      const response = await request.get(`${AUTH_API}/api/state?accountId=${accountId}`, {
        headers: { cookie: editor.cookie },
      });
      const state = (await response.json()) as { closures: Array<{ id: string; name: string }> };
      closureId = state.closures.find((closure) => closure.name === "Long weekend")?.id ?? "";
      return closureId;
    })
    .not.toBe("");

  await page.getByRole("link", { name: "Schedule" }).click();
  await setZoom(page, 1);
  await goToSeedWeek(page);

  const band = page.getByTestId("scheduler-closure-band");
  await expect(band).toHaveCount(1);
  await expect(band).toContainText("Long weekend");
  await expect(band).toHaveAttribute("data-start-date", "2026-06-05");
  await expect(band).toHaveAttribute("data-end-date", "2026-06-08");

  const literalSpanWidth = await page.getByTestId("scheduler-day-tier").evaluate((tier) =>
    ["2026-06-05", "2026-06-06", "2026-06-07", "2026-06-08"].reduce((width, date) => {
      const day = tier.querySelector<HTMLElement>(`[data-date="${date}"]`);
      return width + (day?.offsetWidth ?? 0);
    }, 0),
  );
  expect(await band.evaluate((element) => Number.parseFloat((element as HTMLElement).style.width))).toBe(
    literalSpanWidth,
  );

  const externalRow = page.getByTestId("scheduler-row").filter({ hasText: "Kord Industries" });
  await expect(externalRow).toBeVisible();
  const [bandBox, externalBox] = await Promise.all([band.boundingBox(), externalRow.boundingBox()]);
  if (!bandBox || !externalBox) throw new Error("closure band or external row was not laid out");
  expect(bandBox.y + bandBox.height).toBeLessThanOrEqual(externalBox.y);

  await page.getByRole("link", { name: "Time off" }).click();
  await page.getByRole("button", { name: /Edit Long weekend closure/ }).click();
  const edit = page.getByRole("dialog", { name: "Edit closure" });
  await edit.getByLabel("Name").fill("Studio shutdown");
  await edit.getByLabel("End").fill("2026-06-09");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("company-closure-row")).toContainText("Studio shutdown");

  await page.getByRole("link", { name: "Schedule" }).click();
  await setZoom(page, 1);
  await goToSeedWeek(page);
  await expect(page.getByTestId("scheduler-closure-band")).toContainText("Studio shutdown");
  await expect(page.getByTestId("scheduler-closure-band")).toHaveAttribute("data-end-date", "2026-06-09");

  await page.getByRole("link", { name: "Time off" }).click();
  await page.getByRole("button", { name: /Delete Studio shutdown closure/ }).click();
  await page.getByRole("alertdialog", { name: "Delete closure?" }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByTestId("company-closure-row")).toHaveCount(0);
  await expect
    .poll(async () => {
      const response = await request.get(`${AUTH_API}/api/state?accountId=${accountId}`, {
        headers: { cookie: editor.cookie },
      });
      const state = (await response.json()) as { closures: Array<{ id: string }> };
      return state.closures.some((closure) => closure.id === closureId);
    })
    .toBe(false);

  await page.getByRole("link", { name: "Schedule" }).click();
  await setZoom(page, 1);
  await goToSeedWeek(page);
  await expect(page.getByTestId("scheduler-closure-band")).toHaveCount(0);
});
