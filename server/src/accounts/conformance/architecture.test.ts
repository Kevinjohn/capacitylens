import { afterAll, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, relative, resolve, sep } from "node:path";

const serverRoot = resolve(import.meta.dirname, "../..");
const sharedRoot = resolve(serverRoot, "../../shared/src");
const sharedAccountRoot = resolve(sharedRoot, "account");
const browserRoot = resolve(serverRoot, "../../src");

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

function resolveModule(base: string): string | undefined {
  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    `${base}.mjs`,
    base,
    resolve(base, "index.ts"),
    resolve(base, "index.tsx"),
  ];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

function runtimeImports(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const imports = new Set([
    ...[...source.matchAll(/import\s+(?!type\b)[\s\S]*?\sfrom\s+['"]([^'"]+)['"]/g)].map((match) => match[1]!),
    ...[...source.matchAll(/(?:import|export)\s*['"]([^'"]+)['"]/g)].map((match) => match[1]!),
    ...[...source.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1]!),
    ...[...source.matchAll(/export\s+(?!type\b)[\s\S]*?\sfrom\s+['"]([^'"]+)['"]/g)].map((match) => match[1]!),
  ]);
  return [...imports].flatMap((specifier) => {
    const base = specifier.startsWith(".")
      ? resolve(dirname(file), specifier)
      : specifier.startsWith("@capacitylens/shared/")
        ? resolve(sharedRoot, specifier.slice("@capacitylens/shared/".length))
        : specifier.startsWith("@/")
          ? resolve(browserRoot, specifier.slice(2))
          : null;
    if (base === null) return [];
    const resolved = resolveModule(base);
    return resolved ? [resolved] : [];
  });
}

function dependencyPath(start: string, forbidden: ReadonlySet<string>): string[] | null {
  const queue: string[][] = [[start]];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const path = queue.shift()!;
    const current = path.at(-1)!;
    if (visited.has(current)) continue;
    visited.add(current);
    if (current !== start && forbidden.has(current)) return path;
    for (const dependency of runtimeImports(current)) queue.push([...path, dependency]);
  }
  return null;
}

function displayPath(path: readonly string[]): string {
  return path.map((file) => relative(serverRoot, file)).join(" -> ");
}

const read = (rel: string): string => readFileSync(resolve(serverRoot, rel), "utf8");
const localAccountFlowsPath = "accounts/localAccountFlows.ts";

describe("account-boundary architecture", () => {
  it("keeps the shared contract free of UI, transport, persistence, and auth-vendor imports", () => {
    for (const file of sourceFiles(sharedAccountRoot)) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/from ['"](?:react|fastify|better-auth|node:sqlite|sqlite3|@fastify\/)['"]/);
      expect(source, file).not.toContain("/server/");
      expect(source, file).not.toContain("scheduler");
      expect(source, file).not.toContain("timeOff");
    }
  });

  it("keeps coordinator persistence behind transaction and command-ledger seams", () => {
    const coordinator = resolve(serverRoot, localAccountFlowsPath);
    const source = read(localAccountFlowsPath);
    expect(source).not.toMatch(/\.prepare\s*\(|\b(?:SELECT|INSERT|UPDATE|DELETE)\b/);
    expect(source).not.toMatch(/from ['"].*(?:controlTables|better-auth)/);
    expect(source).not.toMatch(/from ['"].*\/state['"]/);
    expect(source).not.toMatch(/ROLE_RANK|MIN_(?:ADMIN_)?TIER/);
    expect(source).not.toMatch(/(?:===|!==)\s*['"](?:owner|admin|editor|viewer)['"]/);

    const forbidden = new Set([
      resolve(serverRoot, "auth.ts"),
      resolve(serverRoot, "authConfig/authTypes.ts"),
      resolve(serverRoot, "authConfig/authConstants.ts"),
      resolve(serverRoot, "authConfig/passwordBackpressure.ts"),
      resolve(serverRoot, "authConfig/captureContexts.ts"),
      resolve(serverRoot, "authConfig/authAdapter.ts"),
      resolve(serverRoot, "authConfig/bootstrapAdmin.ts"),
      resolve(serverRoot, "authConfig/federatedIdentitySchema.ts"),
      resolve(serverRoot, "authConfig/sessionActivity.ts"),
      resolve(serverRoot, "authConfig/authFromEnv.ts"),
      resolve(serverRoot, "controlTables.ts"),
      resolve(serverRoot, "erasure.ts"),
      resolve(serverRoot, "accounts/betterAuthIdentityPort.ts"),
      resolve(serverRoot, "accounts/sqliteAccountAdminPort.ts"),
    ]);
    const path = dependencyPath(coordinator, forbidden);
    expect(path ? displayPath(path) : null).toBeNull();
  });

  it.each([
    [
      "calibrates the transitive dependency scanner against a known adapter edge",
      resolve(serverRoot, "accounts/sqliteAccountAdminPort.ts"),
      resolve(serverRoot, "controlTables.ts"),
      ["accounts/sqliteAccountAdminPort.ts", "controlTables.ts"],
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
    const identitySqlOwners = new Set([
      resolve(serverRoot, "auth.ts"),
      resolve(serverRoot, "authConfig/authAdapter.ts"),
      resolve(serverRoot, "authConfig/bootstrapAdmin.ts"),
      resolve(serverRoot, "authConfig/federatedIdentitySchema.ts"),
      resolve(serverRoot, "authConfig/sessionActivity.ts"),
      resolve(serverRoot, "accounts/betterAuthIdentityPort.ts"),
    ]);
    const accountSqlOwners = new Set([
      resolve(serverRoot, "controlTables.ts"),
      resolve(serverRoot, "db.ts"),
      resolve(serverRoot, "accounts/sqliteAccountAdminPort.ts"),
      resolve(serverRoot, "accounts/memberSignInTracking.ts"),
    ]);
    const controlTableImporters = new Set([
      resolve(serverRoot, "db.ts"),
      resolve(serverRoot, "accounts/sqliteAccountAdminPort.ts"),
    ]);

    for (const file of production) {
      const source = readFileSync(file, "utf8");
      if (!identitySqlOwners.has(file)) expect(source, relative(serverRoot, file)).not.toMatch(identitySql);
      if (!accountSqlOwners.has(file)) expect(source, relative(serverRoot, file)).not.toMatch(accountSql);
      if (!controlTableImporters.has(file)) {
        const dependencies = runtimeImports(file);
        expect(dependencies, relative(serverRoot, file)).not.toContain(resolve(serverRoot, "controlTables.ts"));
        expect(
          dependencies.filter((dependency) => dependency.startsWith(resolve(serverRoot, "controlTables") + sep)),
          relative(serverRoot, file),
        ).toEqual([]);
      }
      // `authConfig/` holds the named builders that assemble authFromEnv's Better Auth options; it
      // is the same ownership zone as auth.ts, split into files, not a new consumer of the library.
      const betterAuthOwner =
        [resolve(serverRoot, "auth.ts"), resolve(serverRoot, "strictOidc.ts")].includes(file) ||
        file.startsWith(resolve(serverRoot, "authConfig") + sep);
      if (!betterAuthOwner) {
        expect(source, relative(serverRoot, file)).not.toMatch(/from ['"]better-auth(?:\/[^'"]*)?['"]/);
      }
    }
  });

  it("prevents product routes from reaching identity or membership storage directly", () => {
    const source = read("app.ts");
    expect(source).not.toMatch(/from ['"].*controlTables/);
    expect(source).not.toMatch(/\b(?:user|session|account_members|invites)\b[^\n]*\.prepare\s*\(/);
    expect(source).not.toContain("better-auth");
  });

  it("keeps invitation and member administration in the account HTTP adapter", () => {
    const productRoutes = read("app.ts");
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
      expect(productRoutes, path).not.toMatch(quoted);
    }
    expect(accountRoutes).not.toMatch(/from ['"].*(?:betterAuthIdentityPort|better-auth|controlTables)/);
    expect(accountRoutes).not.toMatch(/\.prepare\s*\(|\b(?:SELECT|INSERT|UPDATE|DELETE FROM)\b/);
  });

  it("keeps invitation SQL out of the auth-vendor adapter", () => {
    for (const path of [
      "auth.ts",
      "authConfig/authTypes.ts",
      "authConfig/authConstants.ts",
      "authConfig/passwordBackpressure.ts",
      "authConfig/captureContexts.ts",
      "authConfig/authAdapter.ts",
      "authConfig/bootstrapAdmin.ts",
      "authConfig/federatedIdentitySchema.ts",
      "authConfig/sessionActivity.ts",
      "authConfig/authFromEnv.ts",
    ]) {
      const source = read(path);
      expect(source).not.toMatch(/\b(?:FROM|INTO|UPDATE|DELETE FROM)\s+invites\b/i);
      expect(source).not.toMatch(/from ['"].*controlTables/);
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
    ['import { value } from "./c";', true],
    ['export { value } from "./c";', true],
    ['export * from "./c";', true],
    ['import "./c";', true],
    ['export type { T } from "./c";', false],
    ['import type { T } from "./c";', false],
  ])("traces runtime dependencies through %s", (source, runtime) => {
    const a = fixture("chain/a.ts", 'import { value } from "./b";');
    const b = fixture("chain/b.ts", source);
    const c = fixture("chain/c.ts", "export const value = 1; export type T = string;");
    expect(dependencyPath(a, new Set([c]))).toEqual(runtime ? [a, b, c] : null);
  });
});
