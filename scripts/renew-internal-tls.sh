#!/bin/sh
set -eu

# Rotation deliberately incurs a short maintenance window. Stopping both consumers before
# publication prevents either live process from retaining a different certificate generation.
docker compose build internal-tls api web
docker compose stop web api
docker compose run --rm --no-deps \
  -e CAPACITYLENS_INTERNAL_TLS_ROTATE=1 \
  -e CAPACITYLENS_INTERNAL_TLS_RENEW_BEFORE_SECONDS="${CAPACITYLENS_INTERNAL_TLS_RENEW_BEFORE_SECONDS:-2592000}" \
  -e CAPACITYLENS_INTERNAL_CA_RENEW_BEFORE_SECONDS="${CAPACITYLENS_INTERNAL_CA_RENEW_BEFORE_SECONDS:-15552000}" \
  internal-tls
docker compose up --build --force-recreate --wait --wait-timeout 120 -d api web

# The request traverses nginx and its API TLS verifier. The response fingerprint is computed from
# the certificate bytes loaded into Node's live HTTPS context and must equal the last-published
# generation marker before renewal is reported as complete.
docker compose exec -T api node -e '
const fs = require("node:fs");
const http = require("node:http");
const marker = fs.readFileSync(process.env.CAPACITYLENS_INTERNAL_TLS_GENERATION, "utf8").trim();
const request = http.get("http://web:8080/api/health", (response) => {
  let body = "";
  response.setEncoding("utf8");
  response.on("data", (chunk) => { body += chunk; });
  response.on("end", () => {
    try {
      const health = JSON.parse(body);
      if (response.statusCode < 200 || response.statusCode >= 300 ||
          health.internalTls?.fingerprintSha256 !== marker) {
        throw new Error("live fingerprint does not match the published generation");
      }
      console.log("capacitylens-internal-tls: coordinated renewal verified");
    } catch (error) {
      console.error(`capacitylens-internal-tls: renewal verification failed: ${error.message}`);
      process.exitCode = 1;
    }
  });
});
request.on("error", (error) => {
  console.error(`capacitylens-internal-tls: renewal verification failed: ${error.message}`);
  process.exitCode = 1;
});
'
