import { readHttpErrorBody } from '@capacitylens/shared/api/httpErrors'
import type { HttpErrorBody } from '@capacitylens/shared/api/httpErrors'
import type { RequestArgs, ResponseOf } from '@tuyau/core/types'
import type { registry, Route } from '@capacitylens/backend/registry'
import { client, requestApiResponse } from '@/api/queryClient'
import type { ProductRoutes } from '@/api/queryClient'

export interface AuthApiError extends Omit<HttpErrorBody, 'error'> {
  message: string
  status: number
}

export interface AuthApiResult<T> {
  data: T | null
  error: AuthApiError | null
}

type PasswordCredentials = RequestArgs<(typeof registry.routes)['api.session.store']>['body']

interface PasswordChangeInput {
  currentPassword: string
  newPassword: string
}

function readErrorMessage(value: unknown, status: number): AuthApiError {
  const { error: message, ...metadata } = readHttpErrorBody(
    value,
    `Authentication request failed (${status}).`
  )
  return { message, ...metadata, status }
}

type AuthRoute = Extract<
  keyof ProductRoutes,
  | 'api.session.show'
  | 'api.session.destroy'
  | 'api.password_confirmations.store'
  | 'api.password_reset_requests.store'
  | 'api.password_resets.show'
  | 'api.password_resets.update'
  | 'api.password.update'
  | 'api.account.destroy'
  | 'api.email_verification_requests.store'
  | 'api.email_verifications.show'
  | 'api.email_verifications.update'
  | 'api.admission.show'
  | 'api.admission_requests.store'
  | 'api.memberships.store'
>

async function request<Name extends AuthRoute>(
  name: Name,
  args: RequestArgs<ProductRoutes[Name]>
): Promise<AuthApiResult<ResponseOf<ProductRoutes[Name]>['data']>> {
  const response = await requestApiResponse(name, args)
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) return { data: null, error: readErrorMessage(payload, response.status) }
  // A success without a readable envelope carries no data, as an unreadable body did before.
  return { data: (payload as ResponseOf<ProductRoutes[Name]> | null)?.data ?? null, error: null }
}

const post = <Name extends AuthRoute>(name: Name, body: Route.Body<Name>) =>
  // Every auth route takes no path parameters, so the body is its whole request.
  request(name, { body } as unknown as RequestArgs<ProductRoutes[Name]>)

/** Typed browser client for the product's session, credential, confirmation and admission endpoints. */
export const authApi = {
  signIn: {
    email: async (input: PasswordCredentials) => {
      const received: { response?: { ok: boolean; status: number; payload: unknown } } = {}
      const [data, error] = await client
        .request('api.session.store', {
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
                }
              },
            ],
          },
        })
        .safe()
      if (received.response && !received.response.ok) {
        return {
          data: null,
          error: readErrorMessage(received.response.payload, received.response.status),
        }
      }
      if (!error) return { data: data.data, error: null }
      if (received.response) return { data: null, error: null }
      // Before a response, callers still receive the native fetch or abort failure.
      if (error.kind === 'network') throw error.cause
      throw error
    },
  },
  signOut: () => post('api.session.destroy', {}),
  requestPasswordReset: (email: string) => post('api.password_reset_requests.store', { email }),
  inspectPasswordReset: (token: string) => post('api.password_resets.show', { token }),
  resetPassword: (input: { token: string; newPassword: string }) =>
    post('api.password_resets.update', input),
  /** Ends every sign-in, this one included, once the password changes. */
  changePassword: (input: PasswordChangeInput) => post('api.password.update', input),
  /** Deletes the signed-in identity after re-entering its password; the server ends the sign-in. */
  deleteAccount: (input: { currentPassword: string }) => post('api.account.destroy', input),
  sendEmailVerification: () => post('api.email_verification_requests.store', {}),
  inspectEmailVerification: (token: string) => post('api.email_verifications.show', { token }),
  /** Confirms the address and sets the password the person chose. */
  completeEmailVerification: (input: { token: string; password: string }) =>
    post('api.email_verifications.update', input),
  admissionStatus: () => request('api.admission.show', {}),
  requestAdmission: () => post('api.admission_requests.store', {}),
  /** Creates the admitted identity's company membership; never restores suspended access. */
  completeMembership: () => post('api.memberships.store', {}),
}
