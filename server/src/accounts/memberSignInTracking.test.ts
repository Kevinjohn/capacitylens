import { afterEach, describe, expect, it } from "vitest";
import { setMemberStatus, upsertMember } from "../controlTables";
import { openDb, type Db } from "../db";
import {
  clearTrackedMemberSignIn,
  confirmTrackedMemberSignIn,
  memberSignInTrackingSnapshot,
  setMemberSignInTracking,
} from "./memberSignInTracking";

describe("privacy-preserving member sign-in confirmation", () => {
  let db: Db | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  function setup(): Db {
    db = openDb(":memory:");
    upsertMember(db, {
      accountId: "account-a",
      userId: "owner",
      role: "owner",
      status: "active",
      createdAt: "2026-08-10T10:00:00.000Z",
    });
    upsertMember(db, {
      accountId: "account-a",
      userId: "editor",
      role: "editor",
      status: "active",
      createdAt: "2026-08-10T10:01:00.000Z",
    });
    return db;
  }

  it("is off by default and retains no confirmation", () => {
    const current = setup();
    expect(memberSignInTrackingSnapshot(current, "account-a")).toEqual({
      enabled: false,
      confirmations: new Map(),
    });
    expect(current.prepare("SELECT signInConfirmed FROM account_members ORDER BY userId").all()).toEqual([
      { signInConfirmed: null },
      { signInConfirmed: null },
    ]);
  });

  it("starts a fresh boolean-only window, confirming the authenticated owner", () => {
    const current = setup();
    expect(setMemberSignInTracking(current, "account-a", "owner", true)).toEqual({
      enabled: true,
      changed: true,
    });
    expect(memberSignInTrackingSnapshot(current, "account-a")).toEqual({
      enabled: true,
      confirmations: new Map([
        ["owner", true],
        ["editor", false],
      ]),
    });

    confirmTrackedMemberSignIn(current, "editor");
    expect(memberSignInTrackingSnapshot(current, "account-a").confirmations.get("editor")).toBe(true);
    const trackingSql = current
      .prepare("SELECT sql FROM sqlite_schema WHERE name = 'account_member_sign_in_tracking'")
      .get() as { sql: string };
    expect(trackingSql.sql).not.toMatch(/timestamp|date|at\b/i);
  });

  it("does not reset confirmations when an enabled setting is repeated", () => {
    const current = setup();
    setMemberSignInTracking(current, "account-a", "owner", true);
    confirmTrackedMemberSignIn(current, "editor");
    expect(setMemberSignInTracking(current, "account-a", "owner", true)).toEqual({
      enabled: true,
      changed: false,
    });
    expect(memberSignInTrackingSnapshot(current, "account-a").confirmations.get("editor")).toBe(true);
  });

  it("clears a confirmation after a deliberate access reset", () => {
    const current = setup();
    setMemberSignInTracking(current, "account-a", "owner", true);
    confirmTrackedMemberSignIn(current, "editor");
    clearTrackedMemberSignIn(current, "editor");
    expect(memberSignInTrackingSnapshot(current, "account-a").confirmations.get("editor")).toBe(false);
  });

  it("starts a new window when membership access is disabled or restored", () => {
    const current = setup();
    setMemberSignInTracking(current, "account-a", "owner", true);
    confirmTrackedMemberSignIn(current, "editor");
    expect(setMemberStatus(current, "account-a", "editor", "disabled")).toBe("changed");
    expect(memberSignInTrackingSnapshot(current, "account-a").confirmations.get("editor")).toBe(false);
    expect(setMemberStatus(current, "account-a", "editor", "active")).toBe("changed");
    expect(memberSignInTrackingSnapshot(current, "account-a").confirmations.get("editor")).toBe(false);
  });

  it("erases every observation when the owner turns tracking off", () => {
    const current = setup();
    setMemberSignInTracking(current, "account-a", "owner", true);
    confirmTrackedMemberSignIn(current, "editor");
    expect(setMemberSignInTracking(current, "account-a", "owner", false)).toEqual({
      enabled: false,
      changed: true,
    });
    expect(memberSignInTrackingSnapshot(current, "account-a")).toEqual({
      enabled: false,
      confirmations: new Map(),
    });
    expect(current.prepare("SELECT signInConfirmed FROM account_members ORDER BY userId").all()).toEqual([
      { signInConfirmed: null },
      { signInConfirmed: null },
    ]);
  });
});
