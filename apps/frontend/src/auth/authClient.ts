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

interface OwnerCredentials extends PasswordCredentials {
  name: string;
  fetchOptions?: { headers?: HeadersInit };
}

interface ProviderStartInput {
  provider: string;
  callbackURL: string;
  errorCallbackURL: string;
  fetchOptions?: { signal?: AbortSignal };
}

interface AuthUserResponseBody {
  user: AuthUserResponse;
}

interface ProviderStartResponse {
  url: string;
}

interface PasswordChangeInput {
  currentPassword: string;
  newPassword: string;
  revokeOtherSessions: boolean;
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

async function post<T>(
  path: string,
  body: unknown,
  options: { headers?: HeadersInit; signal?: AbortSignal } = {},
): Promise<AuthApiResult<T>> {
  const response = await apiFetch(`${API_BASE}/api/auth/${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...Object.fromEntries(new Headers(options.headers).entries()) },
    body: JSON.stringify(body),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) return { data: null, error: readErrorMessage(payload, response.status) };
  return { data: payload as T, error: null };
}

/** Typed browser client for the product's session and password-authentication endpoints. */
export const authClient = {
  signIn: {
    email: (input: PasswordCredentials) => post<AuthUserResponseBody>("sign-in", input),
    social: (input: ProviderStartInput) =>
      post<ProviderStartResponse>(
        "provider-start",
        {
          provider: input.provider,
          callbackURL: input.callbackURL,
          errorCallbackURL: input.errorCallbackURL,
        },
        input.fetchOptions?.signal ? { signal: input.fetchOptions.signal } : {},
      ),
  },
  signUp: {
    email: (input: OwnerCredentials) =>
      post<AuthUserResponseBody>(
        "sign-up",
        { email: input.email, password: input.password, name: input.name },
        input.fetchOptions?.headers ? { headers: input.fetchOptions.headers } : {},
      ),
  },
  signOut: () => post<{ ok: true }>("sign-out", {}),
  requestPasswordReset: (email: string) => post<{ ok: true }>("request-reset", { email }),
  resetPassword: (input: { token: string; newPassword: string }) => post<{ ok: true }>("reset-password", input),
  changePassword: (input: PasswordChangeInput) => post<{ ok: true }>("change-password", input),
};
