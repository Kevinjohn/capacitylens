import { reportSpawnFailureAndResolveExitStatus, spawnPnpmSync } from "./pnpmSpawn.mjs";

const forwardedArgs = process.argv.slice(2);
if (forwardedArgs[0] === "--") forwardedArgs.shift();
const result = spawnPnpmSync(["--dir", "apps/frontend", "dlx", "shadcn@4.16.0", ...forwardedArgs], {
  stdio: "inherit",
});
process.exit(reportSpawnFailureAndResolveExitStatus("shadcn CLI", result));
