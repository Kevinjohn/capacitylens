import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { nonColourEnvironment, spawnPnpm } from "../scripts/pnpm-spawn.mjs";

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
