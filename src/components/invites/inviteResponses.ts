import { m } from "@/i18n";
import { isAccountRole, isIsoInstant } from "@capacitylens/shared/account/types";
import type { InvitePreview } from "./InviteAcceptView";
import { hasDisallowedChars, MAX_EMAIL_LENGTH, utf8ByteLength } from "@capacitylens/shared/lib/strings";

function isMaskedEmailHint(value: unknown): value is string {
  if (typeof value !== "string" || !value.endsWith("@…")) return false;
  const localPart = value.slice(0, -2);
  return (
    localPart.length > 0 &&
    !localPart.includes("@") &&
    !/\s/u.test(localPart) &&
    !hasDisallowedChars(localPart) &&
    // Replacing the shortest valid domain (one byte) with the three-byte ellipsis adds two bytes.
    utf8ByteLength(value) <= MAX_EMAIL_LENGTH + 2
  );
}

function parseEmailMetadata(row: Record<string, unknown>): Pick<InvitePreview, "emailBound" | "emailHint"> | null {
  if (row.emailBound !== undefined && typeof row.emailBound !== "boolean") return null;
  if (row.emailHint !== undefined && row.emailHint !== null && !isMaskedEmailHint(row.emailHint)) return null;
  const emailBound = typeof row.emailBound === "boolean" ? row.emailBound : null;
  const emailHint = typeof row.emailHint === "string" ? row.emailHint : null;
  if (emailHint !== null && emailBound !== true) return null;
  return { emailBound, emailHint };
}

// Map the accept endpoint's status codes to the surfaced message. 404/409/410 are the documented
// invite outcomes (unknown / already-used / expired); the server's JSON `{ error }` body carries a
// friendly sentence we prefer, with a safe fallback per status when the body is missing/unreadable.
export function resolveMessageForStatus(status: number, bodyError: string | undefined): string {
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
  const emailMetadata = parseEmailMetadata(row);
  if (!emailMetadata) return null;
  return {
    accountName: row.accountName,
    role: row.role,
    expiresAt: row.expiresAt,
    ...emailMetadata,
  };
}

export async function readAccountFailure(response: Response): Promise<{ code: string | null; message: string | null }> {
  const body: unknown = await response.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return { code: null, message: null };
  const failure = body as { code?: unknown; error?: unknown };
  return {
    code: typeof failure.code === "string" ? failure.code : null,
    message: typeof failure.error === "string" && failure.error.length > 0 ? failure.error : null,
  };
}
