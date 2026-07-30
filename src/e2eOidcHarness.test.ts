import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { describe, expect, it } from "vitest";

const harness = join(process.cwd(), "scripts/e2e-oidc.mjs");
const CHILD_EXIT_TIMEOUT_MS = 5_000;

type ChildExit = { code: number | null; signal: NodeJS.Signals | null };

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<ChildExit | null> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    const finish = (result: ChildExit | null) => {
      clearTimeout(timeout);
      child.off("exit", onExit);
      child.off("error", onError);
      resolve(result);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => finish({ code, signal });
    const onError = (error: Error) => {
      clearTimeout(timeout);
      child.off("exit", onExit);
      reject(error);
    };
    const timeout = setTimeout(() => finish(null), timeoutMs);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

async function terminateChild(child: ChildProcess): Promise<ChildExit> {
  const existing = await waitForExit(child, 0);
  if (existing) return existing;
  child.kill("SIGTERM");
  const graceful = await waitForExit(child, CHILD_EXIT_TIMEOUT_MS);
  if (graceful) return graceful;
  child.kill("SIGKILL");
  const forced = await waitForExit(child, CHILD_EXIT_TIMEOUT_MS);
  if (forced) return forced;
  throw new Error("OIDC harness did not exit after SIGKILL.");
}

async function waitForDexStart(child: ChildProcess, calls: string): Promise<void> {
  const deadline = Date.now() + CHILD_EXIT_TIMEOUT_MS;
  let spawnError: Error | null = null;
  const recordSpawnError = (error: Error) => {
    spawnError = error;
  };
  child.once("error", recordSpawnError);
  try {
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      try {
        if (readFileSync(calls, "utf8").startsWith("run ")) return;
      } catch {
        // The fake Docker command has not written its first call yet.
      }
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error("OIDC harness exited before starting Dex.");
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("OIDC harness did not start Dex.");
  } finally {
    child.off("error", recordSpawnError);
  }
}

describe("strict OIDC E2E harness", () => {
  it("selects the complete OIDC project instead of one literal spec file", () => {
    const source = readFileSync(harness, "utf8");

    expect(source).toContain('"--project=oidc-backed"');
    expect(source).not.toContain('"e2e/oidc.oidc.spec.ts"');
  });

  it("removes Dex before exiting on SIGTERM", async () => {
    const fixture = mkdtempSync(join(tmpdir(), "capacitylens-oidc-signal-"));
    const calls = join(fixture, "docker-calls.txt");
    const docker = join(fixture, "docker");
    writeFileSync(docker, `#!/bin/sh\nprintf '%s\\n' "$*" >> "$OIDC_DOCKER_CALLS"\n`);
    chmodSync(docker, 0o700);

    let child: ChildProcess | null = null;
    try {
      child = spawn(process.execPath, [harness], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${fixture}${delimiter}${process.env.PATH ?? ""}`,
          OIDC_DOCKER_CALLS: calls,
        },
        stdio: "ignore",
      });
      await waitForDexStart(child, calls);
      const exit = await terminateChild(child);

      expect(exit).toEqual({ code: 143, signal: null });
      expect(readFileSync(calls, "utf8")).toMatch(
        /^run [\s\S]*\nlogs --timestamps capacitylens-oidc-e2e-\d+\nrm --force capacitylens-oidc-e2e-\d+\n$/,
      );
    } finally {
      if (child) await terminateChild(child);
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
