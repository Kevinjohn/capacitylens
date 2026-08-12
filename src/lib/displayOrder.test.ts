import { describe, expect, it } from "vitest";
import {
  byName,
  compareDisplayNames,
  engagementFavouriteDisplayNameComparator,
  favouriteDisplayNameComparator,
} from "./displayOrder";

describe("display ordering", () => {
  it("pins English alphabetical order instead of inheriting the host locale", () => {
    const entries = [
      { id: "z", name: "Zulu" },
      { id: "a", name: "Äther" },
    ];

    expect(new Intl.Collator("sv").compare("Äther", "Zulu")).toBeGreaterThan(0);
    expect([...entries].sort(byName).map((entry) => entry.name)).toEqual(["Äther", "Zulu"]);
  });

  it("orders numbered names naturally", () => {
    const entries = [
      { id: "ten", name: "Workshop 10" },
      { id: "two", name: "Workshop 2" },
    ];

    expect([...entries].sort(byName).map((entry) => entry.name)).toEqual(["Workshop 2", "Workshop 10"]);
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

  it("sorts favourites first and applies the same deterministic display-name order within each partition", () => {
    const entries = [
      { id: "normal-b", name: "Beta" },
      { id: "favourite-b", name: "Beta", isFavourite: true },
      { id: "normal-a", name: "Alpha", isFavourite: false },
      { id: "favourite-a", name: "alpha", isFavourite: true },
    ];

    expect([...entries].sort(favouriteDisplayNameComparator((entry) => entry.name)).map((entry) => entry.id)).toEqual([
      "favourite-a",
      "favourite-b",
      "normal-a",
      "normal-b",
    ]);
  });

  it("sorts Studio before Supplementary and favourites first within each engagement partition", () => {
    const entries = [
      { id: "supp-favourite", name: "Alpha", engagement: "supplementary" as const, isFavourite: true },
      { id: "studio-normal", name: "Zulu", engagement: "studio" as const },
      { id: "studio-favourite", name: "Beta", engagement: "studio" as const, isFavourite: true },
      { id: "supp-normal", name: "Beta", engagement: "supplementary" as const },
    ];

    expect(
      [...entries].sort(engagementFavouriteDisplayNameComparator((entry) => entry.name)).map((entry) => entry.id),
    ).toEqual(["studio-favourite", "studio-normal", "supp-favourite", "supp-normal"]);
  });
});
