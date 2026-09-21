import { describe, it, expect } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  FIXTURE_ACCOUNT,
  FIXTURE_CLIENT,
  FIXTURE_DISCIPLINE,
  FIXTURE_PROJECT,
  FIXTURE_PHASE,
  FIXTURE_RESOURCE,
  FIXTURE_RESOURCE_PERSON,
  FIXTURE_RESOURCE_EXTERNAL,
  FIXTURE_ACTIVITY,
  FIXTURE_ACTIVITY_INTERNAL,
  FIXTURE_ACTIVITY_REPEATABLE,
  FIXTURE_ALLOCATION,
  FIXTURE_ALLOCATION_ATTRIBUTED,
  FIXTURE_TIMEOFF,
} from "@capacitylens/shared/data/fixtures";
import { withoutRevision, freshApp, person } from "./fixtures/appTestEntities";
import { post } from "./fixtures/appTestHttp";
import {
  readFirstDiscipline,
  readFirstPhase,
  readFirstActivity,
  readActivity,
  readAllocation,
  readFirstProject,
} from "./fixtures/appTestSnapshotSchedule";
import { readOnlyTimeOff, readFirstResource } from "./fixtures/appTestSnapshotAccount";
import { readFirstClient, readValidatedState } from "./fixtures/appTestSnapshotBatch";
import { readStateAccount } from "./fixtures/appTestScaffold";

async function seedFixtureDeps(app: FastifyInstance) {
  expect((await post(app, "accounts", FIXTURE_ACCOUNT)).statusCode).toBe(201);
  expect((await post(app, "clients", FIXTURE_CLIENT)).statusCode).toBe(201);
  expect((await post(app, "disciplines", FIXTURE_DISCIPLINE)).statusCode).toBe(201);
  expect((await post(app, "projects", FIXTURE_PROJECT)).statusCode).toBe(201);
  expect((await post(app, "phases", FIXTURE_PHASE)).statusCode).toBe(201);
}

// Generic writes (POST/PUT/PATCH/batch) STRIP lifecycle tombstones (the P2.1 write guard in
// sanitizeWrite): only the dedicated archive/delete routes may set archivedAt/deletedAt. So a fixture
// round-tripped through POST comes back MINUS its tombstones — those columns' persistence is covered
// by app.lifecycle.test.ts (archive/delete → includeInactive read). Stripping them here keeps this
// column-spec-gap check honest for every OTHER field on clients/projects/resources.
function stripTombstones<T extends { archivedAt?: string; deletedAt?: string }>(fixture: T): T {
  const copy = { ...fixture };
  delete copy.archivedAt;
  delete copy.deletedAt;
  return copy;
}

function expectFixture(actual: object, expected: object) {
  expect(withoutRevision(actual)).toEqual(withoutRevision(expected));
  const revision = actual as { createdAt?: unknown; updatedAt?: unknown };
  expect(Date.parse(String(revision.createdAt))).not.toBeNaN();
  expect(Date.parse(String(revision.updatedAt))).not.toBeNaN();
}

describe("full-fixture round-trip (every optional field set; catches column-spec gaps)", () => {
  it("account: every field round-trips (including optional schedulingMode)", async () => {
    const { app } = freshApp();
    expect((await post(app, "accounts", FIXTURE_ACCOUNT)).statusCode).toBe(201);
    expectFixture(await readStateAccount(app), FIXTURE_ACCOUNT);
  });

  it("client: every field round-trips (lifecycle archivedAt/deletedAt stripped by generic writes)", async () => {
    const { app } = freshApp();
    await post(app, "accounts", FIXTURE_ACCOUNT);
    expect((await post(app, "clients", FIXTURE_CLIENT)).statusCode).toBe(201);
    expectFixture(readFirstClient((await readValidatedState(app)).clients), stripTombstones(FIXTURE_CLIENT));
  });

  it("discipline: every field round-trips (including optional color)", async () => {
    const { app } = freshApp();
    await post(app, "accounts", FIXTURE_ACCOUNT);
    expect((await post(app, "disciplines", FIXTURE_DISCIPLINE)).statusCode).toBe(201);
    expectFixture(readFirstDiscipline((await readValidatedState(app)).disciplines), FIXTURE_DISCIPLINE);
  });
});

describe("full-fixture round-trip (every optional field set; catches column-spec gaps)", () => {
  it("project: every field round-trips (lifecycle archivedAt/deletedAt stripped by generic writes)", async () => {
    const { app } = freshApp();
    await post(app, "accounts", FIXTURE_ACCOUNT);
    await post(app, "clients", FIXTURE_CLIENT);
    expect((await post(app, "projects", FIXTURE_PROJECT)).statusCode).toBe(201);
    expectFixture(readFirstProject((await readValidatedState(app)).projects), stripTombstones(FIXTURE_PROJECT));
  });

  it("phase: every field round-trips", async () => {
    const { app } = freshApp();
    await post(app, "accounts", FIXTURE_ACCOUNT);
    await post(app, "clients", FIXTURE_CLIENT);
    await post(app, "projects", FIXTURE_PROJECT);
    expect((await post(app, "phases", FIXTURE_PHASE)).statusCode).toBe(201);
    expectFixture(readFirstPhase((await readValidatedState(app)).phases), FIXTURE_PHASE);
  });

  it("resource: every field round-trips (including optional name/disciplineId/projectId + json workingDays + lifecycle archivedAt/deletedAt)", async () => {
    const { app } = freshApp();
    await seedFixtureDeps(app);
    expect((await post(app, "resources", FIXTURE_RESOURCE)).statusCode).toBe(201);
    expectFixture(readFirstResource((await readValidatedState(app)).resources), stripTombstones(FIXTURE_RESOURCE));
  });

  it("person resource: Supplementary engagement round-trips independently of employment", async () => {
    const { app } = freshApp();
    await seedFixtureDeps(app);
    const supplementary = {
      ...person("supplementary-person", FIXTURE_ACCOUNT.id),
      name: "Fixture Supplementary Person",
      employmentType: "permanent" as const,
      engagement: "supplementary" as const,
    };

    expect((await post(app, "resources", supplementary)).statusCode).toBe(201);
    expect(readFirstResource((await readValidatedState(app)).resources)).toMatchObject({
      employmentType: "permanent",
      engagement: "supplementary",
    });
  });

  it("person resource: availability boundaries round-trip with all optional fields populated", async () => {
    const { app } = freshApp();
    await seedFixtureDeps(app);
    expect((await post(app, "resources", FIXTURE_RESOURCE_PERSON)).statusCode).toBe(201);
    expectFixture(
      readFirstResource((await readValidatedState(app)).resources),
      stripTombstones(FIXTURE_RESOURCE_PERSON),
    );
  });

  it("external resource: kind + company name round-trip (no discipline/project binding)", async () => {
    const { app } = freshApp();
    await seedFixtureDeps(app);
    expect((await post(app, "resources", FIXTURE_RESOURCE_EXTERNAL)).statusCode).toBe(201);
    expectFixture(readFirstResource((await readValidatedState(app)).resources), FIXTURE_RESOURCE_EXTERNAL);
  });
});

describe("full-fixture round-trip (every optional field set; catches column-spec gaps)", () => {
  it("activity: every field round-trips (including optional projectId/phaseId)", async () => {
    const { app } = freshApp();
    await seedFixtureDeps(app);
    expect((await post(app, "activities", FIXTURE_ACTIVITY)).statusCode).toBe(201);
    expectFixture(readFirstActivity((await readValidatedState(app)).activities), FIXTURE_ACTIVITY);
  });

  it("internal + repeatable activities round-trip with kind and no projectId/phaseId", async () => {
    const { app } = freshApp();
    await seedFixtureDeps(app);
    expect((await post(app, "activities", FIXTURE_ACTIVITY_INTERNAL)).statusCode).toBe(201);
    expect((await post(app, "activities", FIXTURE_ACTIVITY_REPEATABLE)).statusCode).toBe(201);
    const activities = (await readValidatedState(app)).activities;
    const internalActivity = readActivity(activities, FIXTURE_ACTIVITY_INTERNAL.id);
    const repeatableActivity = readActivity(activities, FIXTURE_ACTIVITY_REPEATABLE.id);
    expect(activities).toHaveLength(2);
    expect(internalActivity.id).toBe(FIXTURE_ACTIVITY_INTERNAL.id);
    expect(repeatableActivity.id).toBe(FIXTURE_ACTIVITY_REPEATABLE.id);
    expect(internalActivity).not.toBe(repeatableActivity);

    expectFixture(internalActivity, FIXTURE_ACTIVITY_INTERNAL);
    expectFixture(repeatableActivity, FIXTURE_ACTIVITY_REPEATABLE);
  });

  it("allocation: every field round-trips (including optional project attribution)", async () => {
    const { app } = freshApp();
    await seedFixtureDeps(app);
    await post(app, "resources", FIXTURE_RESOURCE);
    await post(app, "activities", FIXTURE_ACTIVITY);
    await post(app, "activities", FIXTURE_ACTIVITY_REPEATABLE);
    expect((await post(app, "allocations", FIXTURE_ALLOCATION)).statusCode).toBe(201);
    expect((await post(app, "allocations", FIXTURE_ALLOCATION_ATTRIBUTED)).statusCode).toBe(201);
    const allocations = (await readValidatedState(app)).allocations;
    const allocationRow = readAllocation(allocations, FIXTURE_ALLOCATION.id);
    const attributedAllocation = readAllocation(allocations, FIXTURE_ALLOCATION_ATTRIBUTED.id);
    expect(allocations).toHaveLength(2);
    expect(allocationRow.id).toBe(FIXTURE_ALLOCATION.id);
    expect(attributedAllocation.id).toBe(FIXTURE_ALLOCATION_ATTRIBUTED.id);
    expect(allocationRow).not.toBe(attributedAllocation);

    expectFixture(allocationRow, FIXTURE_ALLOCATION);
    expectFixture(attributedAllocation, FIXTURE_ALLOCATION_ATTRIBUTED);
  });

  it("timeOff: every field round-trips (including optional note)", async () => {
    const { app } = freshApp();
    await seedFixtureDeps(app);
    await post(app, "resources", FIXTURE_RESOURCE);
    expect((await post(app, "timeOff", FIXTURE_TIMEOFF)).statusCode).toBe(201);
    expectFixture(readOnlyTimeOff((await readValidatedState(app)).timeOff), FIXTURE_TIMEOFF);
  });
});
