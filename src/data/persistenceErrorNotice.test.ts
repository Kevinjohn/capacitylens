import { describe, expect, it } from "vitest";
import {
  BatchCommitUncertainError,
  BatchConflictError,
  BatchTooLargeError,
  BatchValidationError,
  KeepaliveNotDispatchedError,
} from "./ServerSyncAdapter";
import { persistenceErrorNotice } from "./persistenceErrorNotice";

describe("persistenceErrorNotice", () => {
  it("explains that an over-budget teardown save needs the page to remain open", () => {
    expect(persistenceErrorNotice(new KeepaliveNotDispatchedError("over budget"))).toMatch(
      /too large to save while this page was closing.*keep this page open/i,
    );
  });

  it("retains the ordinary oversized-diff guidance as a distinct surface", () => {
    expect(persistenceErrorNotice(new BatchTooLargeError("too many operations"))).toMatch(
      /change is too large.*fewer items/i,
    );
  });

  it("does not claim a conflict reload has completed before the authoritative read settles", () => {
    const notice = persistenceErrorNotice(new BatchConflictError("conflict"));

    expect(notice).toMatch(/is reloading the latest copy/i);
    expect(notice).not.toMatch(/has been reloaded/i);
  });

  it("does not invent a notice for an untyped transport failure", () => {
    expect(persistenceErrorNotice(new Error("offline"))).toBeNull();
  });

  it.each([
    new BatchConflictError("conflict"),
    new BatchCommitUncertainError("uncertain"),
    new BatchValidationError("invalid", "time_off_resource_inactive"),
  ])("maps every actionable reconciliation failure", (error) => {
    expect(persistenceErrorNotice(error)).toEqual(expect.any(String));
  });

  it("does not invent guidance for an uncoded validation failure", () => {
    expect(persistenceErrorNotice(new BatchValidationError("invalid"))).toBeNull();
  });
});
