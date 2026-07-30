import { describe, expect, it } from "vitest";
import { clearJoinedAccountHandoff, joinedAccountEntryPath, readJoinedAccountHandoff } from "./joinedAccountHandoff";

describe("joined account handoff", () => {
  it("round-trips an opaque account id through the one-use entry query", () => {
    const path = joinedAccountEntryPath("account / one");
    expect(path).toBe("/?joinedAccount=account%20%2F%20one");
    expect(readJoinedAccountHandoff(path.slice(path.indexOf("?")))).toBe("account / one");
  });

  it("ignores missing and empty destinations", () => {
    expect(readJoinedAccountHandoff("")).toBeNull();
    expect(readJoinedAccountHandoff("?joinedAccount=")).toBeNull();
  });

  it("removes only the one-use destination from a combined query", () => {
    expect(clearJoinedAccountHandoff("?tab=security&joinedAccount=account-1&view=archived")).toBe(
      "?tab=security&view=archived",
    );
    expect(clearJoinedAccountHandoff("?joinedAccount=account-1")).toBe("");
  });
});
