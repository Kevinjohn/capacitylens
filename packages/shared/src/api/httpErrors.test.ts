import { describe, expect, it } from "vitest";
import { readHttpErrorBody, isProductErrorCode } from "./httpErrors.js";
import type { ProductHttpErrorBody, ProductValidationFailure } from "./httpErrors.js";

describe("flat HTTP failure boundary", () => {
  it("preserves unknown codes without claiming they are product codes", () => {
    expect(readHttpErrorBody({ error: "Refused", code: "FUTURE_DEPENDENCY_CODE" }, "Fallback")).toEqual({
      error: "Refused",
      code: "FUTURE_DEPENDENCY_CODE",
    });
    expect(isProductErrorCode("FUTURE_DEPENDENCY_CODE")).toBe(false);
    expect(isProductErrorCode("VALIDATION_ERROR")).toBe(true);
  });
  it("retains committed and admission metadata without trusting malformed values", () => {
    const decision = { admitted: false, requirements: { invitation: { met: false } } };
    expect(
      readHttpErrorBody({ error: "Waiting", code: "ADMISSION_REQUIRED", decision, committed: true }, "Fallback"),
    ).toEqual({ error: "Waiting", code: "ADMISSION_REQUIRED", decision, committed: true });
    expect(
      readHttpErrorBody({ error: 1, code: 2, decision: [], committed: "true", restorableItemCount: -1 }, "Fallback"),
    ).toEqual({ error: "Fallback" });
  });
  it("narrows safe restoration counts and rejects fractional, infinite and string counts", () => {
    for (const count of [0, 3])
      expect(readHttpErrorBody({ restorableItemCount: count }, "Fallback").restorableItemCount).toBe(count);
    for (const count of [-1, 0.5, Infinity, "3", Number.MAX_SAFE_INTEGER + 1])
      expect(readHttpErrorBody({ restorableItemCount: count }, "Fallback").restorableItemCount).toBeUndefined();
  });
  it("handles absent and non-object bodies", () => {
    for (const value of [null, undefined, [], "error"])
      expect(readHttpErrorBody(value, "Fallback")).toEqual({ error: "Fallback" });
  });
});

// These examples are checked by the shared test TypeScript project, alongside runtime tests.
function productTypeContracts() {
  const validation: ProductValidationFailure = { status: 400, body: { error: "Invalid", code: "VALIDATION_ERROR" } };
  // @ts-expect-error Product validation does not use Tuyau's default 422 status.
  const wrongStatus: ProductValidationFailure = { ...validation, status: 422 };
  // @ts-expect-error An arbitrary dependency code cannot be assumed to be a known product code.
  const unsupported: ProductHttpErrorBody = { error: "Unknown", code: "FUTURE_DEPENDENCY_CODE" };
  // @ts-expect-error Restoration confirmation requires its operation metadata.
  const missingCount: ProductHttpErrorBody = { error: "Confirm", code: "RESTORATION_CONFIRMATION_REQUIRED" };
  // @ts-expect-error Ordinary validation has no restoration metadata.
  const misplacedCount: ProductHttpErrorBody = { error: "Invalid", code: "VALIDATION_ERROR", restorableItemCount: 2 };
  return [validation, wrongStatus, unsupported, missingCount, misplacedCount];
}
void productTypeContracts;
