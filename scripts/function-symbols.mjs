function expressionName(node) {
  if (!node) return "anonymous";
  if (node.type === "Identifier") return node.name;
  if (node.type === "PrivateIdentifier") return `#${node.name}`;
  if (node.type === "Literal") return typeof node.value === "bigint" ? `${node.value}n` : JSON.stringify(node.value);
  if (node.type === "MemberExpression") return `${expressionName(node.object)}.${expressionName(node.property)}`;
  if (node.type === "CallExpression") return expressionName(node.callee);
  return "[expression]";
}

function callbackName(call) {
  const title = call.arguments.find((argument) => argument.type === "Literal" && typeof argument.value === "string");
  return `${expressionName(call.callee)}${title ? `(${JSON.stringify(title.value)})` : ""} callback`;
}

const propertyTypes = new Set(["MethodDefinition", "Property", "PropertyDefinition"]);

function propertyName(parent) {
  const kind = parent.kind === "get" || parent.kind === "set" ? `${parent.kind} ` : "";
  return `${parent.static ? "static " : ""}${kind}${expressionName(parent.key)}`;
}

function ownerName(parent, properties) {
  if (parent.type === "ClassDeclaration" || parent.type === "ClassExpression") {
    const name = parent.id?.name ?? parent.parent?.id?.name ?? "anonymous class";
    return `${name}.${properties.join(".") || "static"}`;
  }
  if (parent.type === "VariableDeclarator") return [expressionName(parent.id), ...properties].join(".");
  if (parent.type === "AssignmentExpression") return [expressionName(parent.left), ...properties].join(".");
  if (parent.type === "ExportDefaultDeclaration") return "default";
  return null;
}

function localName(node) {
  if (node.id?.name) return node.id.name;
  const properties = [];
  let callback;
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (/^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(parent.type)) break;
    if (propertyTypes.has(parent.type)) properties.unshift(propertyName(parent));
    const owner = ownerName(parent, properties);
    if (owner) return owner;
    if (parent.type === "CallExpression" && !callback) callback = callbackName(parent);
  }
  return properties.join(".") || callback || "anonymous";
}

/**
 * Build readable identities from lexical ownership and syntax, independent of line numbers.
 * Repeated anonymous/callsite names use occurrence suffixes within the same owner. Their
 * order remains significant; moving indistinguishable callbacks requires baseline review.
 * Origin distinguishes implicit initializers from arrows sharing the same AST range.
 */
export function createFunctionSymbols() {
  const occurrences = new Map();
  return (node, origin, owner) => {
    const local = `${origin}:${localName(node)}`;
    const base = owner ? `${owner}/${local}` : local;
    const count = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, count);
    return count === 1 ? base : `${base}#${count}`;
  };
}
