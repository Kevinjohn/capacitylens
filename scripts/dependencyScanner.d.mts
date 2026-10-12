/** A source dependency with its initialization behavior and one-based source line. */
export type DependencyEdge = {
  kind: "runtime" | "type";
  line: number;
  /** Original names of erased named bindings. Absent for namespace/default/module references and runtime edges. */
  typeNames?: string[];
} & ({ specifier: string } | { specifier: null; expression: string });

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

/**
 * Reads effective package compiler settings once.
 * @throws When project configuration is missing, invalid or inherits unreadable configuration.
 */
export function createDependencyParser(root: string): (source: string, filename: string) => DependencyEdge[];
