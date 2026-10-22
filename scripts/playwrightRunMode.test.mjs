import assert from "node:assert/strict";
import test from "node:test";
import { serverTestApiOrigin } from "./playwrightRunMode.mjs";

test("server API calls use the claimed lane despite an inherited API override", async () => {
  const previousLane = process.env.CAPACITYLENS_PORT_LANE;
  const previousApi = process.env.VITE_CAPACITYLENS_API;
  process.env.CAPACITYLENS_PORT_LANE = "3";
  process.env.VITE_CAPACITYLENS_API = "http://localhost:9000";
  try {
    const { API } = await import("../e2e/serverTestState.ts");
    assert.equal(API, "http://localhost:8790");
  } finally {
    if (previousLane === undefined) delete process.env.CAPACITYLENS_PORT_LANE;
    else process.env.CAPACITYLENS_PORT_LANE = previousLane;
    if (previousApi === undefined) delete process.env.VITE_CAPACITYLENS_API;
    else process.env.VITE_CAPACITYLENS_API = previousApi;
  }
});

test("the retired rehearsal override cannot redirect lane API traffic", () => {
  assert.equal(
    serverTestApiOrigin(8787, { CAPACITYLENS_REHEARSAL_URL: "https://example.test" }),
    "http://localhost:8787",
  );
});
