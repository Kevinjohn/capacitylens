# Optional deployment hardening migration

Copy the task below into a sibling's coding-agent conversation. Replace `[PRODUCT]`, `[PREFIX]` and
the gate commands only when that sibling genuinely differs.

```text
Priority task: change [PRODUCT]'s production security posture from an all-or-nothing hosted profile
to a safe OSS community baseline with optional operator hardening.

Do not remove implemented security features. Change only whether deployment-dependent controls are
mandatory at startup.

Required behavior

1. Keep these production conditions fail-closed:
   - authentication off or invalid, except an existing explicit risk-acceptance escape;
   - missing/invalid auth secret or public auth URL;
   - destructive test/reset or unsafe bootstrap credentials;
   - missing, invalid or zero application rate limit;
   - local application audit explicitly disabled;
   - partial, empty, unreadable or invalid configuration for any feature an operator has chosen to
     enable;
   - all existing server-side authorization, tenant isolation, fixed session lifetime, session
     revocation and fresh administrative-action checks.

2. Convert these production startup failures into explicit named warnings:
   - `[PREFIX]_REQUIRE_MFA` is not enabled;
   - SSO/IdP MFA assurance is not attested;
   - breached-password screening is explicitly disabled (keep it ON by default);
   - audit events are not duplicated to stdout;
   - encrypted database/audit/backup storage is not attested;
   - security/audit logs are not forwarded to an external collector;
   - both internal API TLS certificate/key paths are absent.

3. Internal TLS behavior must be exact:
   - both certificate and key absent: allow HTTP only over a trusted same-host loopback proxy hop
     and emit one warning;
   - both present and readable: use HTTPS normally;
   - one missing, empty, unreadable or invalid: abort startup; never silently fall back to HTTP.

4. Defaults and optional infrastructure:
   - required MFA is OFF by default, including Compose;
   - breached-password screening remains ON by default but an isolated/offline operator can set it
     OFF and receive a warning;
   - scheduled snapshots may be disabled/unset;
   - off-host backups, external log collection, encrypted storage and private internal TLS are
     recommended but are not software prerequisites;
   - attestation variables only report controls that already exist. They must not implement or
     falsely claim encryption/log delivery.

5. Tests to add or update:
   - a minimal production password configuration has zero refusals and all expected optional-
     hardening warnings;
   - a fully hardened production configuration has zero refusals and warnings;
   - every retained invariant still refuses startup;
   - every optional control warns without refusing;
   - default password authentication reports that required MFA is false;
   - internal TLS omission succeeds, while partial/unreadable identity configuration fails;
   - Compose renders required MFA as empty/off unless explicitly set.

6. Documentation to update together:
   - `.env.example`, README, standing decisions and agent guidance;
   - authentication, self-hosting, operations/runbook and privacy docs;
   - threat model, control/crypto/log inventories and dated security review;
   - the complete OWASP ASVS ledger, not only the Top 10 summary;
   - changelog under Unreleased and exact deployment instructions.

7. OWASP reporting must be honest:
   - password-only defaults do not meet ASVS 5.0 V6.3.3 Level 2;
   - if breach screening can be disabled, treat V6.2.12 as Partial in a product-wide configuration
     review unless assessing a separately fixed hardened deployment;
   - same-host loopback HTTP makes V12.3.3 deployment-dependent/Partial unless verified internal
     TLS is enabled in the assessed deployment;
   - external storage/logging attestations are not Pass evidence without real operator proof;
   - recalculate the full Pass/Partial/Gap/N/A totals after moving requirement IDs.

8. Verification:
   - run [PRODUCT]'s full app, server and E2E gates;
   - run a real `NODE_ENV=production` entrypoint smoke with every optional hardening variable
     omitted and the mandatory first-owner/setup secret present;
   - assert named startup warnings and a successful loopback `/api/health` response;
   - deploy, then verify both the served build commit and public deep health so an old healthy
     release cannot be mistaken for the new deployment.

Iterate on failures until all required gates are green. Document residual risks; do not describe
the configurable community default as strict ASVS Level 2. Do not commit or push unrelated working-
tree changes.
```
