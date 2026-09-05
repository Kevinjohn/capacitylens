import { Linter } from "eslint";
import tseslint from "typescript-eslint";
import { createFunctionSymbols } from "./function-symbols.mjs";

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

function codeLines(sourceCode) {
  // Blank comment characters rather than stripping lines: literal strings and JSX remain intact.
  const characters = sourceCode.text.split("");
  for (const comment of sourceCode.getAllComments()) {
    for (let index = comment.range[0]; index < comment.range[1]; index++) {
      if (!/[\r\n\u2028\u2029]/.test(characters[index])) characters[index] = " ";
    }
  }
  const lines = characters.join("").split(/\r\n|[\n\r\u2028\u2029]/);
  const prefix = [0];
  for (const line of lines) prefix.push(prefix.at(-1) + Number(Boolean(line.trim())));
  return (start, end) => prefix[end] - prefix[start - 1];
}

function measuredNode(node) {
  const parent = node.parent;
  if (parent?.type === "MethodDefinition") return parent;
  if (parent?.type === "Property" && (parent.method || parent.kind === "get" || parent.kind === "set")) return parent;
  return node;
}

function collector(entries) {
  return {
    meta: { schema: [] },
    create(context) {
      const stack = [];
      const symbolFor = createFunctionSymbols();
      const lineCount = codeLines(context.sourceCode);
      return {
        onCodePathStart(path, node) {
          const owner = stack.at(-1)?.symbol;
          const measured = measuredNode(node);
          const symbol = path.origin === "program" ? null : symbolFor(node, path.origin, owner);
          const entry = {
            symbol,
            origin: path.origin,
            startLine: measured.loc.start.line,
            endLine: measured.loc.end.line,
            lines:
              path.origin === "class-field-initializer"
                ? null
                : lineCount(measured.loc.start.line, measured.loc.end.line),
            complexity: 1,
            depth: 0,
            currentDepth: 0,
          };
          stack.push(entry);
          if (symbol) entries.push(entry);
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
 * Field initializers expose complexity, while their function values receive separate length metrics.
 * Reject parse/configuration failures and disable inline directives so collection cannot be hidden.
 */
export function measureFunctions(source, filename) {
  if (!/\.(?:[cm]?[jt]s|[jt]sx)$/.test(filename)) throw new Error(`Unsupported function source: ${filename}`);
  const entries = [];
  const messages = new Linter().verify(
    source,
    [
      {
        files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
        languageOptions: {
          parser: tseslint.parser,
          sourceType: /\.(cjs|cts)$/.test(filename) ? "commonjs" : "module",
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
        plugins: { metrics: { rules: { collect: collector(entries) } } },
        rules: { "metrics/collect": "error" },
      },
    ],
    { filename, allowInlineConfig: false },
  );
  if (messages.length)
    throw new Error(`Cannot measure ${filename}: ${messages.map(({ message }) => message).join("; ")}`);
  return entries.map(({ currentDepth, ...entry }) => {
    if (currentDepth !== 0) throw new Error(`Unbalanced statement depth in ${filename}: ${entry.symbol}`);
    return entry;
  });
}
