import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { presetEnvironment, resolvePlaywrightRunMode, E2E_RUN_PRESETS } from "./playwright-run-mode.mjs";
import { nonColourEnvironment } from "./pnpm-spawn.mjs";
import { claimLane, laneDirectory, reapLane, releaseLane, releaseMutex, shareForClaims } from "./lane-claim.mjs";
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

test("a live mutex is not reclaimed solely because its timestamp is old", () => {
  const environment = scratch();
  const directory = laneDirectory(environment);
  // The directory is created by an initial claim; its claim is released before the assertion.
  claimLane({ worktree: "/tmp/a", environment }).release();
  mkdirSync(join(directory, ".mutex"));
  writeFileSync(join(directory, ".mutex", "owner-old.json"), JSON.stringify({ pid: process.pid, at: 0 }));
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => (now += 31_000);
  try {
    assert.throws(() => claimLane({ worktree: "/tmp/b", environment }), /held by pid/);
  } finally {
    Date.now = realNow;
  }
});

test("an incomplete private mutex write never publishes ownership", () => {
  const environment = scratch();
  const directory = laneDirectory(environment);
  claimLane({ worktree: "/tmp/initial", environment }).release();
  // Simulate a process paused between creating and writing its private claim file.
  mkdirSync(join(directory, ".mutex-other-process"));
  writeFileSync(join(directory, ".mutex-other-process", "owner.json"), "");
  const first = claimLane({ worktree: "/tmp/first", environment });
  const second = claimLane({ worktree: "/tmp/second", environment });
  assert.notEqual(first.lane, second.lane);
  first.release();
  second.release();
});

test("a paused subprocess publisher cannot make two live claims share a lane", async () => {
  const environment = scratch();
  const directory = laneDirectory(environment);
  claimLane({ worktree: "/tmp/initial", environment }).release();
  const publisher = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { mkdirSync, writeFileSync, renameSync, unlinkSync, rmdirSync } from 'node:fs';
       import { join } from 'node:path';
       const { claimLane } = await import(process.argv[1]);
       const directory = process.argv[2];
       const temporary = join(directory, '.mutex-publisher');
       mkdirSync(temporary);
       process.send('created');
       await new Promise((resolve) => process.once('message', resolve));
       writeFileSync(join(temporary, 'owner-publisher.json'), JSON.stringify({ pid: process.pid, at: Date.now() }));
       renameSync(temporary, join(directory, '.mutex'));
       unlinkSync(join(directory, '.mutex', 'owner-publisher.json'));
       rmdirSync(join(directory, '.mutex'));
       const claim = claimLane({ worktree: '/tmp/publisher', environment: { XDG_CACHE_HOME: process.argv[3] } });
       process.send({ lane: claim.lane });
       claim.release();
       process.disconnect();`,
      new URL("./lane-claim.mjs", import.meta.url).href,
      directory,
      environment.XDG_CACHE_HOME,
    ],
    { stdio: ["ignore", "pipe", "pipe", "ipc"] },
  );
  const publisherExit = new Promise((resolve) => publisher.once("exit", resolve));
  const nextMessage = () =>
    new Promise((resolve, reject) => {
      publisher.once("message", resolve);
      publisher.once("error", reject);
      publisher.once("exit", (code) => reject(new Error(`Publisher exited before sending its claim: ${code}`)));
    });
  assert.equal(await nextMessage(), "created");
  const contender = claimLane({ worktree: "/tmp/contender", environment });
  publisher.send("continue");
  const published = await nextMessage();
  assert.notEqual(published.lane, contender.lane);
  contender.release();
  assert.equal(await publisherExit, 0);
});

test("a live legacy file mutex is respected and a dead one is reclaimed", () => {
  const environment = scratch();
  const directory = laneDirectory(environment);
  claimLane({ worktree: "/tmp/initial", environment }).release();
  const mutex = join(directory, ".mutex");
  writeFileSync(mutex, JSON.stringify({ pid: process.pid, at: 0 }));
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => (now += 31_000);
  try {
    assert.throws(() => claimLane({ worktree: "/tmp/blocked", environment }), /held by pid/);
  } finally {
    Date.now = realNow;
  }
  unlinkSync(mutex);
  writeFileSync(mutex, JSON.stringify({ pid: 2 ** 30, at: 0 }));
  const claim = claimLane({ worktree: "/tmp/reclaimed", environment });
  assert.equal(claim.lane, 0);
  claim.release();
});

test("racing dead-owner cleanup cannot remove a successor's mutex", () => {
  const environment = scratch();
  const directory = laneDirectory(environment);
  claimLane({ worktree: "/tmp/initial", environment }).release();
  const mutex = join(directory, ".mutex");
  mkdirSync(mutex);
  writeFileSync(join(mutex, "owner-dead.json"), JSON.stringify({ pid: 2 ** 30, at: 0 }));
  const successor = claimLane({ worktree: "/tmp/successor", environment });
  mkdirSync(mutex);
  writeFileSync(join(mutex, "owner-successor.json"), JSON.stringify({ pid: process.pid, at: Date.now() }));
  // A delayed reaper still holds the dead owner's filename from its earlier read.
  releaseMutex(mutex, "owner-dead.json");
  assert.deepEqual(readdirSync(mutex), ["owner-successor.json"]);
  releaseMutex(mutex, "owner-successor.json");
  assert.equal(successor.release(), true);
});

test("explicit browser presets clear conflicting inherited mode flags", () => {
  const inherited = {
    CAPACITYLENS_WEBKIT_ONLY: "1",
    CAPACITYLENS_FIREFOX_ONLY: "1",
    CAPACITYLENS_REHEARSAL_URL: "https://example.invalid",
    KEEP_THIS: "yes",
  };
  for (const preset of Object.values(E2E_RUN_PRESETS)) {
    const environment = nonColourEnvironment({}, presetEnvironment(inherited, preset.environment));
    assert.equal(environment.KEEP_THIS, "yes");
    const mode = resolvePlaywrightRunMode(environment, [], () => false);
    assert.deepEqual(
      mode.projects.filter((project) => ["webkit", "firefox"].includes(project)),
      preset.projects.filter((project) => ["webkit", "firefox"].includes(project)),
    );
  }
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

test("a delayed release cannot delete a same-process successor", () => {
  const environment = scratch();
  const directory = laneDirectory(environment);
  const first = claimLane({ worktree: "/tmp/a", environment });
  const firstToken = JSON.parse(readFileSync(join(directory, "0.json"), "utf8")).token;
  first.release();
  const successor = claimLane({ worktree: "/tmp/b", environment });
  assert.equal(releaseLane(directory, successor.lane, firstToken), false);
  assert.equal(successor.release(), true);
});

test("a signalled launcher exits unsuccessfully even when its child exits zero", async () => {
  const environment = { ...process.env, CAPACITYLENS_PORT_LANE: "0", CAPACITYLENS_TEST_SHARE: "1" };
  const child = spawn(
    process.execPath,
    [
      new URL("./with-lane.mjs", import.meta.url).pathname,
      process.execPath,
      "-e",
      "process.on('SIGTERM', () => process.exit(0)); process.stdout.write('ready\\n'); setInterval(() => {}, 1000)",
    ],
    { env: environment, stdio: ["ignore", "pipe", "pipe"] },
  );
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.stdout.once("data", resolve);
  });
  child.kill("SIGTERM");
  const outcome = await new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  assert.notEqual(outcome.code, 0);
});

test("both launchers report child startup failures with exit status 2", () => {
  const withLane = spawnSync(
    process.execPath,
    [new URL("./with-lane.mjs", import.meta.url).pathname, "/missing-capacitylens-command"],
    { env: { ...process.env, CAPACITYLENS_PORT_LANE: "0" }, encoding: "utf8" },
  );
  assert.equal(withLane.status, 2);

  const server = spawnSync(
    process.execPath,
    [new URL("../server/scripts/e2e-server.mjs", import.meta.url).pathname, "db"],
    {
      env: { ...process.env, PATH: "", CAPACITYLENS_PORT_LANE: "0" },
      encoding: "utf8",
    },
  );
  assert.equal(server.status, 2);
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
