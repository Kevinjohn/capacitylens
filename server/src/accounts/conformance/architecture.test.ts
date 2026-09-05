import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, relative, resolve, sep } from "node:path";

import { createDependencyParser, resolveDependency } from "../../../../scripts/dependency-scanner.mjs";
import type { DependencyEdge } from "../../../../scripts/dependency-scanner.mjs";

const serverRoot = resolve(import.meta.dirname, "../..");
const sharedRoot = resolve(serverRoot, "../../shared/src");
const sharedAccountRoot = resolve(sharedRoot, "account");
const browserRoot = resolve(serverRoot, "../../src");
const repositoryRoot = resolve(serverRoot, "../..");
const parseDependencies = createDependencyParser(repositoryRoot);

const boundaryLocations = {
  productRoutes: ["app.ts", "routes"],
  coordinators: ["accounts/localAccountFlows.ts", "accounts/flows"],
  accountRoutes: ["accounts/accountRoutes.ts", "accounts/routes"],
  authBuilders: ["auth.ts", "authConfig"],
} as const;

function boundaryPaths(root: string, boundary: keyof typeof boundaryLocations): string[] {
  const [facade, directory] = boundaryLocations[boundary];
  return [facade, ...sourceFiles(resolve(root, directory)).map((file) => relative(root, file))];
}
const appBoundaryFiles = boundaryPaths(serverRoot, "productRoutes");

// `account` is Better Auth's singular provider-link table; CapacityLens product workspaces use
// the plural `accounts`, so it can be enforced here without confusing the two ownership zones.
const sqlTableOperation = String.raw`\b(?:FROM|JOIN|INTO|UPDATE|DELETE\s+FROM|(?:CREATE\s+)?TABLE(?:\s+IF\s+NOT\s+EXISTS)?|ALTER\s+TABLE|DROP\s+TABLE)\s+(?:["'\x60]|\[)?(?:\w+\.)?(?:["'\x60]|\[)?`;
const identitySql = new RegExp(`${sqlTableOperation}(?:user|session|account|verification|twoFactor)\\b`, "i");
const accountSql = new RegExp(`${sqlTableOperation}(?:account_members|invites)\\b`, "i");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    const source = /\.(?:[cm]?[jt]sx?)$/.test(entry.name);
    const test = /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/.test(entry.name);
    return source && !test ? [path] : [];
  });
}

function internalImports(file: string, include: (edge: DependencyEdge, target: string) => boolean): string[] {
  const dependencies = new Set<string>();
  for (const edge of parseDependencies(readFileSync(file, "utf8"), file)) {
    const resolved = resolveDependency(edge.specifier, file, repositoryRoot);
    if (resolved.classification === "unresolved" || resolved.classification === "nonliteral") {
      const target = edge.specifier === null ? edge.expression : edge.specifier;
      throw new Error(`${relative(repositoryRoot, file)}:${edge.line}: ${resolved.classification} import ${target}`);
    }
    if (resolved.classification === "internal" && include(edge, resolved.path)) dependencies.add(resolved.path);
  }
  return [...dependencies];
}

const runtimeImports = (file: string): string[] => internalImports(file, (edge) => edge.kind === "runtime");

// These three concrete adapter contracts remain migration debt for T15. Only the named type
// edges are tolerated; another consumer, a runtime import or a duplicate declaration fails.
const adapterTypeDebt = [
  ["accounts/localAccountFlows.ts", "accounts/betterAuthIdentityPort.ts", "LocalIdentityPort"],
  ["accounts/localAccountFlows.ts", "accounts/sqliteAccountAdminPort.ts", "LocalAccountAdminPort"],
  ["accounts/flows/actorContext.ts", "accounts/sqliteAccountAdminPort.ts", "LocalAccountAdminPort"],
] as const;
function isOwnershipTypeBoundary(
  file: string,
  kind: DependencyEdge["kind"],
  target: string,
  names: readonly string[] = [],
): boolean {
  if (kind !== "type" || names.length !== 1) return false;
  // Db is the public DatabaseSync alias, not permission to import database initialization.
  // Its type-only facade is a terminal contract; runtime edges still traverse every export.
  if (target === resolve(serverRoot, "db.ts")) return names[0] === "Db";
  return adapterTypeDebt.some(
    ([from, to, name]) => file === resolve(serverRoot, from) && target === resolve(serverRoot, to) && names[0] === name,
  );
}
const ownershipImports = (file: string): string[] =>
  internalImports(file, (edge, target) => !isOwnershipTypeBoundary(file, edge.kind, target, edge.typeNames));

function importSpecifiers(file: string): string[] {
  return parseDependencies(readFileSync(file, "utf8"), file).flatMap((edge) => edge.specifier ?? []);
}
function isAuthVendor(specifier: string): boolean {
  return specifier === "better-auth" || specifier.startsWith("better-auth/");
}
function isAccountState(file: string): boolean {
  return (
    file === resolve(serverRoot, "accounts/state.ts") || file.startsWith(resolve(serverRoot, "accounts/state") + sep)
  );
}
function isControlTable(file: string): boolean {
  return (
    file === resolve(serverRoot, "controlTables.ts") || file.startsWith(resolve(serverRoot, "controlTables") + sep)
  );
}
function isRowMapperType(
  file: string,
  kind: DependencyEdge["kind"],
  target: string,
  names: readonly string[] = [],
): boolean {
  // The storage adapter maps an AccountMember row into the shared Membership contract.
  // It may name that one row facade but may not acquire executable control-table access.
  return (
    kind === "type" &&
    names.length === 1 &&
    names[0] === "AccountMember" &&
    file === resolve(serverRoot, "accounts/adminPort/mappers.ts") &&
    target === resolve(serverRoot, "controlTables.ts")
  );
}

function dependencyPath(
  start: string,
  forbidden: ReadonlySet<string>,
  forbiddenPrefixes: readonly string[] = [],
  dependencies: (file: string) => readonly string[] = runtimeImports,
): string[] | null {
  const queue: string[][] = [[start]];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const path = queue.shift()!;
    const current = path.at(-1)!;
    if (visited.has(current)) continue;
    visited.add(current);
    if (current !== start && (forbidden.has(current) || forbiddenPrefixes.some((prefix) => current.startsWith(prefix))))
      return path;
    for (const dependency of dependencies(current)) queue.push([...path, dependency]);
  }
  return null;
}

function displayPath(path: readonly string[]): string {
  return path.map((file) => relative(serverRoot, file)).join(" -> ");
}

const read = (rel: string): string => readFileSync(resolve(serverRoot, rel), "utf8");
const localAccountFlowsPath = "accounts/localAccountFlows.ts";
const coordinatorPaths = boundaryPaths(serverRoot, "coordinators");
const accountRoutePaths = boundaryPaths(serverRoot, "accountRoutes");

describe("account-boundary architecture", () => {
  it("keeps the shared contract free of UI, transport, persistence, and auth-vendor imports", () => {
    for (const file of sourceFiles(sharedAccountRoot)) {
      const source = readFileSync(file, "utf8");
      expect(
        importSpecifiers(file).filter((specifier) =>
          ["react", "fastify", "better-auth", "node:sqlite", "sqlite3", "@fastify"].some(
            (owner) => specifier === owner || specifier.startsWith(owner + "/"),
          ),
        ),
        file,
      ).toEqual([]);
      expect(source, file).not.toContain("/server/");
      expect(source, file).not.toContain("scheduler");
      expect(source, file).not.toContain("timeOff");
    }
  });

  it("keeps coordinator persistence behind transaction and command-ledger seams", () => {
    for (const file of coordinatorPaths) {
      const source = read(file);
      expect(source, file).not.toMatch(/\.prepare\s*\(|\b(?:SELECT|INSERT|UPDATE|DELETE)\b/);
      expect(internalImports(resolve(serverRoot, file), () => true).filter(isAccountState), file).toEqual([]);
      expect(source, file).not.toMatch(/ROLE_RANK|MIN_(?:ADMIN_)?TIER/);
      expect(source, file).not.toMatch(/(?:===|!==)\s*['"](?:owner|admin|editor|viewer)['"]/);
    }

    // Concrete adapters and the auth/erasure facades stay outside coordinator ownership.
    // Their private submodules are covered by directory prefixes rather than an expanding list.
    const forbidden = new Set(
      [
        "auth.ts",
        "controlTables.ts",
        "erasure.ts",
        "accounts/betterAuthIdentityPort.ts",
        "accounts/sqliteAccountAdminPort.ts",
      ].map((path) => resolve(serverRoot, path)),
    );
    const forbiddenPrefixes = ["accounts/identityPort", "accounts/adminPort", "controlTables", "authConfig"].map(
      (p) => resolve(serverRoot, p) + sep,
    );
    for (const file of coordinatorPaths) {
      const path = dependencyPath(resolve(serverRoot, file), forbidden, forbiddenPrefixes, ownershipImports);
      expect(path ? displayPath(path) : null, file).toBeNull();
    }
  });

  it.each([
    [
      "calibrates the transitive dependency scanner against a known adapter edge",
      resolve(serverRoot, "accounts/adminPort/invitations.ts"),
      resolve(serverRoot, "controlTables.ts"),
      ["accounts/adminPort/invitations.ts", "controlTables.ts"],
    ],
    [
      "follows workspace aliases as well as relative imports",
      resolve(serverRoot, localAccountFlowsPath),
      resolve(sharedAccountRoot, "errors.ts"),
      ["accounts/localAccountFlows.ts", "../../shared/src/account/errors.ts"],
    ],
  ] as const)("%s", (_name, start, target, expected) => {
    const path = dependencyPath(start, new Set([target]));
    expect(path?.map((file) => relative(serverRoot, file))).toEqual(expected);
  });

  it("single-sources account-administration thresholds behind the account policy seam", () => {
    const productPolicy = read("../../shared/src/domain/access.ts");
    const accountPolicy = readFileSync(resolve(sharedAccountRoot, "policy.ts"), "utf8");
    const productThresholds = productPolicy.match(/const MIN_TIER = \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(productThresholds).not.toMatch(
      /manageMembers|manageInvites|manageMemberSignInTracking|deleteAccount|transferOwnership/,
    );
    expect(productPolicy).toContain("canAdministerAccount(role, accountAction)");
    expect(accountPolicy).toMatch(/['"]manage-members['"]:\s*['"]admin['"]/);
    expect(accountPolicy).toMatch(/['"]manage-invitations['"]:\s*['"]admin['"]/);
    expect(accountPolicy).toMatch(/['"]manage-member-sign-in-tracking['"]:\s*['"]owner['"]/);
    expect(accountPolicy).toMatch(/['"]transfer-ownership['"]:\s*['"]owner['"]/);
    expect(accountPolicy).toMatch(/['"]erase-workspace['"]:\s*['"]owner['"]/);
  });

  it("makes account and identity storage ownership deny-by-default across production source", () => {
    const production = sourceFiles(serverRoot);
    // Raw identity SQL belongs to the vendor lifecycle and concrete identity-port implementations.
    // A newly added sibling is denied until its specific storage responsibility is reviewed here.
    const identitySqlOwners = new Set([
      resolve(serverRoot, "auth.ts"),
      resolve(serverRoot, "authConfig/authAdapter.ts"),
      resolve(serverRoot, "authConfig/bootstrapAdmin.ts"),
      resolve(serverRoot, "authConfig/federatedIdentitySchema.ts"),
      resolve(serverRoot, "authConfig/sessionActivity.ts"),
      resolve(serverRoot, "accounts/identityPort/credentials.ts"),
      resolve(serverRoot, "accounts/identityPort/cutover.ts"),
      resolve(serverRoot, "accounts/identityPort/erasure.ts"),
      resolve(serverRoot, "accounts/identityPort/federatedLinks.ts"),
      resolve(serverRoot, "accounts/identityPort/inspection.ts"),
      resolve(serverRoot, "accounts/identityPort/sessionRevocation.ts"),
      resolve(serverRoot, "accounts/identityPort/sessions.ts"),
    ]);
    // Product membership/invitation SQL is confined to schema/lifecycle owners, the control-table
    // implementation and the two named operations that update tracking or settle invitations.
    const accountSqlOwners = new Set([
      resolve(serverRoot, "db/lifecycle.ts"),
      resolve(serverRoot, "db/migrations/index.ts"),
      resolve(serverRoot, "controlTables/assert.ts"),
      resolve(serverRoot, "controlTables/inviteRetention.ts"),
      resolve(serverRoot, "controlTables/invites.ts"),
      resolve(serverRoot, "controlTables/members.ts"),
      resolve(serverRoot, "controlTables/ownershipMigrations.ts"),
      resolve(serverRoot, "controlTables/retentionV24.ts"),
      resolve(serverRoot, "accounts/memberSignInTracking.ts"),
      resolve(serverRoot, "accounts/adminPort/invitations.ts"),
    ]);
    // Database bootstrap and the concrete account-admin adapter compose control-table operations.
    // Routes and coordinators consume their ports instead; this list never grants directory access.
    const controlTableImporters = new Set([
      resolve(serverRoot, "db/open.ts"),
      resolve(serverRoot, "db/migrations/index.ts"),
      resolve(serverRoot, "controlTables.ts"),
      resolve(serverRoot, "controlTables/inviteRetention.ts"),
      resolve(serverRoot, "controlTables/invites.ts"),
      resolve(serverRoot, "controlTables/members.ts"),
      resolve(serverRoot, "controlTables/ownershipMigrations.ts"),
      resolve(serverRoot, "controlTables/retentionV24.ts"),
      resolve(serverRoot, "accounts/adminPort/authority.ts"),
      resolve(serverRoot, "accounts/adminPort/cutover.ts"),
      resolve(serverRoot, "accounts/adminPort/invitationClaims.ts"),
      resolve(serverRoot, "accounts/adminPort/invitations.ts"),
      resolve(serverRoot, "accounts/adminPort/membership.ts"),
    ]);

    for (const file of production) {
      const source = readFileSync(file, "utf8");
      if (!identitySqlOwners.has(file)) expect(source, relative(serverRoot, file)).not.toMatch(identitySql);
      if (!accountSqlOwners.has(file)) expect(source, relative(serverRoot, file)).not.toMatch(accountSql);
      if (!controlTableImporters.has(file)) {
        const dependencies = internalImports(
          file,
          (edge, target) => !isRowMapperType(file, edge.kind, target, edge.typeNames),
        );
        expect(dependencies.filter(isControlTable), relative(serverRoot, file)).toEqual([]);
      }
      // `authConfig/` holds the named builders that assemble authFromEnv's Better Auth options; it
      // is the same ownership zone as auth.ts, split into files, not a new consumer of the library.
      const betterAuthOwner =
        [resolve(serverRoot, "auth.ts"), resolve(serverRoot, "strictOidc.ts")].includes(file) ||
        file.startsWith(resolve(serverRoot, "authConfig") + sep);
      if (!betterAuthOwner) {
        expect(importSpecifiers(file).filter(isAuthVendor), relative(serverRoot, file)).toEqual([]);
      }
    }
  });

  it("prevents product routes from reaching identity or membership storage directly", () => {
    for (const file of appBoundaryFiles) {
      const source = read(file);
      expect(internalImports(resolve(serverRoot, file), () => true).filter(isControlTable), file).toEqual([]);
      expect(source).not.toMatch(/\b(?:user|session|account_members|invites)\b[^\n]*\.prepare\s*\(/);
      expect(importSpecifiers(resolve(serverRoot, file)).filter(isAuthVendor), file).toEqual([]);
    }
  });

  it("keeps invitation and member administration in the account HTTP adapter", () => {
    const accountRoutes = read("accounts/accountRoutes.ts");
    const extractedPaths = [
      "/api/invites",
      "/api/invites/:token/preview",
      "/api/invites/:token/accept",
      "/api/invites/:token/signup",
      "/api/accounts/:accountId/members",
      "/api/accounts/:accountId/members/:userId",
      "/api/accounts/:accountId/transfer-ownership",
      "/api/accounts/:accountId/members/:userId/reset-password",
      "/api/accounts/:accountId/members/:userId/revoke-sessions",
      "/api/accounts/:accountId/invites",
      "/api/accounts/:accountId/invites/:id",
    ];
    for (const path of extractedPaths) {
      // Match either quote style: the route string is the invariant, not how the formatter quotes it.
      const quoted = new RegExp(`['"]${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"]`);
      expect(accountRoutes, path).toMatch(quoted);
      for (const file of appBoundaryFiles) expect(read(file), `${file}: ${path}`).not.toMatch(quoted);
    }
    for (const file of accountRoutePaths) {
      const source = read(file);
      expect(
        internalImports(resolve(serverRoot, file), () => true).filter(
          (target) => isControlTable(target) || target === resolve(serverRoot, "accounts/betterAuthIdentityPort.ts"),
        ),
        file,
      ).toEqual([]);
      expect(source, file).not.toMatch(/\.prepare\s*\(|\b(?:SELECT|INSERT|UPDATE|DELETE FROM)\b/);
    }
  });

  it("keeps invitation SQL out of the auth-vendor adapter", () => {
    for (const path of boundaryPaths(serverRoot, "authBuilders")) {
      const source = read(path);
      expect(source).not.toMatch(/\b(?:FROM|INTO|UPDATE|DELETE FROM)\s+invites\b/i);
      expect(internalImports(resolve(serverRoot, path), () => true).filter(isControlTable), path).toEqual([]);
      if (path !== "auth.ts") {
        expect(runtimeImports(resolve(serverRoot, path)), path).not.toContain(resolve(serverRoot, "auth.ts"));
      }
    }
  });

  it("centralizes executable browser account URLs in the account client", () => {
    const accountClient = resolve(browserRoot, "account/accountClient.ts");
    for (const file of sourceFiles(browserRoot)) {
      if (file === accountClient) continue;
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/fetch\s*\([^\n]*(?:\/api\/(?:auth\/me|accounts|invites|orgs))/);
      expect(source, file).not.toMatch(/apiFetch(?:Reauth)?\s*\([^\n]*(?:\/api\/(?:accounts|invites|orgs))/);
    }
  });
});

describe("scanner calibration", () => {
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), "architecture-scanner-"));
  afterAll(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  function fixture(name: string, source: string): string {
    const file = resolve(fixtureRoot, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source);
    return file;
  }

  it.each(["productRoutes", "coordinators", "accountRoutes", "authBuilders"] as const)(
    "includes a newly added nested sibling in the %s boundary",
    (boundary) => {
      const root = resolve(fixtureRoot, boundary);
      const [facade, directory] = boundaryLocations[boundary];
      fixture(`${boundary}/${facade}`, "export {};");
      const sibling = fixture(`${boundary}/${directory}/new/nested.ts`, "export {};");
      const test = fixture(`${boundary}/${directory}/new/nested.test.ts`, "export {};");
      const paths = boundaryPaths(root, boundary);
      expect(paths).toEqual([facade, relative(root, sibling)]);
      expect(paths).not.toContain(relative(root, test));
    },
  );

  it.each(["void import(`better-auth/plugins`);", 'import type { Auth } from "better-auth";'])(
    "identifies vendor ownership regardless of import syntax: %s",
    (source) => {
      expect(importSpecifiers(fixture("vendor.ts", source)).filter(isAuthVendor)).toHaveLength(1);
      expect(isAuthVendor("better-authentication")).toBe(false);
    },
  );

  it("pins the public Db alias and never exempts its runtime imports", () => {
    const db = resolve(serverRoot, "db.ts");
    expect(read("db.ts")).toMatch(/^export type Db = DatabaseSync;$/m);
    expect(
      parseDependencies(read("db.ts"), db)
        .filter((edge) => edge.specifier === "node:sqlite")
        .map((edge) => edge.kind),
    ).toEqual(["type"]);
    expect(isOwnershipTypeBoundary("consumer.ts", "type", db, ["Db"])).toBe(true);
    expect(isOwnershipTypeBoundary("consumer.ts", "runtime", db, ["Db"])).toBe(false);
    expect(isOwnershipTypeBoundary("consumer.ts", "type", db, ["Db", "DatabaseMigrationPlan"])).toBe(false);
    expect(isOwnershipTypeBoundary("consumer.ts", "type", db)).toBe(false);
  });

  it.each(adapterTypeDebt)("keeps the T15 type-debt edge %s -> %s (%s) exact and non-growing", (from, to, name) => {
    const file = resolve(serverRoot, from),
      target = resolve(serverRoot, to);
    const edges = parseDependencies(read(from), file).filter((edge) => {
      const resolved = resolveDependency(edge.specifier, file, repositoryRoot);
      return resolved.classification === "internal" && resolved.path === target;
    });
    expect(edges).toHaveLength(1);
    expect(edges[0]?.kind).toBe("type");
    expect(edges[0]?.typeNames).toEqual([name]);
    expect(isOwnershipTypeBoundary(file, "type", target, [name])).toBe(true);
    expect(isOwnershipTypeBoundary(file, "type", target, [name, "Other"])).toBe(false);
    expect(isOwnershipTypeBoundary(file, "runtime", target, [name])).toBe(false);
    expect(isOwnershipTypeBoundary(resolve(fixtureRoot, "new-consumer.ts"), "type", target, [name])).toBe(false);
  });

  it("permits only the storage mapper's named row-type dependency", () => {
    const file = resolve(serverRoot, "accounts/adminPort/mappers.ts"),
      target = resolve(serverRoot, "controlTables.ts");
    const edges = parseDependencies(readFileSync(file, "utf8"), file).filter((edge) => {
      const resolved = resolveDependency(edge.specifier, file, repositoryRoot);
      return resolved.classification === "internal" && resolved.path === target;
    });
    expect(edges).toHaveLength(1);
    expect(edges[0]?.kind).toBe("type");
    expect(edges[0]?.typeNames).toEqual(["AccountMember"]);
    expect(isRowMapperType(file, "type", target, ["AccountMember"])).toBe(true);
    expect(isRowMapperType(file, "type", target, ["AccountMember", "Other"])).toBe(false);
    expect(isRowMapperType(file, "runtime", target, ["AccountMember"])).toBe(false);
    expect(isRowMapperType(resolve(fixtureRoot, "new-mapper.ts"), "type", target, ["AccountMember"])).toBe(false);
  });

  it("reports dependencies inside a forbidden directory prefix", () => {
    const a = fixture("a.ts", 'import { value } from "./zone/b.ts";');
    const b = fixture("zone/b.ts", "export const value = 1;");
    expect(dependencyPath(a, new Set(), [resolve(fixtureRoot, "zone") + sep])).toEqual([a, b]);
  });

  it("matches state facades and submodules without matching stateless", () => {
    expect(isAccountState(resolve(serverRoot, "accounts/state.ts"))).toBe(true);
    expect(isAccountState(resolve(serverRoot, "accounts/state/commandLedgerWrites.ts"))).toBe(true);
    expect(isAccountState(resolve(serverRoot, "accounts/stateless.ts"))).toBe(false);
  });

  it("prefers a sibling file over a directory and follows explicit index imports", () => {
    const state = fixture("state.ts", "export const state = {};");
    const index = fixture("state/index.ts", "export const state = {};");
    const consumer = fixture("consumer.ts", 'import { state } from "./state";');
    const indexConsumer = fixture("index-consumer.ts", 'import { state } from "./state/index";');
    expect(runtimeImports(consumer)).toEqual([state]);
    expect(runtimeImports(indexConsumer)).toEqual([index]);
  });

  it("detects protected SQL in an unlisted sibling source file", () => {
    const sibling = fixture("unlisted.ts", 'db.prepare("INSERT INTO account_members VALUES (?)");');
    expect(sourceFiles(fixtureRoot)).toContain(sibling);
    expect(readFileSync(sibling, "utf8")).toMatch(accountSql);
  });

  it.each([
    'import type { T } from "./helper";',
    'export type { T } from "./helper";',
    'void import("./helper");',
    'export * from "./helper";',
  ])("follows ownership dependencies through %s", (source) => {
    const a = fixture("ownership/entry.ts", source);
    const b = fixture("ownership/helper.ts", 'export type { T } from "./forbidden/leaf";');
    const c = fixture("ownership/forbidden/leaf.ts", "export type T = string;");
    expect(dependencyPath(a, new Set(), [resolve(fixtureRoot, "ownership/forbidden") + sep], ownershipImports)).toEqual(
      [a, b, c],
    );
    expect(dependencyPath(b, new Set([c]), [], ownershipImports)).toEqual([b, c]);
  });

  it("rejects unresolved internal edges instead of silently losing ownership checks", () => {
    const source = fixture("unresolved.ts", 'void import("./missing-module");');
    expect(() => runtimeImports(source)).toThrow(/unresolved.*missing-module/);
  });

  it("rejects nonliteral imports until their dependencies are explicitly classified", () => {
    const source = fixture("nonliteral.ts", "void import(modulePath);");
    expect(() => runtimeImports(source)).toThrow(/nonliteral.*modulePath/);
  });

  it.each([
    ['import { value } from "./c";', true],
    ['export { value } from "./c";', true],
    ['export * from "./c";', true],
    ['import "./c";', true],
    ['void import("./c");', true],
    ["void import(`./c`);", true],
    ['import { type T } from "./c";', false],
    ['export { type T } from "./c";', false],
    ['// import { value } from "./c";\nexport const value = 1;', false],
    ['export type { T } from "./c";', false],
    ['import type { T } from "./c";', false],
  ])("traces runtime dependencies through %s", (source, runtime) => {
    const a = fixture("chain/a.ts", 'import { value } from "./b";');
    const b = fixture("chain/b.ts", source);
    const c = fixture("chain/c.ts", "export const value = 1; export type T = string;");
    expect(dependencyPath(a, new Set([c]))).toEqual(runtime ? [a, b, c] : null);
  });
});
