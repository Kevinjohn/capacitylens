import { describe, it, expect } from "vitest";
import { meta, freshApp, account, person, allocation } from "./fixtures/appTestEntities";
import { post, put, patch } from "./fixtures/appTestHttp";
import { readFirstAllocation } from "./fixtures/appTestSnapshotSchedule";
import { readFirstAccount, readAccount, readFirstResource } from "./fixtures/appTestSnapshotAccount";
import { readValidatedState } from "./fixtures/appTestSnapshotBatch";
import { readStateAccount, scaffold } from "./fixtures/appTestScaffold";

function createDirectWriteColourAndResourceSanitizationTests(): void {
  it("stores a validated account colour without surrounding whitespace", async () => {
    const { app } = freshApp();
    expect((await post(app, "accounts", { ...account("a1"), color: "  #aAbBcC  " })).statusCode).toBe(201);
    // #aabbcc is not itself a preset — sanitizeWrite snaps it to its NEAREST preset (shared
    // snapToPresetColor), not a fixed fallback colour. See the "snaps a non-preset account
    // colour to its nearest preset" test below for the policy this replaced.
    expect((await readStateAccount(app)).color).toBe("#bed4f4");
  });

  it("snaps a non-preset account colour to its NEAREST preset, not a fixed fallback colour", async () => {
    // Regression guard for the old blanket-fallback bug: a colour close to one specific preset
    // must land on THAT preset, proving the guard is distance-based rather than always emitting
    // one fixed hex regardless of the input.
    // multiAccount: true — this test deliberately creates a SECOND company on one instance (see
    // the identical note at the other multiAccount call sites above).
    const { app } = freshApp(true, { multiAccount: true });
    await post(app, "accounts", { ...account("a1"), color: "#7cd9e4" });
    expect((await readStateAccount(app)).color).toBe("#7adae3");
    // A colour on the opposite side of the palette snaps to a DIFFERENT preset — proving the two
    // don't collapse onto the same fixed fallback.
    await post(app, "accounts", { ...account("a2"), color: "#f6c3bb" });
    const accounts = (await readValidatedState(app)).accounts;
    expect(readAccount(accounts, "a2").color).toBe("#f5bcbc");
  });

  it("uses the same nearest-preset mapping for direct scoped-entity writes", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    const response = await post(app, "resources", {
      ...person("r1", "a1"),
      color: "#eb7273",
    });

    expect(response.statusCode).toBe(201);
    expect(readFirstResource((await readValidatedState(app)).resources).color).toBe("#eb7272");
  });

  it("repairs junk fields and missing legacy halfDays/engagement values on POST", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    // A hand-crafted request that bypasses the UI forms with every value-field wrong.
    const res = await post(app, "resources", {
      id: "r1",
      accountId: "a1",
      kind: "wizard", // invalid → 'person'
      role: "Designer",
      employmentType: "overlord", // invalid → 'permanent'
      workingHoursPerDay: -5, // invalid → 8
      workingDays: "nope", // invalid → [1..5]
      color: "not-a-colour", // invalid → fallback hex
      ...meta(),
    });
    expect(res.statusCode).toBe(201);
    const r = readFirstResource((await readValidatedState(app)).resources);
    expect(r.kind).toBe("person");
    expect(r.employmentType).toBe("permanent");
    expect(r.engagement).toBe("studio");
    expect(r.workingHoursPerDay).toBe(8);
    expect(r.workingDays).toEqual([1, 2, 3, 4, 5]);
    expect(r.halfDays).toEqual([]);
    expect(r.color).toBe("#5c34d4");
  });
}

function createDirectWriteAllocationValueSanitizationTest(): void {
  it("repairs a bad allocation status / hours on PUT", async () => {
    const { app } = freshApp();
    await scaffold(app);
    const res = await put({
      app,
      entity: "allocations",
      id: "al1",
      payload: allocation({
        id: "al1",
        accountId: "a1",
        resourceId: "r1",
        activityId: "t1",
        o: { status: "maybe", hoursPerDay: -3 },
      }),
    });
    expect(res.statusCode).toBe(200);
    const a = readFirstAllocation((await readValidatedState(app)).allocations);
    expect(a.status).toBe("confirmed");
    // A finite out-of-range value clamps to the [0,24] FLOOR (0), matching the shared
    // store clamp — import + store now use one clampHoursPerDay, so they can't diverge.
    // (Only a missing / NaN value falls back to a full 8h day.)
    expect(a.hoursPerDay).toBe(0);
  });
}

function createDirectWriteAllocationSeriesSanitizationTest(): void {
  it("sanitizes repeat-series identity on create and preserves membership on every edit shape", async () => {
    const { app } = freshApp();
    await scaffold(app);
    expect(
      (
        await post(app, "allocations", {
          ...allocation({ id: "al-series", accountId: "a1", resourceId: "r1", activityId: "t1" }),
          seriesId: "  weekly-series  ",
        })
      ).statusCode,
    ).toBe(201);
    expect((await readValidatedState(app)).allocations.find((row) => row.id === "al-series")?.seriesId).toBe(
      "weekly-series",
    );

    expect(
      (
        await put({
          app,
          entity: "allocations",
          id: "al-series",
          payload: {
            ...allocation({ id: "al-series", accountId: "a1", resourceId: "r1", activityId: "t1" }),
            note: "Legacy full replacement",
          },
        })
      ).statusCode,
    ).toBe(200);
    expect((await readValidatedState(app)).allocations.find((row) => row.id === "al-series")?.seriesId).toBe(
      "weekly-series",
    );

    expect(
      (await patch({ app, entity: "allocations", id: "al-series", payload: { seriesId: "another-series" } }))
        .statusCode,
    ).toBe(200);
    expect((await readValidatedState(app)).allocations.find((row) => row.id === "al-series")?.seriesId).toBe(
      "weekly-series",
    );

    expect(
      (
        await post(app, "allocations", {
          ...allocation({ id: "al-blank-series", accountId: "a1", resourceId: "r1", activityId: "t1" }),
          seriesId: "   ",
        })
      ).statusCode,
    ).toBe(201);
    expect((await readValidatedState(app)).allocations.find((row) => row.id === "al-blank-series")).not.toHaveProperty(
      "seriesId",
    );
  });
}

function createDirectWriteAccountSchedulingSanitizationTests(): void {
  it("drops a junk account schedulingMode on a direct write but keeps a valid one", async () => {
    const { app } = freshApp();
    // A hand-crafted account write with a junk schedulingMode the scheduler can't handle.
    expect(
      (
        await post(app, "accounts", {
          ...account("a1"),
          schedulingMode: "wizard",
        })
      ).statusCode,
    ).toBe(201);
    expect((await readStateAccount(app)).schedulingMode).toBeUndefined(); // junk dropped → 'hourly'
    // A valid mode persists unchanged.
    await patch({ app, entity: "accounts", id: "a1", payload: { schedulingMode: "blocks" } });
    expect((await readStateAccount(app)).schedulingMode).toBe("blocks");
  });

  it("defaults, repairs and persists account working-day selections", async () => {
    const { app } = freshApp();
    expect((await post(app, "accounts", { ...account("a1"), weekStartsOn: 0 })).statusCode).toBe(201);
    expect((await readStateAccount(app)).workingDays).toEqual([0, 1, 2, 3, 4]);

    expect((await patch({ app, entity: "accounts", id: "a1", payload: { workingDays: [1, 3, 5] } })).statusCode).toBe(
      200,
    );
    expect((await readStateAccount(app)).workingDays).toEqual([1, 3, 5]);

    // A pre-v31 full-replacement client does not know this field. Omission preserves the
    // configured selection instead of resetting it to the week-start default.
    expect((await put({ app, entity: "accounts", id: "a1", payload: account("a1") })).statusCode).toBe(200);
    expect((await readStateAccount(app)).workingDays).toEqual([1, 3, 5]);

    expect((await patch({ app, entity: "accounts", id: "a1", payload: { workingDays: [1, 9] } })).statusCode).toBe(200);
    expect((await readStateAccount(app)).workingDays).toEqual([0, 1, 2, 3, 4]);

    expect((await patch({ app, entity: "accounts", id: "a1", payload: { workingDays: [] } })).statusCode).toBe(200);
    expect((await readStateAccount(app)).workingDays).toEqual([0, 1, 2, 3, 4]);
  });
}

describe("value-level sanitization on direct writes (server is the integrity boundary)", () => {
  createDirectWriteColourAndResourceSanitizationTests();
  createDirectWriteAllocationValueSanitizationTest();
  createDirectWriteAllocationSeriesSanitizationTest();
  createDirectWriteAccountSchedulingSanitizationTests();
});

describe("scheduling-mode fields round-trip through the DB", () => {
  it("persists account schedulingMode and a block allocation (hoursPerDay 0 + ignoreWeekends)", async () => {
    const { app } = freshApp();
    await scaffold(app);
    // Switch the company into blocks mode.
    expect((await patch({ app, entity: "accounts", id: "a1", payload: { schedulingMode: "blocks" } })).statusCode).toBe(
      200,
    );
    // A block booking persists hoursPerDay 0 (load ignored) + ignoreWeekends true. The
    // 0 must NOT be sanitized up to a full day, and the boolean must round-trip.
    const res = await post(
      app,
      "allocations",
      allocation({
        id: "al1",
        accountId: "a1",
        resourceId: "r1",
        activityId: "t1",
        o: {
          hoursPerDay: 0,
          ignoreWeekends: true,
        },
      }),
    );
    expect(res.statusCode).toBe(201);
    const s = await readValidatedState(app);
    expect(readFirstAccount(s.accounts).schedulingMode).toBe("blocks");
    expect(readFirstAllocation(s.allocations).hoursPerDay).toBe(0);
    expect(readFirstAllocation(s.allocations).ignoreWeekends).toBe(true);
  });
});
