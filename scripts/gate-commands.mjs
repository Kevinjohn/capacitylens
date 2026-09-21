const structuralChecks = [
  "policy:gate-runner:test",
  "policy:ports",
  "policy:ports:test",
  "policy:lint-coverage:test",
  "policy:server-script-lint:test",
  "policy:shared-environment:test",
  "policy:typecheck-graph:test",
  "policy:build-tsconfig:test",
  "policy:script-environments:test",
  "policy:sonner-csp:test",
  "policy:file-sizes",
  "policy:file-sizes:test",
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
    ["exec", "eslint", ".", "--max-warnings", "0"],
    ["exec", "vitest", "run", "--coverage"],
    ["run", "coverage:files"],
    ["exec", "vite", "build"],
    ["run", "bundle:check"],
  ],
  server: [
    ["run", "security:crypto-inventory"],
    ...structuralChecks,
    ["exec", "prettier", "--check", "server", "shared"],
    ["--filter", "capacitylens-server", "type-check"],
    ["--filter", "capacitylens-server", "build:runtime"],
    ["--filter", "capacitylens-server", "test"],
    ["exec", "eslint", "server", "shared", "--max-warnings", "0"],
  ],
};

const commandKey = (args) => JSON.stringify(args);
const appCommandKeys = new Set(commands.app.map(commandKey));
const serverCommandKeys = new Set(commands.server.map(commandKey));
const sharedCommands = commands.server.filter((args) => appCommandKeys.has(commandKey(args)));
const appOnlyCommands = commands.app.filter((args) => !serverCommandKeys.has(commandKey(args)));
const serverOnlyCommands = commands.server.filter((args) => !appCommandKeys.has(commandKey(args)));

commands.all = [...sharedCommands, ...appOnlyCommands, ...serverOnlyCommands];

/** Return independent, ordered pnpm argument arrays for a known repository gate. */
export function gateCommands(mode) {
  if (!Object.hasOwn(commands, mode)) throw new Error("Expected app, server, or all with no extra arguments.");
  return commands[mode].map((args) => [...args]);
}
