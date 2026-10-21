import { describe, it, expect } from "vitest";
import * as color from "./color";

describe("color compatibility facade", () => {
  it("keeps the established color exports available", () => {
    expect(color.resolveBarColor).toBeTypeOf("function");
    expect(color.snapToPresetColor).toBeTypeOf("function");
    expect(color.resolveAccessibleBarColors).toBe(color.ensureBarColors);
  });
});
