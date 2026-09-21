import assert from "node:assert/strict";
import test from "node:test";
import {
  LANE_CEILING,
  OIDC_FIXED_PORTS,
  portsForLane,
  reservationCeiling,
  resolveLane,
  soloShare,
  testShare,
} from "./ports.mjs";

test("lane 0 reproduces the ports this repository bound before lanes existed", () => {
  assert.deepEqual(portsForLane(0), {
    web: 5173,
    dbWeb: 5273,
    authWeb: 5373,
    dbApi: 8787,
    authApi: 8887,
    preview: 4173,
    docsDev: 5900,
    docsPreview: 5910,
  });
});

test("no two services share a port anywhere in the lane range, including the fixed OIDC ports", () => {
  const seen = new Map();
  const claim = (port, owner) => {
    assert.equal(seen.get(port), undefined, `${port} is claimed by both ${seen.get(port)} and ${owner}`);
    seen.set(port, owner);
  };
  for (const [service, port] of Object.entries(OIDC_FIXED_PORTS)) claim(port, service);
  for (let lane = 0; lane < LANE_CEILING; lane += 1) {
    for (const [service, port] of Object.entries(portsForLane(lane))) claim(port, `${service} lane ${lane}`);
  }
});

test("a lane outside the ceiling is rejected rather than silently wrapped", () => {
  assert.throws(() => portsForLane(LANE_CEILING), RangeError);
  assert.throws(() => portsForLane(-1), RangeError);
  assert.throws(() => portsForLane(1.5), RangeError);
});

test("the lane comes from the environment, defaulting to 0 when nothing claimed one", () => {
  assert.equal(resolveLane({}), 0);
  assert.equal(resolveLane({ CAPACITYLENS_PORT_LANE: "" }), 0);
  assert.equal(resolveLane({ CAPACITYLENS_PORT_LANE: "7" }), 7);
  assert.throws(() => resolveLane({ CAPACITYLENS_PORT_LANE: "ten" }), RangeError);
  assert.throws(() => resolveLane({ CAPACITYLENS_PORT_LANE: "10" }), RangeError);
});

test("a run outside a lane gets the same ceiling a solo claim would", () => {
  assert.equal(testShare({}), reservationCeiling());
  assert.equal(testShare({ CAPACITYLENS_TEST_SHARE: "3" }), 3);
  assert.throws(() => testShare({ CAPACITYLENS_TEST_SHARE: "0" }), RangeError);
  assert.throws(() => testShare({ CAPACITYLENS_TEST_SHARE: "-2" }), RangeError);
});

test("the pool leaves a core for everything that is not a test worker, and never drops below one", () => {
  assert.equal(soloShare(10), 9);
  assert.equal(soloShare(1), 1);
  assert.equal(reservationCeiling(10), 5);
  assert.equal(reservationCeiling(1), 1);
});
