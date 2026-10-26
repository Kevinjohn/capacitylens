import { fileURLToPath } from "node:url";
import { reportSpawnFailureAndResolveExitStatus, spawnPnpmSync } from "./pnpmSpawn.mjs";

const forwardedArgs = process.argv.slice(2);
if (forwardedArgs[0] === "--") forwardedArgs.shift();
// shadcn reads components.json from its process directory; `pnpm --dir` does not change that for dlx.
const result = spawnPnpmSync(["dlx", "shadcn@4.16.0", ...forwardedArgs], {
  cwd: fileURLToPath(new URL("../apps/frontend/", import.meta.url)),
  stdio: "inherit",
});
process.exit(reportSpawnFailureAndResolveExitStatus("shadcn CLI", result));
