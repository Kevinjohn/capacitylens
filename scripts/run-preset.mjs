import { spawnPnpm } from "./pnpm-spawn.mjs";
import { E2E_RUN_PRESETS } from "./playwright-run-mode.mjs";

const [preset, ...forwardedArgs] = process.argv.slice(2);
const presets = {
  "dev-demo": {
    args: ["run", "dev:web", ...forwardedArgs],
    environment: { VITE_CAPACITYLENS_DEMO: "1" },
  },
  webkit: {
    args: ["exec", "playwright", "test", "--project=webkit", ...forwardedArgs],
    environment: E2E_RUN_PRESETS.webkitOnly.environment,
  },
  firefox: {
    args: ["exec", "playwright", "test", "--project=firefox", ...forwardedArgs],
    environment: E2E_RUN_PRESETS.firefoxOnly.environment,
  },
};

const selected = presets[preset];
if (!selected) {
  console.error(`run-preset: unknown preset ${JSON.stringify(preset)}`);
  process.exit(2);
}

const child = spawnPnpm(selected.args, {
  stdio: "inherit",
  env: { ...process.env, ...selected.environment },
});
child.once("error", (error) => {
  console.error(`run-preset: could not start ${preset}: ${error.message}`);
  process.exitCode = 2;
});
child.once("exit", (code, signal) => {
  if (signal) {
    console.error(`run-preset: ${preset} was terminated by ${signal}`);
    process.exitCode = 2;
  } else {
    process.exitCode = code ?? 2;
  }
});
