import { analyze } from "@typescript-eslint/scope-manager";
import postcss from "postcss";
import tseslint from "typescript-eslint";
import vueParser from "vue-eslint-parser";
import { measureWithParser } from "./function-metrics.mjs";
import { cloneMetricAst, createVueMetricRegions } from "./vue-metric-regions.mjs";

const languages = {
  script: new Set(["", "js", "ts", "jsx", "tsx"]),
  template: new Set(["", "html"]),
  style: new Set(["", "css"]),
};

function validateBlock(block) {
  const attributes = new Map(block.startTag.attributes.map(({ key, value }) => [key.name, value?.value ?? ""]));
  const language = attributes.get("lang") ?? "";
  if (!languages[block.name]?.has(language) || attributes.has("src")) {
    throw new Error(`Unsupported Vue block: ${block.name} lang=${language || "default"} or external src`);
  }
  if (!block.endTag && !block.startTag.selfClosing) throw new Error(`Unclosed Vue block: ${block.name}`);
  return block.name === "script" && attributes.has("setup") ? "script:setup" : block.name;
}

function validateBlocks(document, source, filename) {
  const seen = new Set();
  for (const block of document.children.filter(({ type }) => type === "VElement")) {
    const kind = validateBlock(block);
    if (block.name !== "style" && seen.has(kind)) throw new Error(`Duplicate Vue block: ${kind}`);
    seen.add(kind);
    if (block.name === "style") {
      // Vue's expression parser can skip an unterminated v-bind(). Validate CSS delimiters
      // first so malformed embedded JavaScript cannot disappear from the measurement.
      postcss.parse(source.slice(block.startTag.range[1], block.endTag?.range[0] ?? block.range[1]), {
        from: filename,
      });
    }
  }
}

function parseVue(source, filename) {
  const parsed = vueParser.parseForESLint(source, {
    parser: tseslint.parser,
    ecmaVersion: "latest",
    sourceType: "module",
    filePath: filename,
    range: true,
    loc: true,
    tokens: true,
    comment: true,
    ecmaFeatures: { jsx: true },
    vueFeatures: { filter: false },
  });
  const document = parsed.services.getDocumentFragment();
  // Self-closing native tags are valid in Vue SFCs. This is the same single HTML
  // diagnostic disabled by eslint-plugin-vue's default no-parsing-error policy.
  const errors = document.errors.filter(({ code }) => code !== "non-void-html-element-start-tag-with-trailing-solidus");
  if (errors.length) throw new Error(errors.map(({ message }) => message).join("; "));
  validateBlocks(document, source, filename);
  const containers = [];
  vueParser.AST.traverseNodes(document, {
    enterNode(node) {
      if (node.type === "VExpressionContainer") containers.push(node);
    },
    leaveNode() {},
  });
  return { parsed, document, containers };
}

/**
 * Measure authored SFC script control flow/functions, template JavaScript and CSS v-bind expressions.
 * Both script blocks share a module scope; empty script programs add no artificial region.
 * Embedded regions have their own length/complexity/depth; nested real functions retain
 * independent metrics. Template markup remains subject to the physical file budget.
 * Vue-generated render branches/callbacks are not authored JavaScript and are not invented
 * here. Reject unsupported blocks/languages, external sources and recovered parse errors.
 * Parsing never executes code and preserves original source lines and comment ranges.
 */
export function measureVueFunctions(source, filename) {
  if (!filename.endsWith(".vue")) throw new Error(`Unsupported Vue source: ${filename}`);
  try {
    const { parsed, document, containers } = parseVue(source, filename);
    const programs = [
      { ast: cloneMetricAst(parsed.ast, parsed.visitorKeys), symbol: null },
      ...createVueMetricRegions(containers, document, parsed.visitorKeys),
    ];
    return programs
      .filter(({ ast }) => ast.body.length > 0)
      .flatMap(({ ast, symbol }) => {
        const parser = {
          parseForESLint() {
            return { ast, visitorKeys: parsed.visitorKeys, scopeManager: analyze(ast, { sourceType: "module" }) };
          },
        };
        return measureWithParser(source, filename, { parser, sourceType: "module" }, symbol);
      });
  } catch (error) {
    throw new Error(`Cannot measure ${filename}: ${error.message}`, { cause: error });
  }
}
