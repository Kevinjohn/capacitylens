import { test, expect } from "./fixtures";
import type { APIRequestContext, Page } from "./fixtures";
import {
  AUTH_API,
  AUTH_PASSWORD,
  bootstrapOrg,
  createFixturePerson,
  seedFixtureMember,
  sendPlanningFixtureCommand,
  signUpUser,
} from "./authTestSupport";
import { externalCapacityDefaults } from "@capacitylens/shared/types/entities";
import {
  computedStyles,
  disableCssMotion,
  waitForAppLanding,
  freezeBrowserDate,
  goToSeedWeek,
  setZoom,
  showScheduleFilters,
} from "./browserTestSupport";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const STAMP = `${Date.now()}`;
const ORG = `Gotham Closures ${STAMP}`;
const OWNER = `closure-owner-${STAMP}@capacitylens.dev`;
const EDITOR = `closure-editor-${STAMP}@capacitylens.dev`;
const IDS = {
  person: crypto.randomUUID(),
  external: crypto.randomUUID(),
};

async function signInAsEditor(page: Page) {
  await freezeBrowserDate(page);
  await page.goto("/");
  await page.getByRole("heading", { name: "Sign in" }).waitFor();
  await page.getByLabel("Email").fill(EDITOR);
  await page.getByLabel("Password").fill(AUTH_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Choose a company" })).toHaveCount(0);
  await waitForAppLanding(page, page.getByRole("heading", { name: "Schedule" }));
}

async function seedClosureAccount(request: APIRequestContext) {
  const owner = await signUpUser(OWNER);
  const editor = await signUpUser(EDITOR);
  const accountId = await bootstrapOrg(request, owner.cookie, ORG);
  await sendPlanningFixtureCommand(
    request,
    owner.cookie,
    accountId,
    "settings",
    {
      operation: "settings.update",
      changes: { externalEnabled: true },
    },
    "patch",
  );

  await createFixturePerson(request, owner.cookie, accountId, {
    id: IDS.person,
    name: "Barbara Gordon",
    role: "Designer",
  });
  await sendPlanningFixtureCommand(request, owner.cookie, accountId, "resources", {
    operation: "resource.create",
    id: IDS.external,
    fields: {
      kind: "external",
      name: "Kord Industries",
      role: "Partner studio",
      avatarUrl: null,
      disciplineId: null,
      ...externalCapacityDefaults(),
      projectId: null,
      color: "#9ca3af",
      isFavourite: null,
      firstAvailableDate: null,
      lastAvailableDate: null,
    },
  });

  seedFixtureMember(accountId, editor.email, "editor");
  return { accountId, editorCookie: editor.cookie };
}

async function createClosure(page: Page, request: APIRequestContext, accountId: string, editorCookie: string) {
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
  await expect(closureRow).toContainText("Fri 5th – Mon 8th Jun");

  let closureId = "";
  await expect
    .poll(async () => {
      const response = await request.get(`${AUTH_API}/api/state?accountId=${accountId}`, {
        headers: { cookie: editorCookie },
      });
      const state = (await response.json()) as { closures: Array<{ id: string; name: string }> };
      closureId = state.closures.find((closure) => closure.name === "Long weekend")?.id ?? "";
      return closureId;
    })
    .not.toBe("");
  return closureId;
}

async function assertClosureBand(page: Page) {
  await page.getByRole("link", { name: "Schedule" }).click();
  await setZoom(page, 1);
  await goToSeedWeek(page);
  const band = page.getByTestId("scheduler-closure-band");
  await expect(band).toHaveCount(1);
  // The closure name lives on its own sibling layer, not inside the band: `z-0` on the band makes
  // a stacking context, so a nested label could never clear the group-header rows.
  await expect(page.getByTestId("scheduler-closure-label-layer")).toContainText("Long weekend");
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

  // Company closures must receive the personal-time-off selected treatment in Time off draw mode.
  await showScheduleFilters(page);
  await disableCssMotion(page);
  const workTreatment = await computedStyles(band, ["background-color", "box-shadow"]);
  await page.getByRole("radio", { name: "Time off", exact: true }).click();
  await expect(page.getByTestId("scheduler-grid")).toHaveAttribute("data-draw-mode", "timeoff");
  const timeoffTreatment = await computedStyles(band, ["background-color", "background-image", "box-shadow", "color"]);
  expect(timeoffTreatment["background-color"]).toBe("rgb(250, 204, 21)");
  expect(timeoffTreatment["background-color"]).not.toBe(workTreatment["background-color"]);
  expect(timeoffTreatment["background-image"]).toContain("repeating-linear-gradient");
  expect(timeoffTreatment["box-shadow"]).toContain("6px 1px");

  await page.getByRole("radio", { name: "Work", exact: true }).click();
  await expect(page.getByTestId("scheduler-grid")).toHaveAttribute("data-draw-mode", "work");
  const revertedTreatment = await computedStyles(band, ["background-color", "box-shadow"]);
  expect(revertedTreatment).toEqual(workTreatment);

  const externalRow = page.getByTestId("scheduler-row").filter({ hasText: "Kord Industries" });
  await expect(externalRow).toBeVisible();
  const [bandBox, externalBox] = await Promise.all([band.boundingBox(), externalRow.boundingBox()]);
  if (!bandBox || !externalBox) throw new Error("closure band or external row was not laid out");
  expect(bandBox.y + bandBox.height).toBeLessThanOrEqual(externalBox.y);
}

async function editClosure(page: Page) {
  await page.getByRole("link", { name: "Time off" }).click();
  await page.getByRole("button", { name: /Edit Long weekend closure/ }).click();
  const edit = page.getByRole("dialog", { name: "Edit closure" });
  await edit.getByLabel("Name").fill("Studio shutdown");
  await edit.getByLabel("End").fill("2026-06-09");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("company-closure-row")).toContainText("Studio shutdown");
}

async function assertEditedAndDeletedClosure(
  page: Page,
  request: APIRequestContext,
  accountId: string,
  editorCookie: string,
  closureId: string,
) {
  await page.getByRole("link", { name: "Schedule" }).click();
  await setZoom(page, 1);
  await goToSeedWeek(page);
  await expect(page.getByTestId("scheduler-closure-label-layer")).toContainText("Studio shutdown");
  await expect(page.getByTestId("scheduler-closure-band")).toHaveAttribute("data-end-date", "2026-06-09");

  await page.getByRole("link", { name: "Time off" }).click();
  await page.getByRole("button", { name: /Delete Studio shutdown closure/ }).click();
  await page.getByRole("alertdialog", { name: "Delete closure?" }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByTestId("company-closure-row")).toHaveCount(0);
  await expect
    .poll(async () => {
      const response = await request.get(`${AUTH_API}/api/state?accountId=${accountId}`, {
        headers: { cookie: editorCookie },
      });
      const state = (await response.json()) as { closures: Array<{ id: string }> };
      return state.closures.some((closure) => closure.id === closureId);
    })
    .toBe(false);

  await page.getByRole("link", { name: "Schedule" }).click();
  await setZoom(page, 1);
  await goToSeedWeek(page);
  await expect(page.getByTestId("scheduler-closure-band")).toHaveCount(0);

  await page.getByTestId("undo-button").click();
  await expect(page.getByTestId("scheduler-closure-band")).toHaveCount(1);
  await expect
    .poll(async () => {
      const response = await request.get(`${AUTH_API}/api/state?accountId=${accountId}`, {
        headers: { cookie: editorCookie },
      });
      const state = (await response.json()) as { closures: Array<{ id: string; name: string }> };
      return state.closures.find((closure) => closure.id === closureId)?.name;
    })
    .toBe("Studio shutdown");
}

test("an editor creates, edits, deletes and restores a literal company closure band", async ({ page, request }) => {
  const { accountId, editorCookie } = await seedClosureAccount(request);

  await signInAsEditor(page);
  const closureId = await createClosure(page, request, accountId, editorCookie);
  await assertClosureBand(page);
  await editClosure(page);
  await assertEditedAndDeletedClosure(page, request, accountId, editorCookie, closureId);
});
