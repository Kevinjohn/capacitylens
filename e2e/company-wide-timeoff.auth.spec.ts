import { test, expect, type APIRequestContext, type Locator, type Page } from "./fixtures";
import { AUTH_API, AUTH_PASSWORD, bootstrapOrg, signUpUser } from "./auth-helpers";
import { dismissIntroIfPresent, freezeBrowserDate, resetSchedulerScroll, selectShadOption, setZoom } from "./helpers";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const STAMP = `${Date.now()}`;
const ORG = `Gotham Capacity ${STAMP}`;
const OWNER = `closure-owner-${STAMP}@capacitylens.dev`;
const EDITOR = `closure-editor-${STAMP}@capacitylens.dev`;
const IDS = {
  client: `wayne-${STAMP}`,
  project: `oracle-${STAMP}`,
  activity: `batcomputer-${STAMP}`,
  barbara: `barbara-${STAMP}`,
  dick: `dick-${STAMP}`,
  allocation: `allocation-${STAMP}`,
  personalTimeOff: `personal-timeoff-${STAMP}`,
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

async function reopenOrgAfterReload(page: Page) {
  await page.reload();
  const picker = page.getByRole("button", { name: ORG, exact: true });
  const schedule = page.getByRole("heading", { name: "Schedule" });
  await picker.or(schedule).first().waitFor();
  if (await picker.isVisible()) await picker.click();
  await dismissIntroIfPresent(page, schedule);
  await expect(schedule).toBeVisible();
}

test("an editor manages an Everyone closure through capacity, persistence and restoration", async ({
  page,
  request,
}) => {
  const owner = await signUpUser(OWNER);
  const editor = await signUpUser(EDITOR);
  const accountId = await bootstrapOrg(request, owner.cookie, ORG);
  const seededAt = new Date().toISOString();
  const scoped = { accountId, createdAt: seededAt, updatedAt: seededAt };

  await putEntity(request, owner.cookie, "clients", IDS.client, {
    ...scoped,
    name: "Wayne Enterprises",
    color: "#3b82f6",
  });
  await putEntity(request, owner.cookie, "projects", IDS.project, {
    ...scoped,
    clientId: IDS.client,
    name: "Oracle Renewal",
    color: "#3b82f6",
  });
  await putEntity(request, owner.cookie, "activities", IDS.activity, {
    ...scoped,
    name: "Batcomputer planning",
    kind: "project",
    projectId: IDS.project,
  });
  await Promise.all(
    (
      [
        [IDS.barbara, "Barbara Gordon"],
        [IDS.dick, "Dick Grayson"],
      ] as const
    ).map(([id, name]) =>
      putEntity(request, owner.cookie, "resources", id, {
        ...scoped,
        kind: "person",
        name,
        role: "Designer",
        employmentType: "permanent",
        engagement: "studio",
        workingHoursPerDay: 8,
        workingDays: [1, 2, 3, 4, 5],
        halfDays: [],
        color: "#3b82f6",
      }),
    ),
  );
  await putEntity(request, owner.cookie, "allocations", IDS.allocation, {
    ...scoped,
    resourceId: IDS.barbara,
    activityId: IDS.activity,
    startDate: "2026-06-01",
    endDate: "2026-06-05",
    hoursPerDay: 8,
    status: "confirmed",
  });
  // A later personal entry makes the list-order assertion meaningful without overlapping the closure.
  await putEntity(request, owner.cookie, "timeOff", IDS.personalTimeOff, {
    ...scoped,
    resourceId: IDS.dick,
    startDate: "2026-07-20",
    endDate: "2026-07-20",
    type: "other",
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
  await setZoom(page, 4);
  await resetSchedulerScroll(page);
  const barbaraRow = page.getByTestId("scheduler-row").filter({ hasText: "Barbara Gordon" });
  const barbaraLane = page.locator(`[data-resource-id="${IDS.barbara}"]`);
  const dickLane = page.locator(`[data-resource-id="${IDS.dick}"]`);
  const baselineUtilisation = await barbaraRow.getByTestId("utilization").innerText();
  await expect(barbaraLane.getByTestId("over-marker")).toHaveCount(0);

  await page.getByRole("link", { name: "Time off" }).click();
  await page.getByRole("button", { name: "Add time off" }).click();
  const create = page.getByRole("dialog", { name: "Add time off" });
  await selectShadOption(create.getByLabel("Resource"), { label: "Everyone" });
  await create.getByLabel("Type").click();
  const typeOptions = page.locator('[data-slot="select-content"][data-state="open"]').getByRole("option");
  await expect(typeOptions).toHaveText(["Holiday", "Other"]);
  await typeOptions.filter({ hasText: "Holiday" }).click();
  await create.getByLabel("Start").fill("2026-06-03");
  await create.getByLabel("End").fill("2026-06-03");
  await create.getByRole("button", { name: "Save" }).click();

  const groups = page.getByTestId("timeoff-group");
  await expect(groups.locator("h2")).toHaveText(["Everyone", "Dick Grayson"]);
  const everyoneGroup = groups.filter({ has: page.getByRole("heading", { name: "Everyone", exact: true }) });
  await expect(everyoneGroup.getByTestId("timeoff-row")).toContainText("Holiday");

  let companyTimeOffId = "";
  await expect
    .poll(async () => {
      const response = await request.get(`${AUTH_API}/api/state?accountId=${accountId}`, {
        headers: { cookie: editor.cookie },
      });
      const state = (await response.json()) as {
        timeOff: Array<{ id: string; resourceId?: string | null; startDate: string }>;
      };
      companyTimeOffId =
        state.timeOff.find((entry) => entry.resourceId === null && entry.startDate === "2026-06-03")?.id ?? "";
      return companyTimeOffId;
    })
    .not.toBe("");

  // setZoom after every return to the schedule is deliberately kept even though in-app navigation
  // preserves the store: the (no-op) interaction gives the freshly mounted grid time to settle
  // before resetSchedulerScroll, which otherwise races the scroll snap under suite load.
  await page.getByRole("link", { name: "Schedule" }).click();
  await setZoom(page, 4);
  await resetSchedulerScroll(page);
  const holidayBlock = (lane: Locator) => lane.getByTestId("timeoff-block").filter({ hasText: "Holiday" });
  await expect(holidayBlock(barbaraLane)).toHaveCount(1);
  await expect(holidayBlock(dickLane)).toHaveCount(1);
  await expect(barbaraLane.getByTestId("over-marker")).toHaveCount(1);
  await expect(barbaraRow).toContainText("Over capacity on 1 day.");
  await expect(barbaraRow.getByTestId("utilization")).not.toHaveText(baselineUtilisation);

  await reopenOrgAfterReload(page);
  await setZoom(page, 4);
  await resetSchedulerScroll(page);
  await expect(holidayBlock(barbaraLane)).toHaveCount(1);
  await expect(holidayBlock(dickLane)).toHaveCount(1);
  await expect(barbaraLane.getByTestId("over-marker")).toHaveCount(1);

  await page.getByRole("button", { name: "Add allocation for Dick Grayson" }).click();
  const allocation = page.getByRole("dialog", { name: "New allocation" });
  await selectShadOption(allocation.getByLabel("Project", { exact: true }), IDS.project);
  await selectShadOption(allocation.getByRole("combobox", { name: "Activity", exact: true }), IDS.activity);
  await allocation.getByLabel("Start Date").fill("2026-06-03");
  await allocation.getByLabel(/^End/).fill("2026-06-03");
  await allocation.getByRole("button", { name: "Save" }).click();
  await expect(allocation).toContainText(/cannot start.*time off/i);
  await allocation.getByRole("button", { name: "Cancel" }).click();
  await expect(dickLane.getByTestId("allocation-bar")).toHaveCount(0);

  await page.getByRole("link", { name: "Time off" }).click();
  await everyoneGroup.getByRole("button", { name: /^Edit / }).click();
  const edit = page.getByRole("dialog", { name: "Edit time off" });
  await selectShadOption(edit.getByLabel("Resource"), { label: "Barbara Gordon" });
  await edit.getByRole("button", { name: "Save" }).click();
  await expect
    .poll(async () => {
      const response = await request.get(`${AUTH_API}/api/state?accountId=${accountId}`, {
        headers: { cookie: editor.cookie },
      });
      const state = (await response.json()) as { timeOff: Array<{ id: string; resourceId?: string | null }> };
      return state.timeOff.find((entry) => entry.id === companyTimeOffId)?.resourceId;
    })
    .toBe(IDS.barbara);

  await page.getByRole("link", { name: "Schedule" }).click();
  await setZoom(page, 4);
  await resetSchedulerScroll(page);
  await expect(holidayBlock(barbaraLane)).toHaveCount(1);
  await expect(holidayBlock(dickLane)).toHaveCount(0);
  await expect(barbaraLane.getByTestId("over-marker")).toHaveCount(1);

  await page.getByRole("link", { name: "Time off" }).click();
  const barbaraGroup = page
    .getByTestId("timeoff-group")
    .filter({ has: page.getByRole("heading", { name: "Barbara Gordon", exact: true }) });
  await barbaraGroup.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("alertdialog", { name: "Delete time off?" }).getByRole("button", { name: "Delete" }).click();
  await expect
    .poll(async () => {
      const response = await request.get(`${AUTH_API}/api/state?accountId=${accountId}`, {
        headers: { cookie: editor.cookie },
      });
      const state = (await response.json()) as { timeOff: Array<{ id: string }> };
      return state.timeOff.some((entry) => entry.id === companyTimeOffId);
    })
    .toBe(false);

  await page.getByRole("link", { name: "Schedule" }).click();
  await setZoom(page, 4);
  await resetSchedulerScroll(page);
  await expect(holidayBlock(barbaraLane)).toHaveCount(0);
  await expect(barbaraLane.getByTestId("over-marker")).toHaveCount(0);
  await expect(barbaraRow.getByTestId("utilization")).toHaveText(baselineUtilisation);
});
