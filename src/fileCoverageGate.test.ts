import { describe, expect, it } from "vitest";
import { uncoveredExecutableFiles } from "../scripts/check-file-coverage.mjs";

const record = (source: string, found: number, hit: number) =>
  [`SF:${source}`, `LF:${found}`, `LH:${hit}`, "end_of_record"].join("\n");

describe("per-file coverage gate", () => {
  it("rejects a new executable module with no covered line", () => {
    expect(uncoveredExecutableFiles(record("src/newModule.ts", 12, 0), new Set())).toEqual(["src/newModule.ts"]);
  });

  it("accepts covered and type-only modules", () => {
    const lcov = [record("src/covered.ts", 12, 1), record("src/types.ts", 0, 0)].join("\n");
    expect(uncoveredExecutableFiles(lcov, new Set())).toEqual([]);
  });

  it("requires legacy exceptions to be named exactly", () => {
    const lcov = record("src/legacy.ts", 4, 0);
    expect(uncoveredExecutableFiles(lcov, new Set(["src/legacy.ts"]))).toEqual([]);
    expect(uncoveredExecutableFiles(lcov, new Set(["src/**"]))).toEqual(["src/legacy.ts"]);
  });
});
