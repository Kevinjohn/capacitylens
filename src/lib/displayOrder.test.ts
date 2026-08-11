import { describe, expect, it } from "vitest";
import { byName, compareDisplayNames } from "./displayOrder";

describe("display ordering", () => {
  it("pins English alphabetical order instead of inheriting the host locale", () => {
    const entries = [
      { id: "z", name: "Zulu" },
      { id: "a", name: "Äther" },
    ];

    expect(new Intl.Collator("sv").compare("Äther", "Zulu")).toBeGreaterThan(0);
    expect([...entries].sort(byName).map((entry) => entry.name)).toEqual(["Äther", "Zulu"]);
  });

  it("breaks case, accent and exact-name ties without relying on stable sort", () => {
    const entries = [
      { id: "same-z", name: "alpha" },
      { id: "accent", name: "álpha" },
      { id: "upper", name: "Alpha" },
      { id: "same-a", name: "alpha" },
    ];

    expect([...entries].sort(byName).map((entry) => entry.id)).toEqual(["upper", "same-a", "same-z", "accent"]);
    expect(compareDisplayNames("Same", "b", "Same", "a")).toBeGreaterThan(0);
  });
});
