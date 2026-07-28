import { describe, expect, it } from "vitest";
import { BatchTooLargeError, KeepaliveNotDispatchedError } from "./ServerSyncAdapter";
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

  it("does not invent a notice for an untyped transport failure", () => {
    expect(persistenceErrorNotice(new Error("offline"))).toBeNull();
  });
});
