import type { RequestArgs, ResponseOf } from "@tuyau/core/types";
import type { registry } from "@capacitylens/backend/registry";
import { client, apiRouteUrl } from "@/api/queryClient";
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

type PasswordCredentials = RequestArgs<(typeof registry.routes)["api.auth.sign-in"]>["body"];

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

type ProductRoutes = typeof registry.routes;
type AuthRoute = Exclude<
  Extract<
    keyof ProductRoutes,
    `api.auth.${string}` | "api.admission.show" | "api.admission.request" | "api.admission.complete"
  >,
  "api.auth.sign-in" | "api.auth.sign-up"
>;

async function request<Name extends AuthRoute>(
  method: "GET" | "POST",
  name: Name,
  body: unknown,
): Promise<AuthApiResult<ResponseOf<ProductRoutes[Name]>>> {
  const response = await apiFetch(apiRouteUrl<AuthRoute>(name, {}), {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) return { data: null, error: readErrorMessage(payload, response.status) };
  return { data: payload as ResponseOf<ProductRoutes[Name]>, error: null };
}

// The remaining credential controllers validate bodies manually. Keep their existing transport
// until their generated registry describes those inputs, while deriving successes from it.
const post = <Name extends AuthRoute>(name: Name, body: unknown) => request("POST", name, body);

/** Typed browser client for the product's session, credential, confirmation and admission endpoints. */
export const authClient = {
  signIn: {
    email: async (input: PasswordCredentials) => {
      const [data, error] = await client
        .request("api.auth.sign-in", {
          body: input,
          responseType: "json",
          // Keep the existing null result for a successful response with an unreadable JSON body.
          parseJson: (text) => {
            try {
              return JSON.parse(text);
            } catch {
              return null;
            }
          },
        })
        .safe();
      if (!error) return { data, error: null };
      // Callers already distinguish native transport/abort failures from HTTP refusals.
      if (error.kind === "network") throw error.cause;
      return { data: null, error: readErrorMessage(error.response, error.status ?? 500) };
    },
  },
  signOut: () => post("api.auth.sign-out", {}),
  requestPasswordReset: (email: string) => post("api.auth.request-reset", { email }),
  inspectPasswordReset: (token: string) => post("api.auth.inspect-reset", { token }),
  resetPassword: (input: { token: string; newPassword: string }) => post("api.auth.reset-password", input),
  /** Ends every sign-in, this one included, once the password changes. */
  changePassword: (input: PasswordChangeInput) => post("api.auth.change-password", input),
  sendEmailVerification: () => post("api.auth.verification.send", {}),
  inspectEmailVerification: (token: string) => post("api.auth.verification.inspect", { token }),
  /** Confirms the address and sets the password the person chose. */
  completeEmailVerification: (input: { token: string; password: string }) =>
    post("api.auth.verification.complete", input),
  admissionStatus: () => request("GET", "api.admission.show", null),
  requestAdmission: () => post("api.admission.request", {}),
  /** Creates the admitted identity's company membership; never reactivates disabled access. */
  completeMembership: () => post("api.admission.complete", {}),
};
