import { matchPath } from "react-router-dom";

export type PublicAuthEntry = "password-reset" | "invitation" | null;

export const PUBLIC_AUTH_ENTRY_PATHS = {
  passwordReset: "/reset-password/:token",
  invitation: "/invite/:token",
} as const;

/** Classify the only routes allowed to render before authentication using the same patterns and
 * matching semantics as the router. Malformed or nested URLs remain behind the normal login wall. */
export function publicAuthEntryForPath(pathname: string): PublicAuthEntry {
  if (matchPath(PUBLIC_AUTH_ENTRY_PATHS.passwordReset, pathname)) return "password-reset";
  if (matchPath(PUBLIC_AUTH_ENTRY_PATHS.invitation, pathname)) return "invitation";
  return null;
}
