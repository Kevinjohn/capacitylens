/** A source dependency with its initialization behavior and one-based source line. */
export type DependencyEdge = { kind: "runtime" | "type"; line: number } & (
  { specifier: string } | { specifier: null; expression: string }
);

/** Resolved internal paths are absolute; unresolved and nonliteral edges need explicit handling. */
export type DependencyResolution =
  { classification: "internal"; path: string } | { classification: "external" | "unresolved" | "nonliteral" };

/** Parse source syntax; inline type bindings follow the supplied compiler setting. */
export function parseDependencies(
  source: string,
  filename: string,
  options?: { verbatimModuleSyntax?: boolean },
): DependencyEdge[];

/** Resolve repository-relative and workspace imports without loading their modules. */
export function resolveDependency(specifier: string | null, filename: string, root: string): DependencyResolution;

/** Read effective package compiler settings once. Throws for missing or invalid configurations. */
export function createDependencyParser(root: string): (source: string, filename: string) => DependencyEdge[];
