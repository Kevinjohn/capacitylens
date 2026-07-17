import type { AuthMode } from '../auth/authContext'
import { isDemoMode } from '../data/apiConfig'

/** Product-facing access posture. Authentication being off on a persisted server is deliberately
 * distinct from the disposable in-memory demo; neither is represented as a fictional Owner role. */
export type AccessExperience = 'demo' | 'open' | 'authenticated'

export function accessExperienceFor(authMode: AuthMode): AccessExperience {
  if (isDemoMode()) return 'demo'
  return authMode === 'off' ? 'open' : 'authenticated'
}
