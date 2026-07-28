import { describe, it, expect } from "vitest";
import { errorMessage } from "./errorMessage";
import { DomainError } from "@capacitylens/shared/domain/errors";

describe("errorMessage", () => {
  it("normalises an Error, a string, a React Router ErrorResponse, and unknown throws", () => {
    expect(errorMessage(new Error("x"))).toBe("x");
    expect(errorMessage("plain")).toBe("plain");
    expect(errorMessage({ statusText: "Not Found" })).toBe("Not Found");
    expect(errorMessage(null)).toBe("An unexpected error occurred.");
    expect(errorMessage(undefined)).toBe("An unexpected error occurred.");
    expect(errorMessage(42)).toBe("An unexpected error occurred.");
  });

  it.each(["", "   ", new Error(""), new Error("   "), { statusText: "" }])(
    "never returns a blank message for %j",
    (error) => {
      expect(errorMessage(error)).toBe("An unexpected error occurred.");
    },
  );

  it("falls back to the generic message when statusText is present but not a string", () => {
    // Exercises the `typeof statusText === 'string'` guard specifically (as opposed to the
    // earlier `'statusText' in error` check, which alone would let a non-string through).
    expect(errorMessage({ statusText: 123 })).toBe(
      "An unexpected error occurred.",
    );
  });

  it("maps a domain code through translations instead of trusting fallback prose", () => {
    expect(
      errorMessage(
        new DomainError("record_wrong_account", "obsolete server wording"),
      ),
    ).toBe("That record does not belong to the active company.");
  });
});
