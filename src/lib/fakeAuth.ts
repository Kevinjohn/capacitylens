import { useAuth } from "@/auth/authContext";
import { isDemoMode } from "@/data/apiConfig";

// The cosmetic identity is active only in an explicit demo build with authentication off.
// It provides sign-in chrome and never authorizes access to scheduling data.

/** The persona shown on the demo sign-in card and the picker's "Signed in as" line. */
export const FAKE_USER = {
  name: "Bruce Wayne",
  email: "bruce.wayne@wayne.example",
} as const;

/** Returns true only for an explicit demo build whose server auth mode is off.
 * Real authentication suppresses cosmetic sign-in even in a demo build.
 */
export function useDemoAuthActive(): boolean {
  const { authMode } = useAuth();
  return isDemoMode() && authMode === "off";
}
