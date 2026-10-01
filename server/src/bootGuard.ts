// Boot-time safety interlock: POST /api/test/reset wipes the whole
// dataset, so it must be impossible in production, not merely unconfigured. A process asked
// to run with both CAPACITYLENS_ALLOW_RESET=1 and NODE_ENV=production refuses to start, dev and
// e2e (where NODE_ENV is never 'production') are untouched. Deliberately not behind a flag:
// defaulting a guard to off defeats it.

export function isResetForbidden(environment: { CAPACITYLENS_ALLOW_RESET?: string; NODE_ENV?: string }): boolean {
  return environment.CAPACITYLENS_ALLOW_RESET === "1" && environment.NODE_ENV === "production";
}
