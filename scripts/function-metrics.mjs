import { Linter } from "eslint";
import tseslint from "typescript-eslint";
import { createFunctionSymbols } from "./function-symbols.mjs";
import { createCodeLineCounter } from "./metric-lines.mjs";

const branches = new Set([
  "CatchClause",
  "ConditionalExpression",
  "LogicalExpression",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "IfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "AssignmentPattern",
]);
const blocks = new Set([
  "IfStatement",
  "SwitchStatement",
  "TryStatement",
  "DoWhileStatement",
  "WhileStatement",
  "WithStatement",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
]);

function branchesFlow(node) {
  if (branches.has(node.type)) return true;
  if (node.type === "SwitchCase") return node.test !== null;
  if (node.type === "AssignmentExpression") return ["||=", "&&=", "??="].includes(node.operator);
  return (node.type === "MemberExpression" || node.type === "CallExpression") && node.optional === true;
}

function nestsBlock(node) {
  if (!blocks.has(node.type)) return false;
  return !(node.type === "IfStatement" && node.parent.type === "IfStatement" && node.parent.alternate === node);
}

function measuredNode(node) {
  const parent = node.parent;
  if (parent?.type === "MethodDefinition") return parent;
  if (parent?.type === "Property" && (parent.method || parent.kind === "get" || parent.kind === "set")) return parent;
  return node;
}

function collector(entries, programSymbol) {
  return {
    meta: { schema: [] },
    create(context) {
      const stack = [];
      const symbolFor = createFunctionSymbols();
      const lineCount = createCodeLineCounter(
        context.sourceCode.text,
        context.sourceCode.getAllComments().map(({ range }) => range),
      );
      return {
        onCodePathStart(path, node) {
          const owner = stack.at(-1)?.symbol;
          const measured = measuredNode(node);
          const symbol = path.origin === "program" ? programSymbol : symbolFor(node, path.origin, owner);
          const entry = {
            symbol,
            origin: path.origin === "program" && programSymbol ? "embedded-region" : path.origin,
            startLine: measured.loc.start.line,
            endLine: measured.loc.end.line,
            lines:
              path.origin === "class-field-initializer" || (path.origin === "program" && !programSymbol)
                ? null
                : lineCount(measured.loc.start.line, measured.loc.end.line),
            complexity: 1,
            depth: 0,
            currentDepth: 0,
          };
          stack.push(entry);
          entries.push(entry);
        },
        "*"(node) {
          const current = stack.at(-1);
          if (branchesFlow(node)) current.complexity++;
          if (nestsBlock(node)) {
            current.currentDepth++;
            current.depth = Math.max(current.depth, current.currentDepth);
          }
        },
        "*:exit"(node) {
          if (nestsBlock(node)) stack.at(-1).currentDepth--;
        },
        onCodePathEnd() {
          stack.pop();
        },
      };
    },
  };
}

/**
 * Measure every executable JS/TS function, including nested callbacks and implicit class scopes.
 * Length includes nested bodies but excludes blank/comment-only lines. Complexity uses classic
 * branching counts (including defaults, logical assignments and optional chains); nested scopes
 * are independent. Depth counts nested control statements, with else-if at its parent's depth.
 * Module scopes and field initializers expose control metrics; module length uses the physical file
 * budget, while function values receive separate length metrics. Module scope does not prefix child symbols.
 * Reject parse/configuration failures and disable inline directives so collection cannot be hidden.
 */
export function measureFunctions(source, filename) {
  if (!/\.(?:[cm]?[jt]s|[jt]sx)$/.test(filename)) throw new Error(`Unsupported function source: ${filename}`);
  return measureWithParser(source, filename, {
    parser: tseslint.parser,
    sourceType: /\.(cjs|cts)$/.test(filename) ? "commonjs" : "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  });
}

/**
 * Collect metrics through a public ESLint parser, retaining original source coordinates.
 * An unnamed program measures module control flow. A named program measures the length and control
 * flow of an authored embedded region as well as its nested functions;
 * it does not represent a generated framework callback. Parser failures remain fatal.
 */
export function measureWithParser(source, filename, languageOptions, programSymbol = null) {
  const entries = [];
  const messages = new Linter().verify(
    source,
    [
      {
        files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts,vue}"],
        languageOptions,
        plugins: { metrics: { rules: { collect: collector(entries, programSymbol) } } },
        rules: { "metrics/collect": "error" },
      },
    ],
    { filename, allowInlineConfig: false },
  );
  if (messages.length)
    throw new Error(`Cannot measure ${filename}: ${messages.map(({ message }) => message).join("; ")}`);
  return entries.map(({ currentDepth, ...entry }) => {
    if (currentDepth !== 0) throw new Error(`Unbalanced statement depth in ${filename}: ${entry.symbol}`);
    return { ...entry, symbol: entry.symbol ?? "module" };
  });
}
