import assert from "node:assert/strict";
import http from "node:http";
import { syncBuiltinESMExports } from "node:module";

// The production destination is a Compose-only hostname. Assert that contract, then route the
// child process to a real ephemeral HTTP fixture. Both CommonJS and ESM use the same redirect.
const get = http.get;
http.get = (url, callback) => {
  assert.equal(url, "http://web:8080/api/health");
  return get(`http://127.0.0.1:${process.env.CAPACITYLENS_TEST_HTTP_PORT}/api/health`, callback);
};
syncBuiltinESMExports();
