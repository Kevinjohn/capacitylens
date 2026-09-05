import { existsSync, statSync } from "node:fs";
import { dirname, extname, resolve, sep } from "node:path";
import ts from "typescript";

function importKind(clause, verbatimModuleSyntax) {
  if (clause?.isTypeOnly) return "type";
  const bindings = clause?.namedBindings;
  if (verbatimModuleSyntax || clause?.name || !bindings || !ts.isNamedImports(bindings)) return "runtime";
  return bindings.elements.length > 0 && bindings.elements.every((item) => item.isTypeOnly) ? "type" : "runtime";
}

function exportKind(declaration, verbatimModuleSyntax) {
  if (declaration.isTypeOnly) return "type";
  const clause = declaration.exportClause;
  if (verbatimModuleSyntax || !clause || !ts.isNamedExports(clause)) return "runtime";
  return clause.elements.length > 0 && clause.elements.every((item) => item.isTypeOnly) ? "type" : "runtime";
}

function erasedTypeNames(node, kind) {
  if (kind !== "type") return;
  const importing = ts.isImportDeclaration(node);
  if (importing && node.importClause?.name) return;
  const bindings = importing
    ? node.importClause?.namedBindings
    : ts.isExportDeclaration(node)
      ? node.exportClause
      : undefined;
  if (!bindings || !(ts.isNamedImports(bindings) || ts.isNamedExports(bindings))) return;
  return bindings.elements.map((binding) => (binding.propertyName ?? binding.name).text);
}

/** Parse source dependencies without treating comments or string contents as code.
 * Explicit type-only clauses are erased. Inline type bindings can still initialize
 * their module when verbatimModuleSyntax is enabled; retain those runtime edges.
 * Nonliteral imports retain their location and expression so callers must classify them.
 */
export function parseDependencies(source, filename, { verbatimModuleSyntax = false } = {}) {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const edges = [];
  function add(node, argument, kind) {
    const literal = argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument));
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
    const names = erasedTypeNames(node, kind);
    edges.push(
      literal
        ? { specifier: argument.text, kind, line, ...(names ? { typeNames: names } : {}) }
        : { specifier: null, kind, line, expression: argument?.getText(file) ?? "" },
    );
  }
  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      add(node, node.moduleSpecifier, importKind(node.importClause, verbatimModuleSyntax));
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      add(node, node.moduleSpecifier, exportKind(node, verbatimModuleSyntax));
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

function readVerbatimSetting(configPath) {
  const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
  if (loaded.error) throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, dirname(configPath), {}, configPath);
  if (parsed.errors.length) {
    throw new Error(parsed.errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n")).join("\n"));
  }
  return parsed.options.verbatimModuleSyntax ?? false;
}

/** Read each source package's compiler setting once, including inherited options.
 * Fixtures outside these packages use TypeScript's default import-elision mode.
 * Invalid or missing project configurations fail visibly rather than changing the graph.
 */
export function createDependencyParser(root) {
  const projects = [
    ["src", "tsconfig.app.json"],
    ["server/src", "server/tsconfig.json"],
    ["shared/src", "shared/tsconfig.json"],
  ].map(([directory, config]) => ({
    prefix: resolve(root, directory) + sep,
    verbatimModuleSyntax: readVerbatimSetting(resolve(root, config)),
  }));
  return (source, filename) => {
    const project = projects.find(({ prefix }) => resolve(filename).startsWith(prefix));
    return parseDependencies(source, filename, { verbatimModuleSyntax: project?.verbatimModuleSyntax ?? false });
  };
}
