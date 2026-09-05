function location(node) {
  return { range: node.range, loc: node.loc };
}

function expressionStatement(expression) {
  return { type: "ExpressionStatement", expression, ...location(expression) };
}

function bindingsStatement(patterns, node) {
  return {
    type: "VariableDeclaration",
    kind: "let",
    declarations: patterns.map((id) => ({ type: "VariableDeclarator", id, init: null, ...location(id) })),
    ...location(node),
  };
}

function bindingsRegion(patterns, expression) {
  const first = patterns[0];
  const last = patterns.at(-1);
  const span = first
    ? { range: [first.range[0], last.range[1]], loc: { start: first.loc.start, end: last.loc.end } }
    : expression;
  return ["bindings", [bindingsStatement(patterns, span)], span];
}

function expressionBodies(expression) {
  if (expression.type === "VOnExpression") return [["handler", expression.body, expression]];
  if (expression.type === "VForExpression") {
    return [
      ["iterable", [expressionStatement(expression.right)], expression.right],
      bindingsRegion(expression.left, expression),
    ];
  }
  if (expression.type === "VSlotScopeExpression") {
    return [bindingsRegion(expression.params, expression)];
  }
  if (expression.type.startsWith("V")) throw new Error(`Unsupported Vue expression: ${expression.type}`);
  return [["expression", [expressionStatement(expression)], expression]];
}

function containerName(container) {
  const parent = container.parent;
  const key = parent.type === "VDirectiveKey" ? parent : parent.key;
  const labels = [];
  for (let ancestor = parent; ancestor; ancestor = ancestor.parent) {
    if (ancestor.type === "VElement") labels.unshift(ancestor.rawName);
  }
  if (!key) return `${labels.join("/")}:${parent.name === "style" ? "css-binding" : "interpolation"}`;
  const argument = key.argument?.name ?? (key.argument ? "dynamic" : "none");
  return `${labels.join("/")}:${key.name.name}:${argument}:${parent === key ? "argument" : "value"}`;
}

/**
 * Clone syntax children without copying Vue parent/reference graphs. ESLint may attach its
 * own parents; original parser nodes and source coordinates must remain unchanged.
 */
export function cloneMetricAst(node, visitorKeys) {
  if (!node) return node;
  const copy = { ...node };
  delete copy.parent;
  delete copy.templateBody;
  const keys = visitorKeys[node.type];
  if (!keys) throw new Error(`Missing metric visitor keys: ${node.type}`);
  for (const key of keys) {
    const child = node[key];
    copy[key] = Array.isArray(child)
      ? child.map((entry) => cloneMetricAst(entry, visitorKeys))
      : cloneMetricAst(child, visitorKeys);
  }
  return copy;
}

/**
 * Normalize authored Vue JavaScript regions to independent programs, without generating
 * render callbacks. Loop iterables and alias bindings stay separate. Nested real functions
 * retain their syntax and receive the ordinary function budgets through the shared collector.
 * Semantic labels survive line movement; indistinguishable regions use occurrence suffixes.
 */
export function createVueMetricRegions(containers, document, visitorKeys) {
  const occurrences = new Map();
  return containers.flatMap((container) => {
    // Empty directive values/interpolations contain no executable syntax. The caller rejects
    // document parse errors before reaching here, including recovered null expressions.
    if (!container.expression) return [];
    return expressionBodies(container.expression).map(([kind, body, node]) => {
      const name = `${containerName(container)}:${kind}`;
      const count = (occurrences.get(name) ?? 0) + 1;
      occurrences.set(name, count);
      return {
        symbol: `region:${name}${count === 1 ? "" : `#${count}`}`,
        ast: {
          type: "Program",
          sourceType: "module",
          body: body.map((statement) => cloneMetricAst(statement, visitorKeys)),
          tokens: document.tokens.filter(({ range }) => range[0] >= node.range[0] && range[1] <= node.range[1]),
          comments: document.comments,
          ...location(node),
        },
      };
    });
  });
}
