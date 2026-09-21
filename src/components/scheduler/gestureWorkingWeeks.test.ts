import { beforeEach, describe, expect, it } from "vitest";
import { makeAppData, makeAccount, makeResource, DEFAULT_ACCOUNT_ID, WORKDAYS } from "../../test/fixtures";
import { useStore } from "../../store/useStore";
import { hasEffectiveDaysFor } from "./gestureWorkingWeeks";

const ACCOUNT = makeAccount({ id: DEFAULT_ACCOUNT_ID });

beforeEach(() => {
  useStore.getState().replaceAll(makeAppData({ accounts: [ACCOUNT], resources: [] }));
  useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID);
});

describe("hasEffectiveDaysFor", () => {
  it("allows a resource with effective working days", () => {
    useStore.getState().replaceAll(
      makeAppData({
        accounts: [ACCOUNT],
        resources: [makeResource({ id: "person", accountId: DEFAULT_ACCOUNT_ID, workingDays: WORKDAYS })],
      }),
    );

    expect(hasEffectiveDaysFor({ resourceId: "person", ignoreWeekends: undefined })).toBe(true);
  });

  it("rejects a resource whose effective working week is collapsed", () => {
    useStore.getState().replaceAll(
      makeAppData({
        accounts: [ACCOUNT],
        resources: [makeResource({ id: "person", accountId: DEFAULT_ACCOUNT_ID, workingDays: [] })],
      }),
    );

    expect(hasEffectiveDaysFor({ resourceId: "person", ignoreWeekends: false })).toBe(false);
  });

  it("allows a collapsed resource when the allocation ignores working days", () => {
    useStore.getState().replaceAll(
      makeAppData({
        accounts: [ACCOUNT],
        resources: [makeResource({ id: "person", accountId: DEFAULT_ACCOUNT_ID, workingDays: [] })],
      }),
    );

    expect(hasEffectiveDaysFor({ resourceId: "person", ignoreWeekends: true })).toBe(true);
  });

  it("allows a missing resource so the caller can apply its own deletion guard", () => {
    expect(hasEffectiveDaysFor({ resourceId: "deleted", ignoreWeekends: false })).toBe(true);
  });
});
