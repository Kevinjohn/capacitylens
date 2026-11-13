#!/usr/bin/env bash
# Prints `present` or `absent` for one image reference. Only a definite "not found" answer counts as
# absent, so a registry outage, rate limit or expired login stops the caller instead of republishing.
# FIRST_PUBLICATION=true also reads `denied` as absent: a package that was never published may
# answer that way.
set -euo pipefail

image="$1"

attempt() {
  local error
  if error="$(docker manifest inspect "$image" 2>&1 >/dev/null)"; then
    echo present
    return 0
  fi
  last_error="$error"
  if grep -qiE 'no such manifest|manifest unknown|name unknown' <<<"$error" ||
    { [ "${FIRST_PUBLICATION:-}" = true ] && grep -qi 'denied' <<<"$error"; }; then
    echo absent
    return 0
  fi
  return 1
}

last_error=''
attempt && exit 0
sleep "${PUBLISHED_IMAGE_STATE_RETRY_SECONDS:-10}"
attempt && exit 0
echo "::error::Could not tell whether $image is published: $last_error. Re-run this workflow later." >&2
exit 1
