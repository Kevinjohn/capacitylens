import { spawn } from "node:child_process";
import { closeSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import net from "node:net";

export function requireNode24(message) {
  const major = Number(process.versions.node.split(".")[0]);
  if (Number.isInteger(major) && major >= 24) return;
  console.error(message(process.versions.node));
  process.exit(1);
}

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

export async function terminateProcessTree(child, options = {}) {
  if (!processTreeRunning(child)) return;
  const graceMs = options.graceMs ?? 2_000;
  const forceMs = options.forceMs ?? 1_000;
  signalProcessTree(child, "SIGTERM", options);
  if (await waitForExit(child, graceMs)) return;
  signalProcessTree(child, "SIGKILL", options);
  await waitForExit(child, forceMs);
}

export function terminateProcessTrees(children, options) {
  return Promise.all(children.map((child) => terminateProcessTree(child, options)));
}

export function acquireExclusiveFile(path) {
  const descriptor = openSync(path, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${process.pid}\n`);
  } catch (error) {
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
      if (error.code !== "ENOENT") throw error;
    }
  };
}
