import { isDemoMode } from "@/data/apiConfig";

/** Product-facing access posture distinguishes the explicit in-memory demo from authenticated server access. */
export type AccessExperience = "demo" | "authenticated";

/** The posture the product shows (access badge, summaries, see accessCopy.ts). It is not the only
 * demo predicate: `useDemoAuthActive` in lib/fakeAuth.ts owns the narrower, purely cosmetic
 * question of whether the fake sign-in chrome is on screen (a "demo" experience whose `authMode`
 * is also "off"). Keep the two apart. This one describes access, that one describes chrome. */
export function resolveAccessExperience(): AccessExperience {
  return isDemoMode() ? "demo" : "authenticated";
}
