import { describe, expect, it } from "vitest";
import { parseAuthUser } from "./validateAuthUser";

describe("validateAuthUser", () => {
  it("accepts a complete user and preserves forward-compatible fields", () => {
    const value = {
      id: "user-1",
      name: "Ada",
      email: "ada@example.com",
      twoFactorEnabled: true,
      image: null,
      futureField: "retained",
    };

    expect(parseAuthUser({ value: value, requireEmail: true })).toBe(value);
  });

  it.each([
    null,
    [],
    {},
    { id: "" },
    { id: "user-1", name: 1 },
    { id: "user-1", email: 1 },
    { id: "user-1", twoFactorEnabled: "yes" },
    { id: "user-1", image: 1 },
  ])("rejects a malformed auth response: %j", (value) => {
    expect(parseAuthUser({ value: value })).toBeNull();
  });

  it("requires a non-blank email only at boundaries that request it", () => {
    expect(parseAuthUser({ value: { id: "user-1" } })).toEqual({ id: "user-1" });
    expect(parseAuthUser({ value: { id: "user-1" }, requireEmail: true })).toBeNull();
    expect(parseAuthUser({ value: { id: "user-1", email: "   " }, requireEmail: true })).toBeNull();
  });
});
