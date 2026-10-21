import { describe, expect, it } from "vitest";
import { resolveAccountEnvironment } from "../accountConfig";
import { parseAuthMode } from "../auth";
import { parseBackupConfig } from "../backup";
import { parseRateLimit } from "../rateLimit";
import { evaluateProductionPosture } from "../productionGuard";
import { applyProductionDefaults, resolveHttps } from "./productionDefaults";

type Environment = Record<string, string | undefined>;

const MINIMAL_PRODUCTION: Environment = {
  NODE_ENV: "production",
  CAPACITYLENS_PUBLIC_URL: "https://schedule.example.test",
  CAPACITYLENS_SECRET: "0123456789abcdef0123456789abcdef",
  CAPACITYLENS_SETUP_TOKEN: "setup-token-for-the-first-owner",
  CAPACITYLENS_DB: "/srv/capacitylens/data/capacitylens.db",
};

function defaulted(overrides: Environment = {}): Environment {
  const environment: Environment = { ...MINIMAL_PRODUCTION, ...overrides };
  applyProductionDefaults(environment);
  return environment;
}

describe("applyProductionDefaults", () => {
  it("supplies every default to a minimal production environment", () => {
    const environment = defaulted();
    expect(environment).toMatchObject({
      CAPACITYLENS_RATE_LIMIT: "300",
      CAPACITYLENS_LOG: "1",
      CAPACITYLENS_HEALTH_DEEP: "1",
      CAPACITYLENS_AUDIT_STDOUT: "1",
      CAPACITYLENS_MODE: "password-only",
      CAPACITYLENS_CORS_ORIGIN: "https://schedule.example.test",
      CAPACITYLENS_BACKUP_DIR: "/srv/capacitylens/data/backups",
    });
    expect(parseRateLimit(environment.CAPACITYLENS_RATE_LIMIT)).toBe(300);
    expect(parseAuthMode(environment.CAPACITYLENS_MODE)).toBe("password-only");
    expect(parseBackupConfig(environment)?.dir).toBe("/srv/capacitylens/data/backups");
  });

  it("boots the minimal environment with only the plain-HTTP internal hop warning", () => {
    const { refusals, warnings } = evaluateProductionPosture(resolveAccountEnvironment(defaulted()).env);
    expect(refusals).toEqual([]);
    expect(warnings).toEqual([expect.stringContaining("CAPACITYLENS_INTERNAL_TLS_CERT")]);
  });

  it("changes nothing outside production", () => {
    for (const NODE_ENV of [undefined, "development", "test"]) {
      const environment: Environment = { NODE_ENV };
      applyProductionDefaults(environment);
      expect(environment).toEqual({ NODE_ENV });
    }
  });

  it("keeps every explicit value, including an explicitly empty backup directory", () => {
    const explicit: Environment = {
      CAPACITYLENS_RATE_LIMIT: "50",
      CAPACITYLENS_LOG: "0",
      CAPACITYLENS_HEALTH_DEEP: "0",
      CAPACITYLENS_AUDIT_STDOUT: "0",
      CAPACITYLENS_MODE: "sso-only",
      CAPACITYLENS_BACKUP_DIR: "",
    };
    const environment = defaulted(explicit);
    expect(environment).toMatchObject(explicit);
    expect(parseBackupConfig(environment)).toBeNull();
  });

  it("leaves an explicit invalid value to be refused by its parser", () => {
    const environment = defaulted({ CAPACITYLENS_RATE_LIMIT: "1e3", CAPACITYLENS_MODE: "bogus" });
    expect(environment.CAPACITYLENS_RATE_LIMIT).toBe("1e3");
    expect(environment.CAPACITYLENS_MODE).toBe("bogus");
    const { refusals } = evaluateProductionPosture(environment);
    expect(refusals).toHaveLength(2);
  });
});

describe("applyProductionDefaults explicit choices and backups", () => {
  it("keeps an explicit off mode refused unless the open posture is explicitly allowed", () => {
    const refused = evaluateProductionPosture(defaulted({ CAPACITYLENS_MODE: "off" }));
    expect(refused.refusals).toHaveLength(1);
    const allowed = evaluateProductionPosture(
      defaulted({ CAPACITYLENS_MODE: "off", CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION: "1" }),
    );
    expect(allowed.refusals).toEqual([]);
  });

  it.each([
    [
      "the public URL's origin when unset",
      { CAPACITYLENS_PUBLIC_URL: " https://Schedule.example.test:8443/ " },
      "https://schedule.example.test:8443",
    ],
    [
      "an explicit allow-list unchanged",
      { CAPACITYLENS_CORS_ORIGIN: "https://client.example.test" },
      "https://client.example.test",
    ],
    ["an explicitly empty allow-list empty (fail-closed)", { CAPACITYLENS_CORS_ORIGIN: "" }, ""],
    ["no origin without a public URL", { CAPACITYLENS_PUBLIC_URL: undefined }, undefined],
    ["no origin for an unparseable public URL", { CAPACITYLENS_PUBLIC_URL: "not a url" }, undefined],
  ] as const)("sets the CORS allow-list to %s", (_label, overrides, expected) => {
    expect(defaulted(overrides).CAPACITYLENS_CORS_ORIGIN).toBe(expected);
  });

  it("treats an empty mode (a compose pass-through of an unset variable) as unset", () => {
    expect(defaulted({ CAPACITYLENS_MODE: "" }).CAPACITYLENS_MODE).toBe("password-only");
  });
  it.each([
    ["a relative database", "capacitylens.db", "backups"],
    ["a nested relative database", "data/capacitylens.db", "data/backups"],
    ["an absolute database", "/var/lib/capacitylens/app.db", "/var/lib/capacitylens/backups"],
  ])("places backups beside %s", (_label, database, expected) => {
    expect(defaulted({ CAPACITYLENS_DB: database }).CAPACITYLENS_BACKUP_DIR).toBe(expected);
  });

  it("uses the working directory when no database path is set", () => {
    expect(defaulted({ CAPACITYLENS_DB: undefined }).CAPACITYLENS_BACKUP_DIR).toBe("backups");
  });

  it.each([":memory:", "", "file:memdb?mode=memory"])("sets no backup directory for database %j", (database) => {
    expect(defaulted({ CAPACITYLENS_DB: database }).CAPACITYLENS_BACKUP_DIR).toBeUndefined();
  });
});

describe("resolveHttps", () => {
  it.each([
    ["an https public URL", { CAPACITYLENS_PUBLIC_URL: "https://schedule.example.test" }, true],
    ["an http public URL", { CAPACITYLENS_PUBLIC_URL: "http://localhost:8787" }, false],
    ["no public URL", {}, false],
    ["an explicit 1 over an http URL", { CAPACITYLENS_HTTPS: "1", CAPACITYLENS_PUBLIC_URL: "http://x.test" }, true],
    ["an explicit 0 over an https URL", { CAPACITYLENS_HTTPS: "0", CAPACITYLENS_PUBLIC_URL: "https://x.test" }, false],
    ["an empty flag over an https URL", { CAPACITYLENS_HTTPS: "", CAPACITYLENS_PUBLIC_URL: "https://x.test" }, true],
  ])("is decided by %s", (_label, environment, expected) => {
    expect(resolveHttps(environment)).toBe(expected);
  });
});
