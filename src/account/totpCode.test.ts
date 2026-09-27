import { expect, it } from "vitest";
import { totpCode } from "../../e2e/totpCode";

it("derives the six-digit TOTP from a known 30-second test vector", async () => {
  expect(await totpCode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000)).toBe("287082");
});
