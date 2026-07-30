import { spawn } from "node:child_process";
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

export function killProcessTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(-child.pid, "SIGTERM");
    }
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}
