import { describe, expect, it } from "vitest";
import { parseResourceAvatarUrl } from "./resourceAvatarUrl";

describe("parseResourceAvatarUrl", () => {
  it("normalises a valid absolute HTTPS URL", () => {
    expect(parseResourceAvatarUrl("  https://images.example/avatar.png  ")).toBe("https://images.example/avatar.png");
  });

  it.each(["http://images.example/avatar.png", "https://user:secret@images.example/avatar.png", "not a url"])(
    "rejects %s",
    (value) => expect(parseResourceAvatarUrl(value)).toBeNull(),
  );

  it("treats whitespace as absent and enforces the serialised length limit", () => {
    expect(parseResourceAvatarUrl("   ")).toBeUndefined();
    expect(parseResourceAvatarUrl(null)).toBeUndefined();
    expect(parseResourceAvatarUrl(42)).toBeNull();
    expect(parseResourceAvatarUrl(`https://example.com/${"a".repeat(2048)}`)).toBeNull();
  });
});
