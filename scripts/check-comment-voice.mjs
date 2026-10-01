import { readFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const SOURCE_PATTERN = /\.(?:ts|tsx|mts|mjs)$/;
const ISSUE_URL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+/;
const URL_PATTERN = /\bhttps?:\/\/\S+/g;
// Issue numbers (#123), plan labels (T7, P1.11, Phase 2, Stage C, round 1, plan exception) and
// "issue 123". Six or more digits after a hash is a colour such as #161922, not an issue.
const TICKET_PATTERNS = [
  /(?<![\w&])#\d{1,5}\b/,
  /\b[TP]\d+(?:\.\d+)*\b/,
  /\b(?:phase|round)[ -]\d+\b/i,
  /\b[Ss]tage [A-Z]\b/,
  /\bplan exceptions?\b/i,
  /\b(?:issue|ticket|PR|pull request)s? #?\d+\b/i,
];
// Four repeated ASCII divider characters, or two box-drawing characters, make a banner.
const BANNER_PATTERN = /([-=_~#*+])\1{3,}|[\u2500-\u257f]{2,}/;
const LIST_ITEM = /^(?:[-*+\u2022]|\d+[.)]|\(\w{1,3}\)|[a-z][.)])\s/;

function scriptKind(path) {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (path.endsWith(".mjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

// Every comment sits in the trivia before some token. The scanner splits that trivia into the
// previous line's trailing comments and the next token's leading ones, so both are read. JSX text
// is skipped because its characters are copy, not trivia, and JSDoc nodes because they sit inside
// a comment that is already read.
export function extractComments(path, content) {
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, false, scriptKind(path));
  const seen = new Map();
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.JsxText || ts.isJSDoc(node)) return;
    if (node.kind <= ts.SyntaxKind.LastToken || node.kind === ts.SyntaxKind.EndOfFileToken) {
      const ranges = [
        ...(ts.getTrailingCommentRanges(content, node.pos) ?? []),
        ...(ts.getLeadingCommentRanges(content, node.pos) ?? []),
      ];
      for (const range of ranges) seen.set(range.pos, range);
    }
    for (const child of node.getChildren(source)) visit(child);
  };
  visit(source);
  return [...seen.values()]
    .sort((a, b) => a.pos - b.pos)
    .map((range) => ({
      text: content.slice(range.pos, range.end),
      line: source.getLineAndCharacterOfPosition(range.pos).line + 1,
      doc: content.startsWith("/**", range.pos) && !content.startsWith("/**/", range.pos),
    }));
}

function findTicket(line) {
  const text = line.replace(URL_PATTERN, "");
  return TICKET_PATTERNS.some((pattern) => pattern.test(text));
}

// A TSDoc continuation line may be indented only inside a fence, an @example block, or a list.
function hangingIndentLines(text) {
  const lines = text.split("\n");
  const flagged = [];
  let fenced = false;
  let example = false;
  let list = false;
  for (let index = 1; index < lines.length; index++) {
    const match = lines[index].match(/^\s*\*(?!\/)( ?)(\s*)(.*)$/);
    if (!match) continue;
    const [, , indent, body] = match;
    if (body.startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (fenced || body === "") continue;
    if (body.startsWith("@")) {
      example = body.startsWith("@example");
      list = false;
      if (indent !== "") flagged.push(index);
      continue;
    }
    if (LIST_ITEM.test(body)) {
      list = true;
    } else if (indent === "") {
      list = false;
    } else if (!example && !list) {
      flagged.push(index);
    }
  }
  return flagged;
}

function commentFindings(comment) {
  const findings = [];
  const lines = comment.text.split("\n");
  const add = (offset, rule) => findings.push({ line: comment.line + offset, rule });
  lines.forEach((line, offset) => {
    if (findTicket(line)) add(offset, "ticket reference");
    if (line.includes("—")) add(offset, "em-dash");
    if (BANNER_PATTERN.test(line)) add(offset, "section banner");
  });
  if (comment.doc) for (const offset of hangingIndentLines(comment.text)) add(offset, "hanging TSDoc indent");
  if (/\b(?:TODO|FIXME)\b/.test(comment.text) && !ISSUE_URL.test(comment.text)) {
    add(
      lines.findIndex((line) => /\b(?:TODO|FIXME)\b/.test(line)),
      "TODO without issue URL",
    );
  }
  return findings;
}

/** Return `{ path, line, rule }` findings for one source file, ordered by line. */
export function evaluateCommentVoice(path, content) {
  return extractComments(path, content)
    .flatMap(commentFindings)
    .map((finding) => ({ path, ...finding }))
    .sort((a, b) => a.line - b.line);
}

// `git ls-files` lists tracked files only, so ignored and generated output is never scanned.
export function collectSourceFiles(root) {
  const result = spawnSync("git", ["ls-files", "-z", "--", "src", "shared", "server/src"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ls-files failed: ${result.stderr.trim()}`);
  return result.stdout
    .split("\0")
    .filter((path) => SOURCE_PATTERN.test(path) && !path.startsWith("src/paraglide/"))
    .sort();
}

function main() {
  try {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const paths = collectSourceFiles(root);
    const findings = paths.flatMap((path) => evaluateCommentVoice(path, readFileSync(join(root, path), "utf8")));
    if (findings.length === 0) {
      console.log(`Comment-voice check passed: ${paths.length} source files.`);
      return;
    }
    for (const { path, line, rule } of findings) console.error(`${path}:${line}: ${rule}`);
    console.error(`Comment-voice check failed: ${findings.length} findings. See DEFENSIVE-CODING.md section 7.`);
    process.exitCode = 1;
  } catch (error) {
    console.error(`Comment-voice check failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main();
