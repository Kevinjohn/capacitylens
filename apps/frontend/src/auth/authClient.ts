import { API_BASE } from "@/data/apiConfig";
import { apiFetch } from "@/data/requestTimeout";

export interface AuthApiError {
  message: string;
  code?: string;
  status: number;
}

export interface AuthApiResult<T> {
  data: T | null;
  error: AuthApiError | null;
}

export interface AuthUserResponse {
  id: string;
  name: string;
  email: string;
  image: null;
}

interface PasswordCredentials {
  email: string;
  password: string;
}

interface AuthUserResponseBody {
  user: AuthUserResponse;
}

interface PasswordChangeInput {
  currentPassword: string;
  newPassword: string;
}

function readErrorMessage(value: unknown, status: number): AuthApiError {
  if (typeof value === "object" && value !== null) {
    const body = value as Record<string, unknown>;
    return {
      message: typeof body.error === "string" ? body.error : `Authentication request failed (${status}).`,
      ...(typeof body.code === "string" ? { code: body.code } : {}),
      status,
    };
  }
  return { message: `Authentication request failed (${status}).`, status };
}

async function request<T>(method: "GET" | "POST", path: string, body: unknown): Promise<AuthApiResult<T>> {
  const response = await apiFetch(`${API_BASE}/api/${path}`, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) return { data: null, error: readErrorMessage(payload, response.status) };
  return { data: payload as T, error: null };
}

const post = <T>(path: string, body: unknown) => request<T>("POST", path, body);

/** The Account Kit admission decision the server reports for the signed-in identity. */
export interface AdmissionDecisionBody {
  decision: { admitted: boolean };
}

/** Typed browser client for the product's session, credential, confirmation and admission endpoints. */
export const authClient = {
  signIn: {
    email: (input: PasswordCredentials) => post<AuthUserResponseBody>("auth/sign-in", input),
  },
  signOut: () => post<{ ok: true }>("auth/sign-out", {}),
  requestPasswordReset: (email: string) => post<{ ok: true }>("auth/request-reset", { email }),
  inspectPasswordReset: (token: string) => post<{ valid: boolean }>("auth/inspect-reset", { token }),
  resetPassword: (input: { token: string; newPassword: string }) => post<{ ok: true }>("auth/reset-password", input),
  /** Ends every sign-in, this one included, once the password changes. */
  changePassword: (input: PasswordChangeInput) => post<{ ok: true; signedOut: true }>("auth/change-password", input),
  sendEmailVerification: () => post<{ result: "sent" | "already_verified" }>("auth/verification/send", {}),
  inspectEmailVerification: (token: string) => post<{ valid: boolean }>("auth/verification/inspect", { token }),
  /** Confirms the address and sets the password the person chose. */
  completeEmailVerification: (input: { token: string; password: string }) =>
    post<{ result: "verified" }>("auth/verification/complete", input),
  admissionStatus: () => request<AdmissionDecisionBody>("GET", "admission", null),
  requestAdmission: () => post<{ requestedAt: string }>("admission/request", {}),
  /** Creates the admitted identity's company membership; never reactivates disabled access. */
  completeMembership: () => post<{ accountId: string; role: string; created: boolean }>("admission/complete", {}),
};
