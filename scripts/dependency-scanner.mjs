import { existsSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import ts from "typescript";

/** Parse source dependencies without treating comments or string contents as code.
 * Type edges remain available for ownership checks but never imply a runtime cycle.
 * Nonliteral imports retain their location and expression so callers must classify them.
 */
export function parseDependencies(source, filename) {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const edges = [];
  function add(node, argument, kind) {
    const literal = argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument));
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
    edges.push(
      literal
        ? { specifier: argument.text, kind, line }
        : { specifier: null, kind, line, expression: argument?.getText(file) ?? "" },
    );
  }
  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const onlyTypes =
        clause?.isTypeOnly ||
        (!clause?.name &&
          bindings &&
          ts.isNamedImports(bindings) &&
          bindings.elements.length > 0 &&
          bindings.elements.every((item) => item.isTypeOnly));
      add(node, node.moduleSpecifier, onlyTypes ? "type" : "runtime");
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const clause = node.exportClause;
      const onlyTypes =
        node.isTypeOnly ||
        (clause &&
          ts.isNamedExports(clause) &&
          clause.elements.length > 0 &&
          clause.elements.every((item) => item.isTypeOnly));
      add(node, node.moduleSpecifier, onlyTypes ? "type" : "runtime");
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node, node.moduleReference.expression, node.isTypeOnly ? "type" : "runtime");
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      add(node, node.arguments[0], "runtime");
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node, node.argument.literal, "type");
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return edges;
}

const sourceExtensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

/** Resolve the repository's relative and workspace aliases. External packages are
 * classified separately; missing internal paths must never silently disappear.
 * JS specifiers can name TypeScript source, as in TypeScript's emitted-module convention.
 */
export function resolveDependency(specifier, filename, root) {
  if (specifier === null) return { classification: "nonliteral" };
  const base = specifier.startsWith(".")
    ? resolve(dirname(filename), specifier)
    : specifier.startsWith("@/")
      ? resolve(root, "src", specifier.slice(2))
      : specifier.startsWith("@capacitylens/shared/")
        ? resolve(root, "shared/src", specifier.slice("@capacitylens/shared/".length))
        : null;
  if (base === null) return { classification: "external" };
  const extension = extname(base);
  const substitutions = { ".js": [".ts", ".tsx"], ".jsx": [".tsx"], ".mjs": [".mts"], ".cjs": [".cts"] };
  const candidates = [
    ...(substitutions[extension] ?? []).map((suffix) => base.slice(0, -extension.length) + suffix),
    base,
    ...sourceExtensions.map((suffix) => base + suffix),
    ...sourceExtensions.map((suffix) => resolve(base, "index" + suffix)),
  ];
  const path = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
  return path ? { classification: "internal", path } : { classification: "unresolved" };
}
