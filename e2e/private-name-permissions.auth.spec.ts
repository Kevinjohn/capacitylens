import { expect, test } from "./fixtures";
import { AUTH_API, AUTH_PASSWORD, BOOTSTRAP_TOKEN, signUpUser } from "./auth-helpers";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const STAMP = Date.now();
const OWNER = `lucius-fox-${STAMP}@capacitylens.dev`;
const ADMIN = `barbara-gordon-${STAMP}@capacitylens.dev`;
const EDITOR = `dick-grayson-${STAMP}@capacitylens.dev`;
const VIEWER = `tim-drake-${STAMP}@capacitylens.dev`;
const ACCOUNT = `Wayne Privacy Studio ${STAMP}`;
const REAL_CLIENT = "Kane Industries Acquisition";
const REAL_PROJECT = "Gotham Renewal";

async function signInAndOpen(page: import("@playwright/test").Page, email: string) {
  await page.goto("/");
  await page.getByRole("heading", { name: "Sign in" }).waitFor();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(AUTH_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: ACCOUNT, exact: true }).click();
  const intro = page.getByTestId("intro-continue");
  await expect(intro.or(page.getByRole("heading", { name: "Schedule" })).first()).toBeVisible();
  if (await intro.isVisible().catch(() => false)) await intro.click();
  await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();
}

test("non-owners see protected code names without owner controls or real-name leaks", async ({
  page,
  request,
  context,
}) => {
  const owner = await signUpUser(OWNER);
  const members = [
    { role: "admin", user: await signUpUser(ADMIN) },
    { role: "editor", user: await signUpUser(EDITOR) },
    { role: "viewer", user: await signUpUser(VIEWER) },
  ] as const;

  const accountResponse = await request.post(`${AUTH_API}/api/orgs`, {
    headers: { cookie: owner.cookie, "x-capacitylens-bootstrap-token": BOOTSTRAP_TOKEN },
    data: { name: ACCOUNT },
  });
  expect(accountResponse.status()).toBe(201);
  const accountId = (await accountResponse.json()).id as string;

  for (const { role, user } of members) {
    const invitation = await request.post(`${AUTH_API}/api/invites`, {
      headers: { cookie: owner.cookie },
      data: { accountId, role },
    });
    expect(invitation.status()).toBe(201);
    const token = (await invitation.json()).token as string;
    const accepted = await request.post(`${AUTH_API}/api/invites/${token}/accept`, {
      headers: { cookie: user.cookie },
    });
    expect(accepted.status()).toBe(200);
  }

  const now = new Date().toISOString();
  const clientId = `privacy-client-${STAMP}`;
  const projectId = `privacy-project-${STAMP}`;
  const clientWrite = await request.put(`${AUTH_API}/api/clients/${clientId}`, {
    headers: { cookie: owner.cookie, "content-type": "application/json" },
    data: {
      id: clientId,
      accountId,
      name: REAL_CLIENT,
      color: "#3b82f6",
      isPrivate: true,
      codeName: "Nightwing",
      createdAt: now,
      updatedAt: now,
    },
  });
  expect(clientWrite.status()).toBe(200);
  const projectWrite = await request.put(`${AUTH_API}/api/projects/${projectId}`, {
    headers: { cookie: owner.cookie, "content-type": "application/json" },
    data: {
      id: projectId,
      accountId,
      clientId,
      name: REAL_PROJECT,
      color: "#ec4899",
      isPrivate: true,
      codeName: "Aurora",
      createdAt: now,
      updatedAt: now,
    },
  });
  expect(projectWrite.status()).toBe(200);

  for (const { role, user } of members) {
    await context.clearCookies();
    await signInAndOpen(page, user.email);

    await page.getByRole("link", { name: "Clients", exact: true }).click();
    const clientRow = page.getByTestId("client-row").filter({ hasText: '"Nightwing"' });
    await expect(clientRow).toBeVisible();
    await expect(page.getByText(REAL_CLIENT, { exact: true })).toHaveCount(0);

    if (role === "viewer") {
      await expect(clientRow.getByRole("button", { name: /^Edit / })).toHaveCount(0);
    } else {
      await clientRow.getByRole("button", { name: /^Edit / }).click();
      const dialog = page.getByRole("dialog", { name: "Edit client" });
      await expect(dialog.getByLabel("Name", { exact: true })).toBeDisabled();
      await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue('"Nightwing"');
      await expect(dialog.getByRole("switch", { name: "Use a code name" })).toHaveCount(0);
      await expect(dialog.getByLabel("Code name", { exact: true })).toHaveCount(0);
      await expect(dialog.getByText("Only an account owner can change this private name.")).toBeVisible();
      await expect(dialog.getByText(REAL_CLIENT, { exact: true })).toHaveCount(0);
      await dialog.getByRole("button", { name: "Cancel" }).click();
    }

    await page.getByRole("link", { name: "Projects", exact: true }).click();
    const projectRow = page.getByTestId("project-row").filter({ hasText: '"Aurora"' });
    await expect(projectRow).toBeVisible();
    await expect(page.getByText(REAL_PROJECT, { exact: true })).toHaveCount(0);

    if (role === "viewer") {
      await expect(projectRow.getByRole("button", { name: /^Edit / })).toHaveCount(0);
    } else {
      await projectRow.getByRole("button", { name: /^Edit / }).click();
      const dialog = page.getByRole("dialog", { name: "Edit project" });
      await expect(dialog.getByLabel("Name", { exact: true })).toBeDisabled();
      await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue('"Aurora"');
      await expect(dialog.getByRole("switch", { name: "Use a code name" })).toHaveCount(0);
      await expect(dialog.getByLabel("Code name", { exact: true })).toHaveCount(0);
      await expect(dialog.getByText("Only an account owner can change this private name.")).toBeVisible();
      await expect(dialog.getByText(REAL_PROJECT, { exact: true })).toHaveCount(0);
      await dialog.getByRole("button", { name: "Cancel" }).click();
    }
  }
});
