import { expect, test } from "./fixtures";
import { AUTH_API, assertAuthE2EFixturePath, bootstrapOrg, signUpUser } from "./authTestSupport";

test("native company fixtures preserve other principals and companies", async ({ request }) => {
  expect(() => assertAuthE2EFixturePath("/tmp/capacitylens-other.db")).toThrow(
    "Auth E2E fixtures may only access apps/backend/.auth-e2e.db.",
  );

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
});
