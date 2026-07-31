import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { nonColourEnvironment, spawnPnpm, spawnPnpmSync, synchronousSpawnStatus } from "../scripts/pnpm-spawn.mjs";

describe("spawnPnpm", () => {
  it("preserves spaces and shell metacharacters as literal argument boundaries", async () => {
    const fixture = mkdtempSync(join(tmpdir(), "capacitylens-pnpm-argv-"));
    const capture = join(fixture, "capture.mjs");
    const launcher = join(fixture, process.platform === "win32" ? "pnpm.cmd" : "pnpm");
    writeFileSync(capture, "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n");
    if (process.platform === "win32") {
      writeFileSync(launcher, `@echo off\r\n"${process.execPath}" "${capture}" %*\r\n`);
    } else {
      writeFileSync(launcher, `#!${process.execPath}\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n`);
      chmodSync(launcher, 0o700);
    }
    const args = ["two words", 'quote"value', "pipe|value", "dollar$value", "glob*value"];

    try {
      const child = spawnPnpm(args, {
        env: { ...process.env, PATH: `${fixture}${delimiter}${process.env.PATH ?? ""}` },
        stdio: ["ignore", "pipe", "pipe"],
        shell: true,
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr?.on("data", (chunk: string) => {
        stderr += chunk;
      });
      const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => resolve({ code, signal }));
      });

      expect(exit, stderr).toEqual({ code: 0, signal: null });
      expect(JSON.parse(stdout)).toEqual(args);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("preserves literal argument boundaries synchronously", () => {
    const fixture = mkdtempSync(join(tmpdir(), "capacitylens-pnpm-sync-"));
    const launcher = join(fixture, process.platform === "win32" ? "pnpm.cmd" : "pnpm");
    if (process.platform === "win32") {
      const capture = join(fixture, "capture.mjs");
      writeFileSync(capture, "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n");
      writeFileSync(launcher, `@echo off\r\n"${process.execPath}" "${capture}" %*\r\n`);
    } else {
      writeFileSync(launcher, `#!${process.execPath}\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n`);
      chmodSync(launcher, 0o700);
    }
    const args = ["exec", "playwright", "test", "--grep", "foo(bar)", "two words", "glob*value"];
    try {
      const result = spawnPnpmSync(args, {
        env: { ...process.env, PATH: `${fixture}${delimiter}${process.env.PATH ?? ""}` },
        encoding: "utf8",
      });
      expect(result.status, String(result.stderr)).toBe(0);
      expect(JSON.parse(String(result.stdout))).toEqual(args);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it.each([
    ["dev-demo", ["run", "dev:web"], "VITE_CAPACITYLENS_DEMO"],
    ["webkit", ["exec", "playwright", "test", "--project=webkit"], "CAPACITYLENS_WEBKIT_ONLY"],
    ["firefox", ["exec", "playwright", "test", "--project=firefox"], "CAPACITYLENS_FIREFOX_ONLY"],
  ])("launches the %s package preset without a shell assignment", (preset, expectedPrefix, expectedFlag) => {
    const fixture = mkdtempSync(join(tmpdir(), "capacitylens-preset-"));
    const launcher = join(fixture, process.platform === "win32" ? "pnpm.cmd" : "pnpm");
    const capture = join(fixture, "capture.mjs");
    writeFileSync(
      capture,
      `process.stdout.write(JSON.stringify({argv:process.argv.slice(2),flag:process.env[${JSON.stringify(expectedFlag)}]}));\n`,
    );
    if (process.platform === "win32") {
      writeFileSync(launcher, `@echo off\r\n"${process.execPath}" "${capture}" %*\r\n`);
    } else {
      writeFileSync(launcher, `#!${process.execPath}\nimport ${JSON.stringify(capture)};\n`);
      chmodSync(launcher, 0o700);
    }
    try {
      const result = spawnSync(
        process.execPath,
        [join(process.cwd(), "scripts/run-preset.mjs"), preset, "--grep", "foo(bar)", "two words"],
        {
          env: { ...process.env, PATH: `${fixture}${delimiter}${process.env.PATH ?? ""}` },
          encoding: "utf8",
        },
      );
      expect(result.status, result.stderr).toBe(0);
      const output = JSON.parse(result.stdout) as { argv: string[]; flag?: string };
      expect(output.argv).toEqual([...expectedPrefix, "--grep", "foo(bar)", "two words"]);
      expect(output.flag).toBe("1");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});

describe("nonColourEnvironment", () => {
  it.each([{}, { NO_COLOR: "1" }, { FORCE_COLOR: "1" }, { NO_COLOR: "1", FORCE_COLOR: "1" }])(
    "normalizes inherited colour controls for %#",
    (parent) => {
      const env = nonColourEnvironment({ RUN: "yes" }, parent);
      expect(env).not.toHaveProperty("NO_COLOR");
      expect(env).toMatchObject({ FORCE_COLOR: "0", RUN: "yes" });
    },
  );
});

describe("synchronousSpawnStatus", () => {
  it("preserves ordinary test statuses", () => {
    expect(synchronousSpawnStatus("phase", { status: 1 }, () => undefined)).toBe(1);
  });

  it.each([
    [{ status: null, error: new Error("not found") }, /could not start.*not found/i],
    [{ status: null, signal: "SIGTERM" }, /terminated by SIGTERM/i],
    [{ status: null }, /without an exit status/i],
  ])("distinguishes runner failures from red tests", (result, expectedMessage) => {
    const messages: string[] = [];
    expect(synchronousSpawnStatus("browser phase", result, (message) => messages.push(message))).toBe(2);
    expect(messages).toEqual([expect.stringMatching(expectedMessage)]);
  });
});
