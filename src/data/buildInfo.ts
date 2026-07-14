// Build provenance for tester bug reports (production plan P1.7), read from the build-time
// env like apiConfig. The deploy script sets VITE_CAPACITYLENS_BUILD_SHA; a build without it (dev
// server, plain local build) renders no stamp at all. The mode suffix exists because the demo
// build looks otherwise identical to a real server deploy — the stamp is how the
// post-deploy smoke test proves the deploy really is in server mode, not the demo build.

import { isServerConfigured } from './apiConfig'
import { APP_NAME } from '@capacitylens/shared/brand'

/** The muted Settings footer line, e.g. `build a1b2c3d · server`, or null when the build
 *  carries no sha (render nothing — today's Settings exactly). */
export function buildStamp(): string | null {
  const sha = (import.meta.env.VITE_CAPACITYLENS_BUILD_SHA ?? '').trim()
  if (!sha) return null
  return `build ${sha} · ${isServerConfigured() ? 'server' : 'demo'}`
}

/** The Settings "Send feedback" mailto href (P5.2, flag VITE_CAPACITYLENS_FEEDBACK_MAILTO), or
 *  null when the build carries no address (render nothing). The subject carries the build
 *  stamp when there is one, so tester reports arrive pinned to a build. */
export function feedbackMailto(): string | null {
  const addr = (import.meta.env.VITE_CAPACITYLENS_FEEDBACK_MAILTO ?? '').trim()
  if (!addr) return null
  const stamp = buildStamp()
  const subject = stamp ? `${APP_NAME} feedback — ${stamp}` : `${APP_NAME} feedback`
  return `mailto:${addr}?subject=${encodeURIComponent(subject)}`
}
