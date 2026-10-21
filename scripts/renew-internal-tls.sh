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
docker compose exec -T api node scripts/verify-tls-renewal.mjs
