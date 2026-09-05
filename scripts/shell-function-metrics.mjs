import { fileURLToPath } from "node:url";
import { Language, Parser } from "web-tree-sitter";
import { createCodeLineCounter } from "./metric-lines.mjs";

const branchingNodes = new Set([
  "if_statement",
  "elif_clause",
  "for_statement",
  "c_style_for_statement",
  "while_statement",
  "ternary_expression",
]);
const nestedNodes = new Set([
  "if_statement",
  "for_statement",
  "c_style_for_statement",
  "while_statement",
  "case_statement",
]);
const logicalOperators = new Set(["&&", "||", "-a", "-o"]);
const defaultOperators = new Set([":-", "-", ":=", "=", ":?", "?", ":+", "+"]);
let languagePromise;

async function loadLanguage() {
  await Parser.init();
  return Language.load(fileURLToPath(import.meta.resolve("tree-sitter-bash/tree-sitter-bash.wasm")));
}

function branchCount(node) {
  if (branchingNodes.has(node.type)) return 1;
  if (node.type === "case_item") return Number(!node.childrenForFieldName("value").some((value) => value.text === "*"));
  if (node.type === "list" || node.type === "binary_expression") {
    return node.children.filter((child) => logicalOperators.has(child.type)).length;
  }
  if (node.type === "expansion") return node.children.filter((child) => defaultOperators.has(child.type)).length;
  return 0;
}

function collectFunctions(root, source) {
  const entries = [];
  const occurrences = new Map();
  const comments = root.descendantsOfType("comment").map((node) => [node.startIndex, node.endIndex]);
  const lineCount = createCodeLineCounter(source, comments);
  function visit(node, owner, depth) {
    let current = owner;
    let currentDepth = depth;
    if (node.type === "function_definition") {
      const name = node.childForFieldName("name").text;
      const base = owner ? `${owner.symbol}/function:${name}` : `function:${name}`;
      const occurrence = (occurrences.get(base) ?? 0) + 1;
      occurrences.set(base, occurrence);
      current = {
        symbol: occurrence === 1 ? base : `${base}#${occurrence}`,
        origin: "function",
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        lines: lineCount(node.startPosition.row + 1, node.endPosition.row + 1),
        complexity: 1,
        depth: 0,
      };
      currentDepth = 0;
      entries.push(current);
    }
    if (current) {
      current.complexity += branchCount(node);
      if (nestedNodes.has(node.type)) currentDepth++;
      current.depth = Math.max(current.depth, currentDepth);
    }
    for (const child of node.namedChildren) visit(child, current, currentDepth);
  }
  visit(root, null, 0);
  return entries;
}

/**
 * Measure shell function declarations without executing commands or interpreting quoted script text.
 * Count conditional/loop branches, non-default case arms, logical operators, parameter defaults and
 * arithmetic ternaries. Count nesting of conditional/loop/case statements; elif stays at its if's depth.
 * Nested functions have independent control metrics, but their lines remain in the enclosing length.
 * Symbols use lexical function ownership and occurrence suffixes for repeated definitions.
 * Use the published Bash WASM grammar for POSIX/Bash syntax; reject parser recovery and unknown formats.
 */
export async function measureShellFunctions(source, filename) {
  if (!filename.endsWith(".sh")) throw new Error(`Unsupported shell source: ${filename}`);
  languagePromise ??= loadLanguage();
  const language = await languagePromise;
  const parser = new Parser();
  let tree;
  try {
    parser.setLanguage(language);
    tree = parser.parse(source);
    if (!tree || tree.rootNode.hasError) throw new Error(`Cannot measure ${filename}: invalid shell syntax.`);
    return collectFunctions(tree.rootNode, source);
  } finally {
    tree?.delete();
    parser.delete();
  }
}
