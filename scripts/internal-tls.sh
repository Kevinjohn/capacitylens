#!/bin/sh
set -eu

# Generate a private, per-install CA and an API server certificate for the Docker-internal
# nginx -> Fastify hop. Nothing is baked into an image: the CA and leaf are created on the
# deployment's named volume, reused while valid, and rotated before expiry on a later `compose up`.
TLS_DIR=${CAPACITYLENS_INTERNAL_TLS_DIR:-/tls}
RENEW_BEFORE_SECONDS=${CAPACITYLENS_INTERNAL_TLS_RENEW_BEFORE_SECONDS:-2592000}
CA_RENEW_BEFORE_SECONDS=${CAPACITYLENS_INTERNAL_CA_RENEW_BEFORE_SECONDS:-15552000}
CA_CERT="$TLS_DIR/ca.crt"
CA_KEY="$TLS_DIR/ca.key"
API_CERT="$TLS_DIR/api.crt"
API_KEY="$TLS_DIR/api.key"

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

if certificate_set_is_usable; then
  echo "capacitylens-internal-tls: existing certificate set is valid"
  exit 0
fi

WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT HUP INT TERM

if ca_is_usable; then
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

mv -f "$WORK_DIR/ca.key" "$CA_KEY"
mv -f "$WORK_DIR/ca.crt" "$CA_CERT"
mv -f "$WORK_DIR/api.key" "$API_KEY"
mv -f "$WORK_DIR/api.crt" "$API_CERT"

# Only the non-root API uid may read its leaf private key. Nginx mounts the same volume but runs
# as uid 101, so it can read the public CA certificate and cannot read either private key. Apply
# ownership after moving from tmpfs: with every other capability dropped, the initializer cannot
# reopen a uid-1000 mode-0400 file to copy it across filesystems.
chmod 0400 "$CA_KEY" "$API_KEY"
chmod 0444 "$CA_CERT" "$API_CERT"
chown 0:0 "$CA_KEY" "$CA_CERT"
chown 1000:1000 "$API_KEY" "$API_CERT"

echo "capacitylens-internal-tls: generated a new certificate set"
