import { fileURLToPath } from "node:url";
import { gateCommands } from "./gateCommands.mjs";
import { spawnPnpmSync, reportSpawnFailureAndResolveExitStatus } from "./pnpmSpawn.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

function main() {
  try {
    const [mode, ...extra] = process.argv.slice(2);
    if (extra.length) throw new Error("Expected app, backend, or all with no extra arguments.");
    for (const args of gateCommands(mode)) {
      const label = `gate (${mode}): pnpm ${args.join(" ")}`;
      console.log(label);
      const env =
        args[0] === "run" && args[1] === "build"
          ? {
              ...process.env,
              NODE_ENV: "production",
              CAPACITYLENS_MODE: "password-only",
              CAPACITYLENS_SECRET: "capacitylens-build-secret-0123456789abcdef",
              CAPACITYLENS_PUBLIC_URL: "http://127.0.0.1",
            }
          : process.env;
      const result = spawnPnpmSync(args, { cwd: root, stdio: "inherit", env });
      const status = reportSpawnFailureAndResolveExitStatus(label, result);
      if (status !== 0) {
        process.exitCode = status;
        return;
      }
    }
  } catch (error) {
    // Surface orchestration failures separately from a check’s ordinary nonzero status.
    console.error(`gate failed: ${error.message}`);
    process.exitCode = 2;
  }
}

main();
