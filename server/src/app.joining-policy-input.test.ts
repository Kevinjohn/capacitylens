import { expect, it } from "vitest";
import { upsertMember } from "./controlTables";
import { readJoiningPolicy } from "./controlTables/joiningPolicies";
import { appWithAuth } from "./fixtures/appWithAuth";
import { seedTwo } from "./app.members.testSupport";
import { call, readCookies } from "./testHelpers/passwordAuth";
import { registerServerFixtureCleanup } from "./testHelpers/registerServerFixtureCleanup";

const fixtures = registerServerFixtureCleanup();

it("rejects unsupported joining policies without changing stored admission settings", async () => {
  const { app, db } = await appWithAuth({ fixtures });
  seedTwo(db);
  const signup = await call(app, {
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name: "Bruce Wayne", email: "bruce@wayne.example", password: "password-123456" },
  });
  expect(signup.statusCode).toBe(200);
  const cookie = readCookies(signup);
  const userId = signup.json<{ user: { id: string } }>().user.id;
  upsertMember(db, {
    accountId: "a1",
    userId,
    role: "owner",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  const url = "/api/accounts/a1/joining-policy";
  const accepted = await call(app, {
    method: "PUT",
    url,
    headers: { cookie },
    payload: { policy: "approved_domains", approvedDomains: ["wayne.example"] },
  });
  expect(accepted.statusCode).toBe(200);
  const before = readJoiningPolicy(db, "a1");
  expect(before).toEqual({ policy: "approved_domains", approvedDomains: ["wayne.example"] });

  for (const policy of ["unsupported", "", null, 1, ["open"], { policy: "open" }]) {
    const rejected = await call(app, {
      method: "PUT",
      url,
      headers: { cookie },
      payload: { policy, approvedDomains: [] },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toMatchObject({ error: "Choose a valid joining policy." });
    expect(readJoiningPolicy(db, "a1")).toEqual(before);
  }
});
