import { m } from "@/i18n";
import { isAccountRole, isIsoInstant } from "@capacitylens/shared/account/types";
import type { InvitePreview } from "./InviteAcceptView";

// Map the accept endpoint's status codes to the surfaced message. 404/409/410 are the documented
// invite outcomes (unknown / already-used / expired); the server's JSON `{ error }` body carries a
// friendly sentence we prefer, with a safe fallback per status when the body is missing/unreadable.
export function messageForStatus(status: number, bodyError: string | undefined): string {
  if (bodyError) return bodyError;
  if (status === 404) return m.invite_err_not_found();
  if (status === 409) return m.invite_err_used();
  if (status === 410) return m.invite_err_expired();
  if (status === 401) return m.invite_err_signin();
  return m.invite_err_generic();
}
export function parsePreview(value: unknown): InvitePreview | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.accountName !== "string" || row.accountName.trim().length === 0) return null;
  if (!isAccountRole(row.role) || row.role === "owner") return null;
  if (!isIsoInstant(row.expiresAt)) return null;
  return {
    accountName: row.accountName,
    role: row.role,
    expiresAt: row.expiresAt,
  };
}

export async function accountFailure(response: Response): Promise<{ code: string | null; message: string | null }> {
  const body: unknown = await response.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return { code: null, message: null };
  const failure = body as { code?: unknown; error?: unknown };
  return {
    code: typeof failure.code === "string" ? failure.code : null,
    message: typeof failure.error === "string" && failure.error.length > 0 ? failure.error : null,
  };
}
