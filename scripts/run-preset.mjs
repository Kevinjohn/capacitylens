import { spawnPnpm } from './pnpmSpawn.mjs';
import { E2E_RUN_PRESETS, presetEnvironment } from './playwrightRunMode.mjs';

const [preset, ...forwardedArgs] = process.argv.slice(2);
const presets = {
  webkit: {
    args: ['exec', 'playwright', 'test', '--project=webkit', ...forwardedArgs],
    environment: E2E_RUN_PRESETS.webkitOnly.environment,
  },
  firefox: {
    args: ['exec', 'playwright', 'test', '--project=firefox', ...forwardedArgs],
    environment: E2E_RUN_PRESETS.firefoxOnly.environment,
  },
};

const selected = Object.hasOwn(presets, preset) ? presets[preset] : undefined;
if (!selected) {
  console.error(`run-preset: unknown preset ${JSON.stringify(preset)}`);
  process.exit(2);
}

const child = spawnPnpm(selected.args, {
  stdio: 'inherit',
  env: presetEnvironment(process.env, selected.environment),
});
child.once('error', (error) => {
  console.error(`run-preset: could not start ${preset}: ${error.message}`);
  process.exitCode = 2;
});
child.once('exit', (code, signal) => {
  if (signal) {
    console.error(`run-preset: ${preset} was terminated by ${signal}`);
    process.exitCode = 2;
  } else {
    process.exitCode = code ?? 2;
  }
});
