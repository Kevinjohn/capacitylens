import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { laneDirectory } from "./laneClaims.mjs";
import { surveyLanes } from "./lanes.mjs";
import { portsForLane } from "./ports.mjs";

function scratch() {
  const cache = mkdtempSync(join(tmpdir(), "lanes-report-"));
  return { XDG_CACHE_HOME: cache, HOME: cache };
}

test("only an unclaimed listener from this repository's worktrees is a leftover", async () => {
  const environment = scratch();
  const worktree = mkdtempSync(join(tmpdir(), "lanes-worktree-"));
  const elsewhere = mkdtempSync(join(tmpdir(), "lanes-elsewhere-"));
  mkdirSync(join(worktree, "server"));
  const directory = laneDirectory(environment);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "1.json"), JSON.stringify({ pid: process.pid, worktree, share: 1, token: "t" }));

  const listeners = new Map([
    [portsForLane(0).web, { pid: 1000, directory: join(worktree, "server") }],
    [portsForLane(1).web, { pid: 1001, directory: worktree }],
    [portsForLane(2).web, { pid: 1002, directory: elsewhere }],
    [portsForLane(3).web, { pid: null, directory: null }],
  ]);
  const byPid = new Map([...listeners.values()].map((listener) => [listener.pid, listener.directory]));

  const rows = await surveyLanes({
    environment,
    worktrees: [worktree],
    probe: async (port) => listeners.has(port),
    owner: (port) => listeners.get(port).pid,
    directoryOf: (pid) => byPid.get(pid) ?? null,
  });

  assert.deepEqual(
    rows.map(({ lane, pid, orphan, claim }) => ({ lane, pid, orphan, claimed: claim !== null })),
    [
      { lane: 0, pid: 1000, orphan: true, claimed: false },
      { lane: 1, pid: 1001, orphan: false, claimed: true },
      { lane: 2, pid: 1002, orphan: false, claimed: false },
      { lane: 3, pid: null, orphan: false, claimed: false },
    ],
  );
});

test("an empty or missing lane directory reports nothing in use", async () => {
  const rows = await surveyLanes({ environment: scratch(), worktrees: [], probe: async () => false });
  assert.deepEqual(rows, []);
});
