// Build provenance for tester bug reports (production plan P1.7), read from the build-time
// env like apiConfig. The deploy script sets VITE_FLOATY_BUILD_SHA; a build without it (dev
// server, plain local build) renders no stamp at all. The mode suffix exists because a build
// missing VITE_FLOATY_API silently reverts to localStorage and otherwise looks identical —
// the stamp is how the post-deploy smoke test proves the deploy really is in server mode.

import { isServerConfigured } from './apiConfig'

/** The muted Settings footer line, e.g. `build a1b2c3d · server`, or null when the build
 *  carries no sha (render nothing — today's Settings exactly). */
export function buildStamp(): string | null {
  const sha = (import.meta.env.VITE_FLOATY_BUILD_SHA ?? '').trim()
  if (!sha) return null
  return `build ${sha} · ${isServerConfigured() ? 'server' : 'local'}`
}
