import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { acquireExclusiveFile, terminateProcessTree } from "./dev-processes.mjs";

class FakeChild extends EventEmitter {
  constructor(pid = 1234) {
    super();
    this.pid = pid;
    this.exitCode = null;
    this.signalCode = null;
  }

  exit(signal) {
    this.signalCode = signal;
    this.emit("exit", null, signal);
  }
}

test("exclusive files reject a second owner and are reusable after release", () => {
  const directory = mkdtempSync(join(tmpdir(), "capacitylens-process-test-"));
  const path = join(directory, "launcher.lock");
  try {
    const release = acquireExclusiveFile(path);
    assert.throws(() => acquireExclusiveFile(path), { code: "EEXIST" });
    release();
    release();
    assert.equal(existsSync(path), false);
    const releaseAgain = acquireExclusiveFile(path);
    releaseAgain();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a graceful POSIX tree exit avoids force escalation", async () => {
  const child = new FakeChild();
  const signals = [];
  await terminateProcessTree(child, {
    platform: "darwin",
    graceMs: 5,
    forceMs: 5,
    kill: (pid, signal) => {
      signals.push([pid, signal]);
      child.exit(signal);
    },
  });
  assert.deepEqual(signals, [[-1234, "SIGTERM"]]);
});

test("an unresponsive POSIX tree escalates from SIGTERM to SIGKILL", async () => {
  const child = new FakeChild();
  const signals = [];
  await terminateProcessTree(child, {
    platform: "linux",
    graceMs: 1,
    forceMs: 5,
    kill: (pid, signal) => {
      signals.push([pid, signal]);
      if (signal === "SIGKILL") child.exit(signal);
    },
  });
  assert.deepEqual(signals, [
    [-1234, "SIGTERM"],
    [-1234, "SIGKILL"],
  ]);
});

test("an unresponsive Windows tree escalates to forced taskkill", async () => {
  const child = new FakeChild(4321);
  const invocations = [];
  await terminateProcessTree(child, {
    platform: "win32",
    graceMs: 1,
    forceMs: 5,
    spawnProcess: (command, args) => {
      invocations.push([command, args]);
      if (args.includes("/F")) child.exit("SIGKILL");
      return new FakeChild();
    },
  });
  assert.deepEqual(invocations, [
    ["taskkill", ["/pid", "4321", "/T"]],
    ["taskkill", ["/pid", "4321", "/T", "/F"]],
  ]);
});
