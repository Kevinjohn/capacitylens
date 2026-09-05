import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { gateCommands } from "./gate-commands.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = fileURLToPath(new URL("./run-gate.mjs", import.meta.url));

function fixture(t, installCommand = true) {
  const directory = mkdtempSync(join(tmpdir(), "ordered-gates-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const log = join(directory, "commands.jsonl");
  if (installCommand) {
    const command = join(directory, "pnpm");
    const source = readFileSync(new URL("./__tests__/gate-command.mjs", import.meta.url), "utf8");
    writeFileSync(`${command}.mjs`, source);
    if (process.platform === "win32") writeFileSync(`${command}.cmd`, `@"${process.execPath}" "${command}.mjs" %*\r\n`);
    else {
      writeFileSync(command, `#!${process.execPath}\n${source}`);
      chmodSync(command, 0o755);
    }
  }
  return {
    log,
    run(args, extra = {}) {
      rmSync(log, { force: true });
      return spawnSync(process.execPath, [cli, ...args], {
        cwd: directory,
        env: {
          ...process.env,
          PATH: installCommand ? `${directory}${delimiter}${process.env.PATH}` : directory,
          CAPACITYLENS_GATE_LOG: log,
          CAPACITYLENS_GATE_SENTINEL: "preserved value",
          CAPACITYLENS_GATE_FAIL_COMMAND: "",
          CAPACITYLENS_GATE_SIGNAL: "",
          CAPACITYLENS_GATE_FAIL_CODE: "",
          ...extra,
        },
        encoding: "utf8",
        timeout: 30_000,
      });
    },
    entries() {
      return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map(JSON.parse) : [];
    },
  };
}

test("both gates execute their ordered commands once, from the repository, with inherited environment", (t) => {
  const fake = fixture(t);
  for (const gate of ["app", "server"]) {
    const result = fake.run([gate]);
    assert.equal(result.status, 0, result.stderr);
    const entries = fake.entries();
    assert.deepEqual(
      entries.map(({ args }) => args),
      gateCommands(gate),
    );
    assert.ok(
      entries.every(({ cwd, sentinel }) => cwd === root.replace(/[\\/]$/, "") && sentinel === "preserved value"),
    );
  }
});

test("a command failure keeps its exit code and prevents every later check", (t) => {
  const fake = fixture(t);
  for (const gate of ["app", "server"]) {
    const commands = gateCommands(gate);
    const failing = commands.findIndex((args) => args.includes("policy:file-sizes"));
    assert.ok(failing > 0);
    const result = fake.run([gate], {
      CAPACITYLENS_GATE_FAIL_COMMAND: JSON.stringify(commands[failing]),
      CAPACITYLENS_GATE_FAIL_CODE: "17",
    });
    assert.equal(result.status, 17, result.stderr);
    assert.deepEqual(
      fake.entries().map(({ args }) => args),
      commands.slice(0, failing + 1),
    );
  }
});

test("a terminated child is reported through the repository launcher policy and stops the gate", (t) => {
  const fake = fixture(t);
  const first = gateCommands("app")[0];
  const result = fake.run(["app"], {
    CAPACITYLENS_GATE_FAIL_COMMAND: JSON.stringify(first),
    CAPACITYLENS_GATE_SIGNAL: "SIGTERM",
  });
  assert.notEqual(result.status, 0);
  if (process.platform !== "win32") assert.match(result.stderr, /terminated by SIGTERM/);
  assert.equal(fake.entries().length, 1);
});

test("a missing executable fails visibly before another command can run", (t) => {
  const fake = fixture(t, false);
  const result = fake.run(["server"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /could not start/);
  assert.deepEqual(fake.entries(), []);
});

test("invalid modes and extra arguments fail before launching anything", (t) => {
  const fake = fixture(t);
  for (const args of [[], ["unknown"], ["constructor"], ["__proto__"], ["app", "extra"]]) {
    const result = fake.run(args);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Expected app or server/);
    assert.deepEqual(fake.entries(), []);
  }
});

test("mode selection returns independent argument arrays and includes the runner's regressions", () => {
  const first = gateCommands("app");
  first[0].push("mutated");
  assert.ok(!gateCommands("app")[0].includes("mutated"));
  for (const mode of ["app", "server"]) {
    assert.ok(gateCommands(mode).some((args) => args.includes("policy:gate-runner:test")));
  }
  assert.throws(() => gateCommands("unknown"), /Expected app or server/);
});
