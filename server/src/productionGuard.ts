import { parseAuthMode, BOOTSTRAP_ADMIN_EMAIL } from './auth'

// Production safety interlock. Once NODE_ENV=production, the development/open posture
// must actually be retired: running with auth OFF in
// production would expose the open/demo dataset (DEMO_USER, no login) to the world. This
// module is the pure predicate the entrypoint consults — like bootGuard's resetForbidden, it
// is a deliberate fail-closed SAFETY interlock and is therefore NOT behind an opt-in flag
// (defaulting a guard to off defeats it). The ONLY escape is the explicit
// CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION, which DOWNGRADES the auth-off refusal to a loud
// warning — it never silences the concern.
//
// Active ONLY when NODE_ENV==='production'. Dev / e2e / self-host runs (where NODE_ENV is
// never 'production') are returned untouched — empty arrays — exactly as bootGuard leaves
// them. That no-op is the load-bearing "self-hosters unaffected" guarantee: the open posture
// stays a first-class supported mode everywhere except a NODE_ENV=production process.

/**
 * The outcome of evaluating the production safety contract against an environment.
 *
 * Two severities, deliberately separated: a {@link ProductionPostureResult.refusals | refusal}
 * is a fatal misconfiguration the server MUST refuse to boot on (fail-closed), while a
 * {@link ProductionPostureResult.warnings | warning} is a softer concern that lets boot
 * continue but is logged loudly so an operator can see it. Mirrors the
 * `AuthConfigError`/`resetForbidden` "refuse loudly, never limp on" posture for the fatal
 * tier, and the existing per-flag startup logging for the soft tier.
 */
export interface ProductionPostureResult {
  /** Fatal misconfigurations — the server MUST refuse to boot. Empty unless NODE_ENV==='production'. */
  refusals: string[]
  /** Non-fatal posture concerns — boot continues but logs each loudly. */
  warnings: string[]
}

/**
 * Evaluate the production safety contract for a given environment.
 *
 * Pure (no I/O, no process.env read, no throw): the caller passes a plain env object and gets
 * back the lists of refusals and warnings to act on, so this is unit-testable across every env
 * combination without mutating global state.
 *
 * The contract is active ONLY when `env.NODE_ENV === 'production'`; for any other value
 * (including unset, 'development', 'test') it returns `{ refusals: [], warnings: [] }` so dev /
 * e2e / self-host runs are completely untouched — that no-op is the load-bearing guarantee that
 * the open/auth-off posture remains a supported mode everywhere except production (the same
 * reasoning bootGuard's resetForbidden uses).
 *
 * In production it evaluates, in order:
 * - **Refusal — auth off:** `parseAuthMode(env.CAPACITYLENS_AUTH) === 'off'` is the dev/open
 *   posture P3.1 retires; it would leave the demo dataset world-readable+writable. This is a
 *   refusal UNLESS the operator has deliberately opted in via
 *   `CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION === '1'`, in which case it is DOWNGRADED to a warning
 *   (the open posture is then run on purpose, but still surfaced). The escape never silences the
 *   concern — it only changes its severity.
 * - **Warning — HTTPS/HSTS off:** `CAPACITYLENS_HTTPS !== '1'` means HSTS is not enabled.
 *   Expected when TLS terminates at a reverse proxy; flagged so a direct-HTTPS deploy notices.
 * - **Warning — optional hardening absent:** MFA, breached-password screening, audit streaming,
 *   encrypted-storage/log-forwarding attestations and internal TLS remain recommended, but a
 *   small self-hosted installation can deliberately operate without external infrastructure.
 * - **Warning — open signup on:** `CAPACITYLENS_ALLOW_OPEN_SIGNUP === '1'` re-opens self-service
 *   registration, which should normally stay closed/invite-only in production.
 * - **Refusal — bootstrap password:** the headless bootstrap flags are development-only because
 *   those initial passwords cannot be forced to expire after first use. Production uses the
 *   setup-token owner flow, where the owner chooses the final credential directly.
 *
 * The remaining warnings are evaluated independently of the auth mode — they are production concerns in
 * their own right (HSTS and signup posture matter whether auth is on, off, or deliberately open).
 *
 * `parseAuthMode` is reused (not a hardcoded string compare) so "off" means exactly what it
 * means everywhere else in the server — and an *invalid* CAPACITYLENS_AUTH value throws
 * `AuthConfigError` here, surfacing the misconfiguration through the same path index.ts already
 * frames, rather than being silently mistaken for "not off".
 *
 * @param env - The environment to evaluate. Only the listed keys are read; pass a plain object
 *   literal (the entrypoint passes `process.env`).
 * @returns A {@link ProductionPostureResult} with the refusals (fatal) and warnings (soft).
 *   Both arrays are empty unless `env.NODE_ENV === 'production'`.
 */
export function evaluateProductionPosture(env: {
  NODE_ENV?: string
  CAPACITYLENS_AUTH?: string
  CAPACITYLENS_HTTPS?: string
  CAPACITYLENS_ALLOW_OPEN_SIGNUP?: string
  CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION?: string
  CAPACITYLENS_CREATE_ADMIN_ADMIN?: string
  CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD?: string
  CAPACITYLENS_REQUIRE_MFA?: string
  CAPACITYLENS_SSO_MFA_ENFORCED?: string
  CAPACITYLENS_PASSWORD_BREACH_CHECK?: string
  CAPACITYLENS_RATE_LIMIT?: string
  CAPACITYLENS_AUDIT?: string
  CAPACITYLENS_AUDIT_STDOUT?: string
  CAPACITYLENS_STORAGE_ENCRYPTED?: string
  CAPACITYLENS_SECURITY_LOG_FORWARDING?: string
  CAPACITYLENS_INTERNAL_TLS_CERT?: string
  CAPACITYLENS_INTERNAL_TLS_KEY?: string
}): ProductionPostureResult {
  const refusals: string[] = []
  const warnings: string[] = []

  // No-op outside production. Dev / e2e / self-host keep the open posture as a supported mode —
  // this guard only engages once an operator declares NODE_ENV=production (same gate as bootGuard).
  if (env.NODE_ENV !== 'production') return { refusals, warnings }

  // Reuse parseAuthMode so 'off' (incl. unset/'') is the canonical "no auth" notion the rest of
  // the server agrees on, and an invalid value throws AuthConfigError instead of reading as "on".
  const mode = parseAuthMode(env.CAPACITYLENS_AUTH)

  if (mode === 'off') {
    if (env.CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION === '1') {
      // Operator opted in: run the open/demo posture in production ON PURPOSE. Downgrade to a
      // warning so it is still visible, but let the daemon boot.
      warnings.push(
        'auth is OFF in production but CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION=1, so the open/demo dataset (DEMO_USER, no login) is deliberately exposed to anyone who can reach this server. Unset CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION and set CAPACITYLENS_AUTH=password|sso to require login.',
      )
    } else {
      // The dev/open posture P3.1 retires. Fail closed: the demo dataset would be world
      // readable+writable. Name both the fix and the explicit opt-in escape.
      refusals.push(
        'auth is OFF (CAPACITYLENS_AUTH unset or "off") under NODE_ENV=production — the open/demo dataset (DEMO_USER, no login) would be world-readable and world-writable. Set CAPACITYLENS_AUTH=password or sso to require login, or set CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION=1 to deliberately run the open/demo posture.',
      )
    }
  }

  if (mode === 'password' && env.CAPACITYLENS_REQUIRE_MFA !== '1') {
    warnings.push(
      'CAPACITYLENS_REQUIRE_MFA is not 1, so password users are not required to enroll TOTP MFA. MFA is optional for self-hosting but strongly recommended for internet-facing deployments.',
    )
  }
  if (mode === 'sso' && env.CAPACITYLENS_SSO_MFA_ENFORCED !== '1') {
    warnings.push(
      'CAPACITYLENS_SSO_MFA_ENFORCED is not 1, so CapacityLens has no operator assurance that the configured identity provider requires MFA. This is optional for self-hosting but strongly recommended.',
    )
  }
  if (mode === 'password' && env.CAPACITYLENS_PASSWORD_BREACH_CHECK === 'off') {
    warnings.push(
      'CAPACITYLENS_PASSWORD_BREACH_CHECK=off disables breached-password screening. This is supported for isolated/offline deployments but weakens password protection.',
    )
  }
  const rateLimit = Number(env.CAPACITYLENS_RATE_LIMIT)
  if (!Number.isSafeInteger(rateLimit) || rateLimit < 1) {
    refusals.push('CAPACITYLENS_RATE_LIMIT must be a positive integer under NODE_ENV=production.')
  }
  if (env.CAPACITYLENS_AUDIT === 'off') {
    refusals.push('CAPACITYLENS_AUDIT=off is not permitted under NODE_ENV=production.')
  }
  if (env.CAPACITYLENS_AUDIT_STDOUT !== '1') {
    warnings.push(
      'CAPACITYLENS_AUDIT_STDOUT is not 1, so mutation audit records remain only in the local audit file and are unavailable to a process-log collector.',
    )
  }
  if (env.CAPACITYLENS_STORAGE_ENCRYPTED !== '1') {
    warnings.push(
      'CAPACITYLENS_STORAGE_ENCRYPTED is not 1, so encrypted-at-rest storage for the database, audit log and backups has not been attested. Startup continues for simple self-hosting; protect the host and storage appropriately.',
    )
  }
  if (env.CAPACITYLENS_SECURITY_LOG_FORWARDING !== '1') {
    warnings.push(
      'CAPACITYLENS_SECURITY_LOG_FORWARDING is not 1, so security/audit logs have not been attested as forwarded to a separate monitoring system. Local logs remain supported.',
    )
  }
  const internalTlsCert = env.CAPACITYLENS_INTERNAL_TLS_CERT?.trim()
  const internalTlsKey = env.CAPACITYLENS_INTERNAL_TLS_KEY?.trim()
  if (!internalTlsCert && !internalTlsKey) {
    warnings.push(
      'CAPACITYLENS_INTERNAL_TLS_CERT and CAPACITYLENS_INTERNAL_TLS_KEY are not configured, so the API uses HTTP. This is supported only behind a trusted same-host loopback reverse proxy; configure both paths to encrypt the internal hop.',
    )
  }

  // Production concerns evaluated regardless of auth mode.
  if (env.CAPACITYLENS_HTTPS !== '1') {
    warnings.push(
      'CAPACITYLENS_HTTPS is not 1 under NODE_ENV=production, so HSTS is not enabled. If TLS terminates at a reverse proxy this is expected; if this process serves HTTPS directly, set CAPACITYLENS_HTTPS=1.',
    )
  }
  if (env.CAPACITYLENS_ALLOW_OPEN_SIGNUP === '1') {
    warnings.push(
      'CAPACITYLENS_ALLOW_OPEN_SIGNUP=1 under NODE_ENV=production enables open self-registration. Self-service signup should normally be closed/invite-only in production; unset CAPACITYLENS_ALLOW_OPEN_SIGNUP unless you intend open registration.',
    )
  }
  if (env.CAPACITYLENS_CREATE_ADMIN_ADMIN === '1') {
    refusals.push(
      `CAPACITYLENS_CREATE_ADMIN_ADMIN=1 (or --create-owner-admin-admin) is development-only under NODE_ENV=production because its initial credential cannot be forced to expire after first use. Create the first owner through the setup-token flow instead (${BOOTSTRAP_ADMIN_EMAIL} is not created).`,
    )
  }
  if (env.CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD) {
    refusals.push(
      `CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD is not permitted under NODE_ENV=production because an operator-selected initial credential cannot be forced to expire after first use. Use the setup-token owner flow instead (${BOOTSTRAP_ADMIN_EMAIL} is not created).`,
    )
  }

  return { refusals, warnings }
}
