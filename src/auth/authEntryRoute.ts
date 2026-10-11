import { matchPath } from "react-router-dom";

/** Public authentication route that can take precedence over the sign-in screen. */
export type PublicAuthEntry = "password-reset" | "invitation" | "company-join" | null;

/** Route patterns for token-based public authentication entries. */
export const PUBLIC_AUTH_ENTRY_PATHS = {
  passwordReset: "/reset-password/:token",
  invitation: "/invite/:token",
  companyJoin: "/join/:accountId",
} as const;

/** Classify the only routes allowed to render before authentication using the same patterns and
 * matching semantics as the router. Malformed or nested URLs remain behind the normal login wall. */
export function resolvePublicAuthEntry(pathname: string): PublicAuthEntry {
  if (matchPath(PUBLIC_AUTH_ENTRY_PATHS.passwordReset, pathname)) return "password-reset";
  if (matchPath(PUBLIC_AUTH_ENTRY_PATHS.invitation, pathname)) return "invitation";
  if (matchPath(PUBLIC_AUTH_ENTRY_PATHS.companyJoin, pathname)) return "company-join";
  return null;
}
