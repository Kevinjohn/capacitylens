#!/bin/sh
# Installs or upgrades the CapacityLens release that contains this script on a Linux systemd host.
# It runs the manual steps in INSTALL.md.
#   Install: sudo sh /opt/capacitylens/capacitylens-X.Y.Z/install.sh capacity.example.com owner@example.com
#   Upgrade: sudo sh /opt/capacitylens/capacitylens-X.Y.Z/install.sh
set -eu

release=$(cd "$(dirname "$0")" && pwd -P)
env_file=/etc/capacitylens.env
domain=${1:-}
owner=${2:-}

fail() {
  echo "install.sh: $*" >&2
  exit 1
}
as_service() {
  systemd-run --pipe --wait --collect --quiet --uid=capacitylens \
    -p WorkingDirectory=/opt/capacitylens/current/backend \
    -p EnvironmentFile="$env_file" -p Environment=NODE_ENV=production \
    /usr/bin/env node ace.js "$@"
}
secret() {
  node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))"
}

[ "$(id -u)" -eq 0 ] || fail "run as root with sudo."
[ "$(dirname "$release")" = /opt/capacitylens ] || fail "unpack the release into /opt/capacitylens."
case "$#:$domain" in
  0: | 2:*.*) ;;
  *) fail "install with: sudo sh $0 DOMAIN OWNER_EMAIL, or upgrade with: sudo sh $0" ;;
esac
case "$domain" in *[!A-Za-z0-9.-]*) fail "give the domain name only, such as capacity.example.com." ;; esac
[ -e "$env_file" ] || [ -n "$domain" ] || fail "a first install needs: sudo sh $0 DOMAIN OWNER_EMAIL"

id -u capacitylens >/dev/null 2>&1 ||
  useradd --system --home /var/lib/capacitylens --shell /usr/sbin/nologin capacitylens
# Never touch the service-owned folder after creating it, so a link placed there cannot redirect root.
[ -e /var/lib/capacitylens ] ||
  install -d -o capacitylens -g capacitylens -m 0700 /var/lib/capacitylens /var/lib/capacitylens/backups

if [ -e "$env_file" ]; then
  echo "Keeping $env_file and its secrets."
else
  (
    umask 077
    sed -e "s|^APP_URL=.*|APP_URL=https://$domain|" \
      -e "s|^CAPACITYLENS_PUBLIC_URL=.*|CAPACITYLENS_PUBLIC_URL=https://$domain|" \
      -e "s|^APP_KEY=.*|APP_KEY=$(secret)|" \
      -e "s|^CAPACITYLENS_SECRET=.*|CAPACITYLENS_SECRET=$(secret)|" \
      "$release/capacitylens.env.example" >"$env_file.new"
    mv "$env_file.new" "$env_file"
  )
fi

systemctl stop capacitylens 2>/dev/null || true
ln -sfn "$release" /opt/capacitylens/current
# Backs up an existing database before migrating. If it fails, the service stays stopped.
as_service app:upgrade
install -m 0644 "$release/capacitylens.service" /etc/systemd/system/capacitylens.service
systemctl daemon-reload
systemctl enable --now capacitylens

[ -n "$domain" ] || exit 0
if command -v caddy >/dev/null 2>&1; then
  sed "s|capacity.example.com|$domain|" "$release/Caddyfile.example" >/etc/caddy/capacitylens.caddy
  grep -qx 'import /etc/caddy/capacitylens.caddy' /etc/caddy/Caddyfile 2>/dev/null ||
    printf '\nimport /etc/caddy/capacitylens.caddy\n' >>/etc/caddy/Caddyfile
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  systemctl reload-or-restart caddy
else
  echo "Caddy is not installed. Point your HTTPS proxy for $domain at http://127.0.0.1:8787;" \
    "see $release/capacitylens.nginx.conf."
fi
echo "Before inviting anyone, add the CAPACITYLENS_MAIL_* settings with: sudoedit $env_file," \
  "then run: sudo systemctl restart capacitylens"
echo "Open this setup link at https://$domain:"
as_service account-kit:admission:bootstrap "$owner" --role=viewer
