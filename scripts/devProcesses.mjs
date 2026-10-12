import { spawn } from "node:child_process";
import { closeSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import net from "node:net";

/** Refuses unsupported Node versions by reporting the supplied message and exiting with status 1. */
export function requireNode24(message) {
  const major = Number(process.versions.node.split(".")[0]);
  if (Number.isInteger(major) && major >= 24) return;
  console.error(message(process.versions.node));
  process.exit(1);
}

/** Probes the IPv4 loopback port, returning false for connection errors or a one-second timeout. */
export function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net
      .connect({ host: "127.0.0.1", port }, () => {
        socket.destroy();
        resolve(true);
      })
      .on("error", () => {
        socket.destroy();
        resolve(false);
      });
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function processTreeRunning(child) {
  return child.exitCode === null && child.signalCode === null;
}

function signalProcessTree(
  child,
  signal,
  { platform = process.platform, kill = process.kill, spawnProcess = spawn } = {},
) {
  if (!processTreeRunning(child)) return;
  try {
    if (platform === "win32") {
      const terminator = spawnProcess(
        "taskkill",
        ["/pid", String(child.pid), "/T", ...(signal === "SIGKILL" ? ["/F"] : [])],
        {
          stdio: "ignore",
        },
      );
      terminator.on?.("error", (error) => {
        console.error(`dev: taskkill could not signal process tree ${child.pid}: ${error.message}`);
      });
    } else {
      kill(-child.pid, signal);
    }
  } catch (error) {
    // The process may exit after the liveness check and before it receives the signal.
    if (error.code !== "ESRCH") throw error;
  }
}

function waitForExit(child, timeoutMs) {
  if (!processTreeRunning(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    const finish = (exited) => {
      clearTimeout(timer);
      child.off("exit", onExit);
      resolve(exited);
    };
    child.once("exit", onExit);
  });
}

/**
 * Attempts to stop a detached child process tree, escalating from SIGTERM to SIGKILL after the grace period.
 * Resolution does not guarantee exit if the force timeout expires.
 * @throws When a non-racing signal failure occurs.
 */
export async function terminateProcessTree(child, options = {}) {
  if (!processTreeRunning(child)) return;
  const graceMs = options.graceMs ?? 2_000;
  const forceMs = options.forceMs ?? 1_000;
  signalProcessTree(child, "SIGTERM", options);
  if (await waitForExit(child, graceMs)) return;
  signalProcessTree(child, "SIGKILL", options);
  await waitForExit(child, forceMs);
}

/**
 * Attempts to terminate all supplied detached process trees concurrently; see terminateProcessTree for timeout guarantees.
 * @throws When any child termination rejects.
 */
export function terminateProcessTrees(children, options) {
  return Promise.all(children.map((child) => terminateProcessTree(child, options)));
}

/**
 * Creates an exclusive ownership file and returns an idempotent release callback.
 * @throws When the file already exists or ownership-file I/O fails.
 */
export function acquireExclusiveFile(path) {
  const descriptor = openSync(path, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${process.pid}\n`);
  } catch (error) {
    // Remove the incomplete ownership file and rethrow so a failed publisher cannot leave a false live lock.
    closeSync(descriptor);
    unlinkSync(path);
    throw error;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    closeSync(descriptor);
    try {
      unlinkSync(path);
    } catch (error) {
      // Another cleanup may already have removed the lock; every other unlink failure must surface.
      if (error.code !== "ENOENT") throw error;
    }
  };
}

/**
 * Run `child` as this process's stand-in: forward the interactive signals to it rather than dying
 * first (its own shutdown frees ports; killing the launcher first is how orphans are made), exit 2
 * when it cannot start, and exit 1 when it was interrupted or signalled, else with its own code.
 * `release` runs before either exit.
 */
export function mirrorChildExit(child, { label, release = () => {} }) {
  let interrupted = false;
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
    process.on(signal, () => {
      interrupted = true;
      child.kill(signal);
    });
  child.on("error", (error) => {
    release();
    console.error(`${label}: could not start: ${error.message}`);
    process.exit(2);
  });
  child.on("exit", (code, signal) => {
    release();
    process.exit(interrupted || signal ? 1 : (code ?? 1));
  });
}
