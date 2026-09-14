import { describe, expect, it } from "vitest";
import { parseResourceAvatarUrl } from "./resourceAvatarUrl";

describe("parseResourceAvatarUrl", () => {
  it("normalises a valid absolute HTTPS URL", () => {
    expect(parseResourceAvatarUrl("  https://images.example/avatar.png  ")).toEqual({
      ok: true,
      value: "https://images.example/avatar.png",
    });
  });

  it.each(["http://images.example/avatar.png", "https://user:secret@images.example/avatar.png", "not a url"])(
    "rejects %s",
    (value) => expect(parseResourceAvatarUrl(value).ok).toBe(false),
  );

  it("treats whitespace as absent and enforces the serialised length limit", () => {
    expect(parseResourceAvatarUrl("   ")).toEqual({ ok: true, value: undefined });
    expect(parseResourceAvatarUrl(`https://example.com/${"a".repeat(2048)}`).ok).toBe(false);
  });
});
