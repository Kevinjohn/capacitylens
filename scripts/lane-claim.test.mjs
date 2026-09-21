import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimLane, laneDirectory, reapLane, releaseLane, shareForClaims } from "./lane-claim.mjs";
import { LANE_CEILING, portsForLane } from "./ports.mjs";

function scratch() {
  const cache = mkdtempSync(join(tmpdir(), "lanes-"));
  return { XDG_CACHE_HOME: cache, HOME: cache };
}

test("the first claim takes lane 0 and the next takes lane 1", () => {
  const environment = scratch();
  const first = claimLane({ worktree: "/tmp/a", environment });
  const second = claimLane({ worktree: "/tmp/b", environment });
  assert.equal(first.lane, 0);
  assert.equal(second.lane, 1);
  assert.notDeepEqual(portsForLane(first.lane), portsForLane(second.lane));
});

test("a lane whose holder has gone is reclaimed, and a live holder's is not", () => {
  const environment = scratch();
  const directory = laneDirectory(environment);
  claimLane({ worktree: "/tmp/a", environment }); // lane 0, held by this live process
  // A claim from a pid that cannot exist: the highest pid is well below this.
  writeFileSync(join(directory, "1.json"), JSON.stringify({ pid: 2 ** 30, worktree: "/tmp/dead", share: 4 }));
  const next = claimLane({ worktree: "/tmp/c", environment });
  assert.equal(next.lane, 1, "the dead holder's lane is the first free one");
});

test("running out of lanes names the holders instead of failing later on a port", () => {
  const environment = scratch();
  for (let lane = 0; lane < LANE_CEILING; lane += 1) claimLane({ worktree: `/tmp/${lane}`, environment });
  assert.throws(
    () => claimLane({ worktree: "/tmp/overflow", environment }),
    (error) =>
      error.message.includes(`All ${LANE_CEILING} port lanes are held`) && error.message.includes(`pid ${process.pid}`),
  );
});

test("release removes only our own claim", () => {
  const environment = scratch();
  const directory = laneDirectory(environment);
  const claim = claimLane({ worktree: "/tmp/a", environment });
  assert.equal(claim.release(), true);
  assert.equal(readdirSync(directory).length, 0);
  assert.equal(claim.release(), false, "releasing twice is a no-op, not a delete of a successor's claim");
  writeFileSync(
    join(directory, "0.json"),
    JSON.stringify({ pid: process.pid + 1, worktree: "/tmp/successor", share: 1 }),
  );
  assert.equal(releaseLane(directory, 0), false, "another process's claim survives our release");
  assert.equal(readdirSync(directory).length, 1);
});

test("the reservation shrinks as the pool fills and never reaches zero", () => {
  assert.equal(shareForClaims(new Map(), 10), 5, "a solo run is capped at half the cores, not the whole pool");
  assert.equal(shareForClaims(new Map([[0, { share: 5 }]]), 10), 4);
  assert.equal(
    shareForClaims(
      new Map([
        [0, { share: 5 }],
        [1, { share: 4 }],
      ]),
      10,
    ),
    1,
    "an exhausted pool still admits a single worker",
  );
  assert.equal(shareForClaims(new Map([[0, { share: 9 }]]), 2), 1);
});

test("an orphan from this worktree is reaped; a stranger's process is refused, not killed", async () => {
  const lane = 3;
  const port = portsForLane(lane).web;
  const killed = [];
  const reaped = await reapLane(lane, "/tmp/mine", {
    probe: (candidate) => Promise.resolve(candidate === port),
    owner: () => 4242,
    directoryOf: () => "/tmp/mine",
    kill: (pid) => killed.push(pid),
  });
  assert.deepEqual(reaped, [{ port, pid: 4242 }]);
  assert.deepEqual(killed, [4242]);

  await assert.rejects(
    reapLane(lane, "/tmp/mine", {
      probe: (candidate) => Promise.resolve(candidate === port),
      owner: () => 4242,
      directoryOf: () => "/tmp/someone-else",
      kill: () => assert.fail("a process outside this worktree must never be killed"),
    }),
    /not this worktree/,
  );
});
