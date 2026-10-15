import assert from "node:assert/strict";
import test from "node:test";
import { serverTestApiOrigin } from "./playwrightRunMode.mjs";

test("ordinary server tests reset only their claimed lane despite an inherited API override", async () => {
  const previousLane = process.env.CAPACITYLENS_PORT_LANE;
  const previousApi = process.env.VITE_CAPACITYLENS_API;
  const previousRehearsal = process.env.CAPACITYLENS_REHEARSAL_URL;
  process.env.CAPACITYLENS_PORT_LANE = "3";
  process.env.VITE_CAPACITYLENS_API = "http://localhost:9000";
  delete process.env.CAPACITYLENS_REHEARSAL_URL;
  try {
    const { API, resetServer } = await import("../e2e/serverTestState.ts");
    const requests = [];
    await resetServer({
      request: {
        post: async (url, options) => {
          requests.push({ url, options });
          return { ok: () => true };
        },
      },
    });
    assert.equal(API, "http://localhost:8790");
    assert.deepEqual(requests, [{ url: "http://localhost:8790/api/test/reset", options: { data: { seed: true } } }]);
  } finally {
    if (previousLane === undefined) delete process.env.CAPACITYLENS_PORT_LANE;
    else process.env.CAPACITYLENS_PORT_LANE = previousLane;
    if (previousApi === undefined) delete process.env.VITE_CAPACITYLENS_API;
    else process.env.VITE_CAPACITYLENS_API = previousApi;
    if (previousRehearsal === undefined) delete process.env.CAPACITYLENS_REHEARSAL_URL;
    else process.env.CAPACITYLENS_REHEARSAL_URL = previousRehearsal;
  }
});

test("the retired rehearsal override cannot redirect lane API traffic", () => {
  assert.equal(
    serverTestApiOrigin(8787, { CAPACITYLENS_REHEARSAL_URL: "https://example.test" }),
    "http://localhost:8787",
  );
});
