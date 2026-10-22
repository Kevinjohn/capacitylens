import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";
import {
  AUTH_API,
  AUTH_PASSWORD,
  bootstrapOrg,
  createFixturePerson,
  seedFixtureMember,
  sendPlanningFixtureCommand,
  signUpUser,
} from "./authTestSupport";
import { selectShadOption, waitForAppLanding } from "./browserTestSupport";

test.use({ contextOptions: { reducedMotion: "reduce" } });

function recordPlanningWrites(page: Page) {
  const writes: Array<{ method: string; path: string }> = [];
  page.on("request", (request) => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method())) return;
    const path = new URL(request.url()).pathname;
    if (path === "/api/batch" || path.startsWith("/api/accounts/")) {
      writes.push({ method: request.method(), path });
    }
  });
  return writes;
}

test("authenticated client creation and settings Undo/Redo persist as typed writes", async ({ page, request }) => {
  const suffix = Date.now();
  const email = `bruce-wayne-writers-${suffix}@capacitylens.dev`;
  const owner = await signUpUser(email);
  const accountId = await bootstrapOrg(request, owner.cookie, `Wayne Writers Studio ${suffix}`);

  await page.goto("/");
  await page.getByRole("heading", { name: "Sign in" }).waitFor();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(AUTH_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await waitForAppLanding(page, page.getByRole("heading", { name: "Schedule" }));
  const writes = recordPlanningWrites(page);

  await page.getByRole("link", { name: "Clients" }).click();
  await page.getByRole("button", { name: "Add client" }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Wayne Foundation");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("client-row").filter({ hasText: "Wayne Foundation" })).toBeVisible();

  const state = async () => {
    const response = await request.get(`${AUTH_API}/api/state?accountId=${accountId}`, {
      headers: { cookie: owner.cookie },
    });
    expect(response.status()).toBe(200);
    return (await response.json()) as {
      clients: Array<{ name: string }>;
      accounts: Array<{ id: string; dateStyle: string | null }>;
    };
  };
  await expect.poll(async () => (await state()).clients.some((row) => row.name === "Wayne Foundation")).toBe(true);

  await page.getByRole("link", { name: "Settings" }).click();
  const dayMonth = page.getByRole("radio", { name: "9 Sep", exact: true });
  const monthDay = page.getByRole("radio", { name: "Sep 9", exact: true });
  await expect(dayMonth).toHaveAttribute("aria-checked", "true");
  await monthDay.click();
  await expect(monthDay).toHaveAttribute("aria-checked", "true");
  await expect
    .poll(async () => (await state()).accounts.find((row) => row.id === accountId)?.dateStyle)
    .toBe("month-day");

  await page.getByRole("link", { name: "Schedule" }).click();
  await page.getByTestId("undo-button").click();
  await expect.poll(async () => (await state()).accounts.find((row) => row.id === accountId)?.dateStyle).toBeNull();
  await page.getByTestId("redo-button").click();
  await expect
    .poll(async () => (await state()).accounts.find((row) => row.id === accountId)?.dateStyle)
    .toBe("month-day");
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(monthDay).toHaveAttribute("aria-checked", "true");
  expect((await state()).clients.some((row) => row.name === "Wayne Foundation")).toBe(true);
  expect(writes).toContainEqual({ method: "POST", path: `/api/accounts/${accountId}/clients` });
  expect(writes).toContainEqual({ method: "PATCH", path: `/api/accounts/${accountId}/settings` });
  expect(writes.some((write) => write.path === "/api/batch")).toBe(false);
});

test("authenticated discipline and time-off deletion restore the same rows", async ({ page, request }) => {
  const suffix = Date.now();
  const email = `diana-prince-writers-${suffix}@capacitylens.dev`;
  const owner = await signUpUser(email);
  const accountId = await bootstrapOrg(request, owner.cookie, `Wayne Planning Studio ${suffix}`);
  await sendPlanningFixtureCommand(
    request,
    owner.cookie,
    accountId,
    "settings",
    { operation: "settings.update", changes: { disciplinesEnabled: true } },
    "patch",
  );
  const resourceId = crypto.randomUUID();
  await createFixturePerson(request, owner.cookie, accountId, {
    id: resourceId,
    name: "Diana Prince",
    role: "Designer",
  });
  await page.goto("/");
  await page.getByRole("heading", { name: "Sign in" }).waitFor();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(AUTH_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await waitForAppLanding(page, page.getByRole("heading", { name: "Schedule" }));
  const writes = recordPlanningWrites(page);

  const state = async () => {
    const response = await request.get(`${AUTH_API}/api/state?accountId=${accountId}`, {
      headers: { cookie: owner.cookie },
    });
    expect(response.status()).toBe(200);
    return (await response.json()) as {
      disciplines: Array<{ id: string; name: string }>;
      timeOff: Array<{ id: string; note: string }>;
    };
  };

  await page.getByRole("link", { name: "Disciplines" }).click();
  await page.getByRole("button", { name: "Add discipline" }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Strategy");
  await page.getByRole("button", { name: "Save" }).click();
  const discipline = page.getByTestId("discipline-row").filter({ hasText: "Strategy" });
  await expect(discipline).toBeVisible();
  let disciplineId = "";
  await expect
    .poll(async () => {
      disciplineId = (await state()).disciplines.find((row) => row.name === "Strategy")?.id ?? "";
      return disciplineId;
    })
    .not.toBe("");
  await discipline.getByRole("button", { name: /^Edit / }).click();
  const disciplineEditor = page.getByRole("dialog", { name: "Edit discipline" });
  await disciplineEditor.getByRole("textbox", { name: "Name", exact: true }).fill("Strategy Operations");
  await disciplineEditor.getByRole("button", { name: "Save" }).click();
  const updatedDiscipline = page.getByTestId("discipline-row").filter({ hasText: "Strategy Operations" });
  await expect(updatedDiscipline).toBeVisible();
  await expect
    .poll(async () => (await state()).disciplines.find((row) => row.id === disciplineId)?.name)
    .toBe("Strategy Operations");
  await updatedDiscipline.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("alertdialog", { name: "Delete discipline?" }).getByRole("button", { name: "Delete" }).click();
  await expect(updatedDiscipline).toHaveCount(0);
  await page.getByRole("link", { name: "Schedule" }).click();
  await page.getByTestId("undo-button").click();
  await expect.poll(async () => (await state()).disciplines.some((row) => row.id === disciplineId)).toBe(true);

  await page.getByRole("link", { name: "Time off" }).click();
  await page.getByRole("button", { name: "Add time off" }).click();
  const create = page.getByRole("dialog", { name: "Add time off" });
  await selectShadOption(create.getByLabel("Resource"), { label: "Diana Prince" });
  await create.getByLabel("Start").fill("2026-11-02");
  await create.getByLabel("End").fill("2026-11-03");
  await create.getByRole("textbox", { name: "Note" }).fill("Watchtower visit");
  await create.getByRole("button", { name: "Save" }).click();
  const row = page.getByTestId("timeoff-group").filter({ hasText: "Diana Prince" }).getByTestId("timeoff-row");
  await expect(row).toBeVisible();
  let timeOffId = "";
  await expect
    .poll(async () => {
      timeOffId = (await state()).timeOff.find((entry) => entry.note === "Watchtower visit")?.id ?? "";
      return timeOffId;
    })
    .not.toBe("");
  await row.getByRole("button", { name: /^Edit / }).click();
  const timeOffEditor = page.getByRole("dialog", { name: "Edit time off" });
  await timeOffEditor.getByRole("textbox", { name: "Note" }).fill("Watchtower briefing");
  await timeOffEditor.getByRole("button", { name: "Save" }).click();
  await expect
    .poll(async () => (await state()).timeOff.find((entry) => entry.id === timeOffId)?.note)
    .toBe("Watchtower briefing");
  await row.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("alertdialog", { name: "Delete time off?" }).getByRole("button", { name: "Delete" }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole("link", { name: "Schedule" }).click();
  await page.getByTestId("undo-button").click();
  await expect
    .poll(async () => (await state()).timeOff.find((entry) => entry.id === timeOffId)?.note)
    .toBe("Watchtower briefing");
  expect(writes).toContainEqual({ method: "POST", path: `/api/accounts/${accountId}/disciplines` });
  expect(writes).toContainEqual({ method: "PATCH", path: `/api/accounts/${accountId}/disciplines/${disciplineId}` });
  expect(writes).toContainEqual({ method: "POST", path: `/api/accounts/${accountId}/time-off` });
  expect(writes).toContainEqual({ method: "PATCH", path: `/api/accounts/${accountId}/time-off/${timeOffId}` });
  expect(writes.some((write) => write.path === "/api/batch")).toBe(false);
});

for (const repeat of [false, true]) {
  test(`an Editor creates ${repeat ? "repeated" : "single"} time off without a restricted note`, async ({
    page,
    request,
  }) => {
    const suffix = `${Date.now()}-${repeat ? "repeat" : "single"}`;
    const owner = await signUpUser(`timeoff-owner-${suffix}@capacitylens.dev`);
    const editor = await signUpUser(`timeoff-editor-${suffix}@capacitylens.dev`);
    const accountId = await bootstrapOrg(request, owner.cookie, `Wayne Time Off ${suffix}`);
    const resourceId = crypto.randomUUID();
    await createFixturePerson(request, owner.cookie, accountId, {
      id: resourceId,
      name: "Barbara Gordon",
      role: "Designer",
    });
    seedFixtureMember(accountId, editor.email, "editor");

    await page.goto("/");
    await page.getByRole("heading", { name: "Sign in" }).waitFor();
    await page.getByLabel("Email").fill(editor.email);
    await page.getByLabel("Password").fill(AUTH_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await waitForAppLanding(page, page.getByRole("heading", { name: "Schedule" }));
    const writes = recordPlanningWrites(page);
    await page.getByRole("link", { name: "Time off" }).click();
    await page.getByRole("button", { name: "Add time off" }).click();
    const dialog = page.getByRole("dialog", { name: "Add time off" });
    await expect(dialog.getByLabel("Note")).toHaveCount(0);
    await selectShadOption(dialog.getByLabel("Resource"), { label: "Barbara Gordon" });
    await dialog.getByLabel("Start").fill("2026-11-02");
    await dialog.getByLabel("End").fill("2026-11-03");
    if (repeat) {
      await selectShadOption(dialog.getByTestId("timeoff-repeat"), { label: "Weekly" });
      await dialog.getByTestId("timeoff-repeat-until").fill("2026-11-09");
      await expect(dialog.getByTestId("timeoff-repeat-preview")).toContainText("Creates 2 entries");
    }
    const path = `/api/accounts/${accountId}/time-off${repeat ? "/repeat" : ""}`;
    const responsePromise = page.waitForResponse(
      (response) => response.url().endsWith(path) && response.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "Save" }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    const row = page.getByTestId("timeoff-group").filter({ hasText: "Barbara Gordon" }).getByTestId("timeoff-row");
    await expect(row).toHaveCount(repeat ? 2 : 1);
    const stored = await request.get(`${AUTH_API}/api/state?accountId=${accountId}`, {
      headers: { cookie: owner.cookie },
    });
    expect(stored.status()).toBe(200);
    const state = (await stored.json()) as { timeOff: Array<{ resourceId: string; note: string | null }> };
    expect(state.timeOff.filter((entry) => entry.resourceId === resourceId)).toHaveLength(repeat ? 2 : 1);
    expect(state.timeOff.filter((entry) => entry.resourceId === resourceId).every((entry) => entry.note === null)).toBe(
      true,
    );
    expect(writes).toContainEqual({ method: "POST", path });
    expect(writes.some((write) => write.path === "/api/batch")).toBe(false);
  });
}
