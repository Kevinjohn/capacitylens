import { expect, it } from "vitest";
import { readMetadata } from "./joinStatus";

it("rejects metadata without a company name", () => {
  expect(readMetadata({ passwordAvailable: true, providerAvailable: true })).toBeNull();
});
