import type { AuthMode } from "../auth/authContext";
import { isDemoMode } from "../data/apiConfig";

/** Product-facing access posture. Authentication being off on a persisted server is deliberately
 * distinct from the disposable in-memory demo; neither is represented as a fictional Owner role. */
export type AccessExperience = "demo" | "open" | "authenticated";

/** The posture the product SHOWS (access badge, summaries — see accessCopy.ts). It is not the only
 *  demo predicate: `useDemoAuthActive` in lib/fakeAuth.ts owns the narrower, purely COSMETIC
 *  question of whether the fake sign-in chrome is on screen (a "demo" experience whose `authMode`
 *  is also "off"). Keep the two apart — this one describes access, that one describes chrome. */
export function accessExperienceFor(authMode: AuthMode): AccessExperience {
  if (isDemoMode()) return "demo";
  return authMode === "off" ? "open" : "authenticated";
}
