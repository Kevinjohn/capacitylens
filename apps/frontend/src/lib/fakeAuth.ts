import { useAuth } from "@/auth/authContext";
import { isDemoMode } from "@/data/apiConfig";

// The demo identity is shown only in an explicit demo build with authentication off. It labels the
// demo's account chrome and never authorizes access to scheduling data.

/** The persona the demo shows in the sidebar and on the Account page. */
export const FAKE_USER = {
  name: "Bruce Wayne",
  email: "bruce.wayne@wayne.example",
} as const;

/** Returns true only for an explicit demo build whose server auth mode is off. */
export function useDemoAuthActive(): boolean {
  const { authMode } = useAuth();
  return isDemoMode() && authMode === "off";
}
