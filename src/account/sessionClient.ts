import { isAccountSessionId } from "@capacitylens/shared/account/validation";
import { API_BASE } from "../data/apiConfig";
import { apiFetch } from "../data/requestTimeout";

/** A validated session row for the security settings directory. */
export interface SessionView {
  id: string;
  createdAt: string;
  expiresAt: string | null;
  current: boolean;
}

/** Session-list outcomes distinguish invalid rows from an unavailable directory or expired sign-in. */
export type SessionListResult =
  { kind: "loaded"; sessions: SessionView[] } | { kind: "unauthorized" } | { kind: "failed" } | { kind: "invalid" };

function isSessionView(value: unknown): value is SessionView {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<SessionView>;
  return (
    isAccountSessionId(row.id) &&
    typeof row.createdAt === "string" &&
    Number.isFinite(Date.parse(row.createdAt)) &&
    (row.expiresAt === null || (typeof row.expiresAt === "string" && Number.isFinite(Date.parse(row.expiresAt)))) &&
    typeof row.current === "boolean"
  );
}

/** Load the complete validated directory; transport failures are logged and returned as failed. */
export async function listSessions(): Promise<SessionListResult> {
  try {
    const response = await apiFetch(`${API_BASE}/api/account/sessions`, {
      credentials: "include",
    });
    if (response.status === 401) return { kind: "unauthorized" };
    if (!response.ok) return { kind: "failed" };
    // An unreadable envelope follows the same visible load-failure path as a malformed one.
    const body: unknown = await response.json().catch(() => null);
    const rows =
      body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      Array.isArray((body as { sessions?: unknown }).sessions)
        ? (body as { sessions: unknown[] }).sessions
        : null;
    if (rows === null) return { kind: "failed" };
    const valid = rows.filter(isSessionView);
    if (valid.length !== rows.length) return { kind: "invalid" };
    return { kind: "loaded", sessions: valid };
  } catch (cause) {
    console.error("sessionClient: session list failed", cause);
    return { kind: "failed" };
  }
}
