import { fileURLToPath } from "node:url";
import { gateCommands } from "./gate-commands.mjs";
import { spawnPnpmSync, synchronousSpawnStatus } from "./pnpm-spawn.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

function main() {
  try {
    const [mode, ...extra] = process.argv.slice(2);
    if (extra.length) throw new Error("Expected app or server with no extra arguments.");
    for (const args of gateCommands(mode)) {
      const label = `gate (${mode}): pnpm ${args.join(" ")}`;
      console.log(label);
      const result = spawnPnpmSync(args, { cwd: root, stdio: "inherit" });
      const status = synchronousSpawnStatus(label, result);
      if (status !== 0) {
        process.exitCode = status;
        return;
      }
    }
  } catch (error) {
    console.error(`gate failed: ${error.message}`);
    process.exitCode = 2;
  }
}

main();
