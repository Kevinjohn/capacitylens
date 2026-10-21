import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildEnvironmentFile, runInitCommand } from "./init";

const tsxCli = fileURLToPath(import.meta.resolve("tsx/cli"));
const directories: string[] = [];

function makeDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "capacitylens-init-test-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function readSettings(contents: string): Map<string, string> {
  return new Map(
    contents
      .split("\n")
      .filter(Boolean)
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
}

function readSetting(contents: string, name: string): string {
  const value = readSettings(contents).get(name);
  if (value === undefined) throw new Error(`${name} is missing from the generated file`);
  return value;
}

describe("init environment file", () => {
  it("writes the five production settings with two distinct 48-byte secrets", () => {
    const { contents, setupToken } = buildEnvironmentFile({
      publicUrl: "https://capacity.example.com",
      db: "/var/lib/capacitylens/capacitylens.db",
    });
    const secret = readSetting(contents, "CAPACITYLENS_SECRET");
    expect([...readSettings(contents)]).toEqual([
      ["NODE_ENV", "production"],
      ["CAPACITYLENS_PUBLIC_URL", "https://capacity.example.com"],
      ["CAPACITYLENS_SECRET", secret],
      ["CAPACITYLENS_SETUP_TOKEN", setupToken],
      ["CAPACITYLENS_DB", "/var/lib/capacitylens/capacitylens.db"],
    ]);
    for (const value of [secret, setupToken]) {
      expect(value).toMatch(/^[A-Za-z0-9+/]{64}$/);
      expect(Buffer.from(value, "base64")).toHaveLength(48);
    }
    expect(secret).not.toBe(setupToken);
    const second = buildEnvironmentFile({ publicUrl: "https://a.example", db: "x.db" }).contents;
    expect(readSetting(second, "CAPACITYLENS_SECRET")).not.toBe(secret);
  });

  it("prints the file to stdout and the setup token reminder to stderr", () => {
    const result = runInitCommand(["--public-url", "https://capacity.example.com", "--db", "/data/c.db"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain(`Setup token: ${readSetting(result.stdout, "CAPACITYLENS_SETUP_TOKEN")}`);
    expect(result.stderr).toContain("You enter this once, to create the Owner.");
  });

  it("writes --out with mode 0600 and refuses to overwrite it", () => {
    const out = join(makeDirectory(), "capacitylens.env");
    const first = runInitCommand(["--public-url", "https://capacity.example.com", "--db", "c.db", "--out", out]);
    expect(first.exitCode).toBe(0);
    const written = readFileSync(out, "utf8");
    expect(first.stdout).toContain(`Setup token: ${readSetting(written, "CAPACITYLENS_SETUP_TOKEN")}`);
    if (process.platform !== "win32") expect(statSync(out).mode & 0o777).toBe(0o600);

    const second = runInitCommand(["--public-url", "https://capacity.example.com", "--db", "c.db", "--out", out]);
    expect(second.exitCode).toBe(1);
    expect(second.stderr).toContain("already exists; refusing to overwrite");
    expect(readFileSync(out, "utf8")).toBe(written);
  });
});

describe("init usage errors", () => {
  it.each([
    [[], "--public-url is required"],
    [["--public-url", "https://capacity.example.com"], "--db is required"],
    [["--public-url", "capacity.example.com", "--db", "c.db"], "absolute http:// or https:// URL"],
    [["--public-url", "ftp://capacity.example.com", "--db", "c.db"], "must use http:// or https://"],
    [["--public-url", "http://capacity.example.com", "--db", "c.db"], "must use https://"],
    [["--public-url", "https://capacity.example.com", "--db", "c.db", "--prompt"], "Unknown option"],
    [["--public-url", "https://capacity.example.com", "--db", "/var/lib/my data/c.db"], "--db must not contain"],
    [["--public-url", "https://capacity.example.com", "--db", "/var/lib/$HOME/c.db"], "--db must not contain"],
  ])("rejects %j with a usage line", (args, message) => {
    const result = runInitCommand(args);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(message);
    expect(result.stderr).toContain("Usage: node server/dist/index.mjs init");
  });
});

// A full entrypoint spawn through tsx; the budget covers the spawn, not vitest's 5 s default.
describe("server entrypoint init dispatch", { timeout: 30_000 }, () => {
  it("runs before the reset interlock and never opens the database path", () => {
    const directory = makeDirectory();
    const out = join(directory, "capacitylens.env");
    const missingDirectory = join(directory, "missing");
    // tsx may start an esbuild helper; capture through files so it cannot hold a stdio pipe open.
    const stdoutPath = join(directory, "stdout.log");
    const stderrPath = join(directory, "stderr.log");
    const stdout = openSync(stdoutPath, "w");
    const stderr = openSync(stderrPath, "w");
    const result = spawnSync(
      process.execPath,
      [
        tsxCli,
        "src/index.ts",
        "init",
        "--public-url",
        "https://capacity.example.com",
        "--db",
        join(missingDirectory, "capacitylens.db"),
        "--out",
        out,
      ],
      {
        cwd: process.cwd(),
        // Each of these would stop or redirect a normal start: the reset interlock refuses this pair.
        env: { ...process.env, NODE_ENV: "production", CAPACITYLENS_ALLOW_RESET: "1", NODE_NO_WARNINGS: "1" },
        stdio: ["ignore", stdout, stderr],
        timeout: 20_000,
      },
    );
    closeSync(stdout);
    closeSync(stderr);
    expect(result.status, readFileSync(stderrPath, "utf8")).toBe(0);
    expect(readFileSync(stdoutPath, "utf8")).toContain("You enter this once, to create the Owner.");
    expect(readSetting(readFileSync(out, "utf8"), "CAPACITYLENS_DB")).toBe(join(missingDirectory, "capacitylens.db"));
    expect(existsSync(missingDirectory)).toBe(false);
  });
});
