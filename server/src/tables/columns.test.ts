import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const columnsPath = fileURLToPath(new URL("./columns.ts", import.meta.url));
const source = readFileSync(columnsPath, "utf8");
const configPath = fileURLToPath(new URL("../../tsconfig.json", import.meta.url));
const config = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, fileURLToPath(new URL("../../", import.meta.url)));

// Compile the actual owner with in-memory column drift: this also catches guards
// that look correct in isolation but are never applied to one of the real tables.
function compileColumns(contents: string) {
  const host = ts.createCompilerHost(parsed.options);
  const readFile = host.readFile.bind(host);
  host.readFile = (path) => (path === columnsPath ? contents : readFile(path));
  const program = ts.createProgram([columnsPath], { ...parsed.options, noEmit: true }, host);
  const file = program.getSourceFile(columnsPath)!;
  return [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file)];
}

describe("column schema compilation", () => {
  it("accepts the current schema", () => {
    expect(config.error).toBeUndefined();
    expect(parsed.errors).toEqual([]);
    expect(compileColumns(source)).toEqual([]);
  });

  it.each([
    ["missing", ""],
    ["extra", '{ name: "id" }, { name: "unexpectedColumn" },'],
    ["duplicate", '{ name: "id" }, { name: "id" },'],
  ])("rejects %s columns in every table", (_kind, replacement) => {
    const matches = source.match(/\{ name: "id" \},/g);
    expect(matches).toHaveLength(10);
    const diagnostics = compileColumns(source.replaceAll('{ name: "id" },', replacement));
    expect(diagnostics).toHaveLength(10);
    for (const diagnostic of diagnostics) {
      expect(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).toContain(
        "does not satisfy the constraint 'true'",
      );
    }
  });
});
