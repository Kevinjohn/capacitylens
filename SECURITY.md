# Security policy

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/Kevinjohn/capacitylens/security/advisories/new).
Do not disclose vulnerability details in an issue, discussion or pull request.

Include the affected version/commit, prerequisites, reproduction steps, impact and a minimal
proof-of-concept where safe. Remove real personal or production data.

If private reporting is unavailable, open a public issue titled “Security contact request” with no
technical details. A maintainer will establish a private channel.

## Response

This is a small project with no paid bounty program or guaranteed SLA. The maintainer aims to
acknowledge reports within five working days, validate them, coordinate a fix and publish an
advisory after a patched release is available. Reporters may request credit or anonymity.

Only the latest release and current `main` are supported. Older releases may not receive fixes.

## Scope

In scope: authentication/authorization bypass, cross-account access, injection, stored/DOM XSS,
CSRF, session compromise, import/export attacks, destructive unauthorised actions, sensitive-data
exposure and meaningful dependency vulnerabilities in the shipped application.

Out of scope: denial of service requiring an already privileged operator, missing hardening on a
server not following the deployment guide, social engineering, and vulnerabilities solely in an
unsupported old release.

Self-hosters remain responsible for public-edge TLS, operating-system updates, secret management,
network access, off-host backups and restore testing. The packaged internal nginx→API hop verifies
its own per-install TLS identity. Do not expose an auth-off instance to the internet.

The current threat model, control inventories, full OWASP ASVS 5.0.0 ledger and dated review are in
[`docs/security`](docs/security). They distinguish application guarantees from deployment controls
and list residual gaps; please include the relevant control/finding id in a report when possible.
