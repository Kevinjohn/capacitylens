import { readHttpErrorBody } from '@capacitylens/shared/api/httpErrors';
import type { HttpErrorBody } from '@capacitylens/shared/api/httpErrors';
import type { RequestArgs, ResponseOf } from '@tuyau/core/types';
import type { registry } from '@capacitylens/backend/registry';
import { client, apiRouteUrl } from '@/api/queryClient';
import { apiFetch } from '@/data/requestTimeout';

export interface AuthApiError extends Omit<HttpErrorBody, 'error'> {
  message: string;
  status: number;
}

export interface AuthApiResult<T> {
  data: T | null;
  error: AuthApiError | null;
}

type PasswordCredentials = RequestArgs<(typeof registry.routes)['api.auth.sign-in']>['body'];

interface PasswordChangeInput {
  currentPassword: string;
  newPassword: string;
}

function readErrorMessage(value: unknown, status: number): AuthApiError {
  const { error: message, ...metadata } = readHttpErrorBody(
    value,
    `Authentication request failed (${status}).`,
  );
  return { message, ...metadata, status };
}

type ProductRoutes = typeof registry.routes;
type AuthRoute = Exclude<
  Extract<
    keyof ProductRoutes,
    `api.auth.${string}` | 'api.admission.show' | 'api.admission.request' | 'api.admission.complete'
  >,
  'api.auth.sign-in' | 'api.auth.sign-up'
>;

async function request<Name extends AuthRoute>(
  method: 'GET' | 'POST',
  name: Name,
  body: unknown,
): Promise<AuthApiResult<ResponseOf<ProductRoutes[Name]>>> {
  const response = await apiFetch(apiRouteUrl<AuthRoute>(name, {}), {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) return { data: null, error: readErrorMessage(payload, response.status) };
  return { data: payload as ResponseOf<ProductRoutes[Name]>, error: null };
}

// The remaining credential controllers validate bodies manually. Keep their existing transport
// until their generated registry describes those inputs, while deriving successes from it.
const post = <Name extends AuthRoute>(name: Name, body: unknown) => request('POST', name, body);

/** Typed browser client for the product's session, credential, confirmation and admission endpoints. */
export const authClient = {
  signIn: {
    email: async (input: PasswordCredentials) => {
      const received: { response?: { ok: boolean; status: number; payload: unknown } } = {};
      const [data, error] = await client
        .request('api.auth.sign-in', {
          body: input,
          responseType: 'json',
          hooks: {
            afterResponse: [
              async (_request, _options, response) => {
                // Ky supplies a clone: retain the original JSON-read fallback and HTTP status
                // even when Tuyau's later success/error decoding cannot read the body.
                received.response = {
                  ok: response.ok,
                  status: response.status,
                  payload: await response.json().catch(() => null),
                };
              },
            ],
          },
        })
        .safe();
      if (received.response && !received.response.ok) {
        return {
          data: null,
          error: readErrorMessage(received.response.payload, received.response.status),
        };
      }
      if (!error) return { data, error: null };
      if (received.response) return { data: null, error: null };
      // Before a response, callers still receive the native fetch or abort failure.
      if (error.kind === 'network') throw error.cause;
      throw error;
    },
  },
  signOut: () => post('api.auth.sign-out', {}),
  requestPasswordReset: (email: string) => post('api.auth.request-reset', { email }),
  inspectPasswordReset: (token: string) => post('api.auth.inspect-reset', { token }),
  resetPassword: (input: { token: string; newPassword: string }) =>
    post('api.auth.reset-password', input),
  /** Ends every sign-in, this one included, once the password changes. */
  changePassword: (input: PasswordChangeInput) => post('api.auth.change-password', input),
  sendEmailVerification: () => post('api.auth.verification.send', {}),
  inspectEmailVerification: (token: string) => post('api.auth.verification.inspect', { token }),
  /** Confirms the address and sets the password the person chose. */
  completeEmailVerification: (input: { token: string; password: string }) =>
    post('api.auth.verification.complete', input),
  admissionStatus: () => request('GET', 'api.admission.show', null),
  requestAdmission: () => post('api.admission.request', {}),
  /** Creates the admitted identity's company membership; never reactivates disabled access. */
  completeMembership: () => post('api.admission.complete', {}),
};
