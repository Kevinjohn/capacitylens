import { expect, test } from "./fixtures";
import {
  AUTH_API,
  assertAuthE2EFixturePath,
  bootstrapOrg,
  clearAuthE2ECompanies,
  readAuthE2EBaselineSnapshot,
  signUpUser,
} from "./authTestSupport";

test("native company fixtures preserve baseline data and unrelated principals across cleanup cycles", async ({
  request,
}) => {
  expect(() => assertAuthE2EFixturePath("/tmp/capacitylens-other.db")).toThrow(
    "Auth E2E fixtures may only access apps/backend/.auth-e2e.db.",
  );

  const baseline = readAuthE2EBaselineSnapshot();
  expect(baseline.account).toMatchObject({
    name: "Daily Planet E2E Baseline",
    scheduling_mode: "days",
    inline_activity_create_enabled: "false",
  });
  expect(baseline.client).toMatchObject({
    id: `internal:${baseline.account.id}`,
    name: "Internal",
    builtin: "true",
  });
  expect(baseline.revision).toBe(1);
  expect(baseline.owner).toMatchObject({
    email: "baseline-owner@capacitylens.dev",
    role: "owner",
    status: "active",
  });
  expect(baseline.administrator).toMatchObject({ email: "admin@admin.admin", memberships: 0 });

  const suffix = crypto.randomUUID();
  const first = await signUpUser(`bruce-wayne-fixture-${suffix}@capacitylens.dev`, "Bruce Wayne");
  const firstId = await bootstrapOrg(request, first.cookie, `Wayne Enterprises ${suffix}`);
  const firstRead = await request.get(`${AUTH_API}/api/state?accountId=${firstId}`, {
    headers: { cookie: first.cookie },
  });
  expect(firstRead.status()).toBe(200);
  const firstState = await firstRead.json();
  expect(firstState.clients).toEqual([
    expect.objectContaining({ id: `internal:${firstId}`, accountId: firstId, name: "Internal", builtin: true }),
  ]);
  expect(firstState.accounts).toEqual([expect.objectContaining({ id: firstId, schedulingMode: "days" })]);

  const second = await signUpUser(`tony-stark-fixture-${suffix}@capacitylens.dev`, "Tony Stark");
  const secondId = await bootstrapOrg(request, second.cookie, `Stark Industries ${suffix}`);
  expect(secondId).not.toBe(firstId);
  const firstAfter = await request.get(`${AUTH_API}/api/state?accountId=${firstId}`, {
    headers: { cookie: first.cookie },
  });
  expect(firstAfter.status()).toBe(200);
  expect(await firstAfter.json()).toEqual(firstState);
  const secondState = await request.get(`${AUTH_API}/api/state?accountId=${secondId}`, {
    headers: { cookie: second.cookie },
  });
  expect(secondState.status()).toBe(200);
  expect((await secondState.json()).accounts).toEqual([expect.objectContaining({ id: secondId })]);
  const foreignRead = await request.get(`${AUTH_API}/api/state?accountId=${secondId}`, {
    headers: { cookie: first.cookie },
  });
  expect(foreignRead.status()).toBe(403);

  for (let cycle = 0; cycle < 2; cycle += 1) {
    const baselineBeforeCycle = cycle === 0 ? undefined : readAuthE2EBaselineSnapshot();
    const user = await signUpUser(`cleanup-cycle-${cycle}-${suffix}@capacitylens.dev`, "Diana Prince");
    const companies = await request.get(`${AUTH_API}/api/accounts`, { headers: { cookie: user.cookie } });
    if (cycle === 0) {
      expect(companies.status()).toBe(409);
      expect(await companies.json()).toMatchObject({
        error: "This installation has more than one company. Contact the administrator to resolve it.",
      });
    } else {
      expect(companies.status()).toBe(200);
      expect(await companies.json()).toEqual([]);
    }
    const inaccessibleAccountId = baselineBeforeCycle?.account.id ?? firstId;
    const hiddenBaseline = await request.get(`${AUTH_API}/api/state?accountId=${inaccessibleAccountId}`, {
      headers: { cookie: user.cookie },
    });
    expect(hiddenBaseline.status()).toBe(403);

    const temporaryAccountId = await bootstrapOrg(request, user.cookie, `Cleanup Company ${cycle} ${suffix}`);
    const temporaryState = await request.get(`${AUTH_API}/api/state?accountId=${temporaryAccountId}`, {
      headers: { cookie: user.cookie },
    });
    expect(temporaryState.status()).toBe(200);
    clearAuthE2ECompanies();

    const restoredBaseline = readAuthE2EBaselineSnapshot();
    expect(restoredBaseline.account.id).not.toBe(baselineBeforeCycle?.account.id ?? baseline.account.id);
    expect(restoredBaseline.account).toMatchObject({
      name: "Daily Planet E2E Baseline",
      scheduling_mode: "days",
      week_starts_on: 1,
      working_days: "[1,2,3,4,5]",
      disciplines_enabled: "false",
      placeholders_enabled: "false",
      external_enabled: "false",
      inline_activity_create_enabled: "false",
    });
    expect(restoredBaseline.client).toMatchObject({
      id: `internal:${restoredBaseline.account.id}`,
      name: "Internal",
      builtin: "true",
    });
    expect(restoredBaseline.revision).toBe(1);
    expect(restoredBaseline.owner).toMatchObject({
      email: "baseline-owner@capacitylens.dev",
      role: "owner",
      status: "active",
    });
    expect(restoredBaseline.administrator).toMatchObject({ email: "admin@admin.admin", memberships: 0 });
    expect(restoredBaseline.initializationHistory).toBe(1);
    expect((await request.get(`${AUTH_API}/api/auth/me`, { headers: { cookie: user.cookie } })).status()).toBe(200);
    const hiddenRestoredBaseline = await request.get(`${AUTH_API}/api/state?accountId=${restoredBaseline.account.id}`, {
      headers: { cookie: user.cookie },
    });
    expect(hiddenRestoredBaseline.status()).toBe(403);
    expect(await (await request.get(`${AUTH_API}/api/accounts`, { headers: { cookie: user.cookie } })).json()).toEqual(
      [],
    );
  }

  for (const user of [first, second]) {
    expect((await request.get(`${AUTH_API}/api/auth/me`, { headers: { cookie: user.cookie } })).status()).toBe(200);
    expect(await (await request.get(`${AUTH_API}/api/accounts`, { headers: { cookie: user.cookie } })).json()).toEqual(
      [],
    );
  }
});
