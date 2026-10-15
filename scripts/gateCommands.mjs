const structuralChecks = [
  "policy:gate-runner:test",
  "policy:ports",
  "policy:ports:test",
  "policy:lint-coverage:test",
  "policy:shared-environment:test",
  "policy:typecheck-graph:test",
  "policy:build-tsconfig:test",
  "policy:script-environments:test",
  "policy:sonner-csp:test",
  "policy:import-cycles",
  "policy:dependencies:test",
  "package:managed-release:test",
  "security:screenshot-publication",
  "security:screenshot-publication:test",
].map((name) => ["run", name]);

const commands = {
  app: [
    ["run", "gate:deps"],
    ["run", "policy:dependabot"],
    ["run", "policy:dependabot:test"],
    ["run", "security:crypto-inventory"],
    ["run", "security:gitleaks-config"],
    ["run", "policy:dco:test"],
    ...structuralChecks,
    ["run", "policy:workflow-report:test"],
    ["run", "ui:check"],
    ["run", "format:check"],
    ["run", "typecheck"],
    ["run", "lint"],
    ["--dir", "apps/frontend", "exec", "vitest", "run", "--coverage"],
    ["run", "coverage:files"],
    ["run", "build"],
    ["run", "bundle:check"],
  ],
  backend: [
    ["run", "security:crypto-inventory"],
    ...structuralChecks,
    ["--dir", "apps/backend", "typecheck"],
    ["--dir", "apps/backend", "build"],
    ["run", "policy:node-runtime:test"],
    ["--dir", "apps/backend", "test"],
    ["--dir", "apps/backend", "lint"],
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
  if (!Object.hasOwn(commands, mode)) throw new Error("Expected app, backend, or all with no extra arguments.");
  return commands[mode].map((args) => [...args]);
}
