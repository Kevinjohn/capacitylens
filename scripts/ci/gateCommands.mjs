const structuralChecks = [
  'policy:gate-runner:test',
  'policy:check-changed:test',
  'policy:turbo-graph:test',
  'policy:ports',
  'policy:ports:test',
  'policy:e2e-workers:test',
  'policy:sonner-csp:test',
  'package:managed-release:test',
  'security:screenshot-publication',
  'security:screenshot-publication:test',
].map((name) => ['run', name]);

// Repository policy, dependency and packaging checks that need no application build.
const toolingChecks = [
  ['run', 'check:deps'],
  ['run', 'security:gitleaks-config'],
  ['run', 'policy:dco:test'],
  ...structuralChecks,
  ['run', 'policy:release-validation:test'],
  ['run', 'policy:script-processes:test'],
];
const staticChecks = [
  ['run', 'check:ui'],
  ['run', 'format:check'],
  ['run', 'typecheck'],
  ['run', 'lint'],
];

// CI runs `tooling` and `static` as separate jobs beside the build, frontend and backend tests.
const commands = {
  tooling: toolingChecks,
  static: staticChecks,
  app: [
    ...toolingChecks,
    ...staticChecks,
    ['--dir', 'apps/frontend', 'exec', 'vitest', 'run', '--coverage'],
    // The root build script ends with check:bundle, so a failing budget fails this step.
    ['run', 'build'],
  ],
  backend: [
    ...structuralChecks,
    ['--dir', 'apps/backend', 'typecheck'],
    ['run', 'build'],
    ['run', 'policy:node-runtime:test'],
    ['--dir', 'apps/backend', 'test'],
    ['--dir', 'apps/backend', 'lint'],
  ],
};

const commandKey = (args) => JSON.stringify(args);
const appCommandKeys = new Set(commands.app.map(commandKey));
const serverCommandKeys = new Set(commands.backend.map(commandKey));
const sharedCommands = commands.backend.filter((args) => appCommandKeys.has(commandKey(args)));
const appOnlyCommands = commands.app.filter((args) => !serverCommandKeys.has(commandKey(args)));
const serverOnlyCommands = commands.backend.filter((args) => !appCommandKeys.has(commandKey(args)));

commands.all = [...sharedCommands, ...appOnlyCommands, ...serverOnlyCommands];

/** Return independent, ordered pnpm argument arrays for a known repository gate. */
export function gateCommands(mode) {
  if (!Object.hasOwn(commands, mode))
    throw new Error('Expected app, backend, all, tooling or static with no extra arguments.');
  return commands[mode].map((args) => [...args]);
}
