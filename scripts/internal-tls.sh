#!/bin/sh
set -eu

# Generate a private, per-install CA and an API server certificate for the Docker-internal
# nginx -> Fastify hop. Nothing is baked into an image: the CA and leaf are created on the
# deployment's named volume and reused while valid. Existing material is rotated only by the
# coordinated host-side renewal command, which reloads and verifies both live consumers.
TLS_DIR=${CAPACITYLENS_INTERNAL_TLS_DIR:-/tls}
RENEW_BEFORE_SECONDS=${CAPACITYLENS_INTERNAL_TLS_RENEW_BEFORE_SECONDS:-2592000}
CA_RENEW_BEFORE_SECONDS=${CAPACITYLENS_INTERNAL_CA_RENEW_BEFORE_SECONDS:-15552000}
CA_CERT="$TLS_DIR/ca.crt"
CA_KEY="$TLS_DIR/ca.key"
API_CERT="$TLS_DIR/api.crt"
API_KEY="$TLS_DIR/api.key"
GENERATION="$TLS_DIR/api.crt.sha256"
API_UID=${CAPACITYLENS_INTERNAL_TLS_API_UID:-1000}
ROTATE=${CAPACITYLENS_INTERNAL_TLS_ROTATE:-0}

if test "$ROTATE" != 0 && test "$ROTATE" != 1; then
  echo "capacitylens-internal-tls: CAPACITYLENS_INTERNAL_TLS_ROTATE must be 0 or 1" >&2
  exit 1
fi

umask 077
mkdir -p "$TLS_DIR"

ca_is_usable() {
  if ! test -s "$CA_CERT" || ! test -s "$CA_KEY"; then return 1; fi
  ca_cert_fingerprint=$(
    openssl x509 -in "$CA_CERT" -pubkey -noout 2>/dev/null |
      openssl pkey -pubin -outform DER 2>/dev/null |
      openssl dgst -sha256 2>/dev/null
  )
  ca_key_fingerprint=$(
    openssl pkey -in "$CA_KEY" -pubout -outform DER 2>/dev/null |
      openssl dgst -sha256 2>/dev/null
  )
  openssl x509 -checkend "$CA_RENEW_BEFORE_SECONDS" -noout -in "$CA_CERT" >/dev/null 2>&1 &&
    test -n "$ca_cert_fingerprint" &&
    test "$ca_cert_fingerprint" = "$ca_key_fingerprint"
}

certificate_set_is_usable() {
  if ! ca_is_usable || ! test -s "$API_CERT" || ! test -s "$API_KEY"; then return 1; fi
  api_cert_fingerprint=$(
    openssl x509 -in "$API_CERT" -pubkey -noout 2>/dev/null |
      openssl pkey -pubin -outform DER 2>/dev/null |
      openssl dgst -sha256 2>/dev/null
  )
  api_key_fingerprint=$(
    openssl pkey -in "$API_KEY" -pubout -outform DER 2>/dev/null |
      openssl dgst -sha256 2>/dev/null
  )
  openssl x509 -checkend "$RENEW_BEFORE_SECONDS" -noout -in "$API_CERT" >/dev/null 2>&1 &&
    openssl verify -CAfile "$CA_CERT" "$API_CERT" >/dev/null 2>&1 &&
    openssl x509 -checkhost api -noout -in "$API_CERT" >/dev/null 2>&1 &&
    test -n "$api_cert_fingerprint" &&
    test "$api_cert_fingerprint" = "$api_key_fingerprint"
}

repair_certificate_permissions() {
  # Publishing and permission handoff are separate filesystem operations. Reapply the complete
  # policy on every successful validation so a restart converges after interruption between them.
  chmod 0400 "$CA_KEY" "$API_KEY"
  chmod 0444 "$CA_CERT" "$API_CERT"
  chown 0:0 "$CA_KEY" "$CA_CERT"
  chown "$API_UID:$API_UID" "$API_KEY" "$API_CERT"
}

publish_generation() {
  generation_value=$(openssl dgst -sha256 "$API_CERT" | sed 's/^.*= //')
  generation_tmp=$(mktemp "$TLS_DIR/.capacitylens-generation.XXXXXX")
  printf '%s\n' "$generation_value" > "$generation_tmp"
  chmod 0444 "$generation_tmp"
  chown 0:0 "$generation_tmp"
  mv -f "$generation_tmp" "$GENERATION"
}

if certificate_set_is_usable; then
  repair_certificate_permissions
  publish_generation
  echo "capacitylens-internal-tls: existing certificate set is valid"
  exit 0
fi

# Never replace an identity behind running consumers. Fresh empty volumes initialize normally;
# renewal or repair of any existing material requires the host-side coordinated workflow.
if test "$ROTATE" != 1 && {
  test -e "$CA_CERT" || test -e "$CA_KEY" || test -e "$API_CERT" || test -e "$API_KEY"
}; then
  echo "capacitylens-internal-tls: existing certificate material needs coordinated renewal" >&2
  echo "capacitylens-internal-tls: run ./scripts/renew-internal-tls.sh from the host" >&2
  exit 1
fi

# Stage on the certificate volume itself. Publication is then a same-filesystem rename even when
# /tmp is a separate tmpfs, so no valid filename can expose a partially copied key or certificate.
WORK_DIR=$(mktemp -d "$TLS_DIR/.capacitylens-tls-stage.XXXXXX")
trap 'rm -rf "$WORK_DIR"' EXIT HUP INT TERM

REUSE_CA=0
if ca_is_usable; then
  REUSE_CA=1
  cp "$CA_KEY" "$WORK_DIR/ca.key"
  cp "$CA_CERT" "$WORK_DIR/ca.crt"
else
  openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$WORK_DIR/ca.key"
  openssl req -x509 -new -sha256 -days 3650 \
    -key "$WORK_DIR/ca.key" \
    -subj "/CN=CapacityLens Internal CA" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -addext "subjectKeyIdentifier=hash" \
    -out "$WORK_DIR/ca.crt"
fi

openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$WORK_DIR/api.key"
openssl req -new -sha256 \
  -key "$WORK_DIR/api.key" \
  -subj "/CN=api" \
  -addext "subjectAltName=DNS:api,IP:127.0.0.1" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
  -addext "extendedKeyUsage=serverAuth" \
  -out "$WORK_DIR/api.csr"
openssl x509 -req -sha256 -days 397 \
  -in "$WORK_DIR/api.csr" \
  -CA "$WORK_DIR/ca.crt" \
  -CAkey "$WORK_DIR/ca.key" \
  -CAcreateserial \
  -copy_extensions copy \
  -out "$WORK_DIR/api.crt"

openssl verify -CAfile "$WORK_DIR/ca.crt" "$WORK_DIR/api.crt" >/dev/null
openssl x509 -checkhost api -noout -in "$WORK_DIR/api.crt" >/dev/null

if test "$REUSE_CA" -eq 0; then
  mv -f "$WORK_DIR/ca.key" "$CA_KEY"
  mv -f "$WORK_DIR/ca.crt" "$CA_CERT"
fi
mv -f "$WORK_DIR/api.key" "$API_KEY"
mv -f "$WORK_DIR/api.crt" "$API_CERT"

# Only the non-root API uid may read its leaf private key. Nginx mounts the same volume but runs
# as uid 101, so it can read the public CA certificate and cannot read either private key. Apply
# ownership after publishing from a private staging directory on the same certificate volume.
repair_certificate_permissions
publish_generation

echo "capacitylens-internal-tls: published a new certificate generation"
