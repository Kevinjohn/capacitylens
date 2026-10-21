import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildProductOrientationKey,
  dismissProductOrientation,
  hasDismissedProductOrientation,
  PRODUCT_ORIENTATION_VERSION,
  resolveProductOrientationSubject,
} from "./productOrientation";

describe("product orientation persistence", () => {
  beforeEach(() => localStorage.clear());

  it("scopes the versioned key to an encoded person and company", () => {
    expect(PRODUCT_ORIENTATION_VERSION).toBe("v1");
    expect(buildProductOrientationKey("person/a", "company b")).toBe(
      "capacitylens/productOrientation/v1/person%2Fa/company%20b",
    );
  });

  it("uses stable identities without names, email addresses, or roles", () => {
    expect(resolveProductOrientationSubject({ userId: "user-1", demo: true })).toBe("user-1");
    expect(resolveProductOrientationSubject({ userId: null, demo: true })).toBe("demo");
    expect(resolveProductOrientationSubject({ userId: null, demo: false })).toBe("local");
  });

  it("does not treat the legacy device-global intro flag as dismissal", () => {
    localStorage.setItem("capacitylens/introSeen", "on");
    expect(hasDismissedProductOrientation("person", "company")).toBe(false);
  });

  it("persists dismissal only for the matching person and company", () => {
    expect(dismissProductOrientation("person-1", "company-1")).toBe(true);
    expect(hasDismissedProductOrientation("person-1", "company-1")).toBe(true);
    expect(hasDismissedProductOrientation("person-2", "company-1")).toBe(false);
    expect(hasDismissedProductOrientation("person-1", "company-2")).toBe(false);
  });

  it("fails open when storage reads or writes fail", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementationOnce(() => {
      throw new Error("blocked");
    });
    expect(hasDismissedProductOrientation("person", "company")).toBe(false);

    vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
      throw new Error("blocked");
    });
    expect(dismissProductOrientation("person", "company")).toBe(false);
  });
});
