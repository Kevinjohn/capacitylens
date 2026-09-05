const structuralChecks = [
  "policy:gate-runner:test",
  "policy:source-inventory",
  "policy:source-inventory:test",
  "policy:function-metrics:test",
  "policy:shell-metrics:test",
  "policy:vue-metrics:test",
  "policy:sonner-csp:test",
  "policy:function-budgets",
  "policy:function-budgets:test",
  "policy:file-sizes",
  "policy:file-sizes:test",
  "policy:import-cycles",
  "policy:dependencies:test",
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
    ["run", "paraglide:compile"],
    ["--filter", "@capacitylens/shared", "type-check"],
    ["exec", "tsc", "-b"],
    ["run", "typecheck:e2e"],
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

/** Return independent, ordered pnpm argument arrays for a known repository gate. */
export function gateCommands(mode) {
  if (!Object.hasOwn(commands, mode)) throw new Error("Expected app or server with no extra arguments.");
  return commands[mode].map((args) => [...args]);
}
