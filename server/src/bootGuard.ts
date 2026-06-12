// Boot-time safety interlock (production plan P1.6): POST /api/test/reset wipes the whole
// dataset, so it must be IMPOSSIBLE in production, not merely unconfigured. A process asked
// to run with both FLOATY_ALLOW_RESET=1 and NODE_ENV=production refuses to start — dev and
// e2e (where NODE_ENV is never 'production') are untouched. Deliberately NOT behind a flag:
// defaulting a guard to off defeats it (plan exception 3).

export function resetForbidden(env: { FLOATY_ALLOW_RESET?: string; NODE_ENV?: string }): boolean {
  return env.FLOATY_ALLOW_RESET === '1' && env.NODE_ENV === 'production'
}
