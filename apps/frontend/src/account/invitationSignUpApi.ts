import { isRecord } from '@capacitylens/shared/lib/isRecord'
import { readApiData } from '@/api/readApiData'
import { readApiError, readApiErrorCode } from '@/lib/readApiError'
import type { InvitationSignUpBody } from './accountRequestTypes'
import { invitationSignUpRequests } from './invitationSignUpRequests'

/** What an invitation link shows before sign-up. */
export interface InvitationPreview {
  companyName: string | null
  role: string | null
  email: string
}

/**
 * The preview of one invitation link. `invalid` is a not-found or rejected token; `unavailable` is
 * any other failure or an off-spec answer, which may pass on retry.
 */
export type InvitationPreviewResult =
  { kind: 'ok'; preview: InvitationPreview } | { kind: 'invalid' } | { kind: 'unavailable' }

/**
 * The answer to one invitation sign-up. `uncertain` is a server failure after which the account
 * may exist; `refused` carries the server's message when it sent one.
 */
export type InvitationSignUpResult =
  | { kind: 'signed-up' }
  | { kind: 'uncertain' }
  | { kind: 'invalid-token' }
  | { kind: 'email-in-use' }
  | { kind: 'refused'; message: string | undefined }

function parsePreview(body: unknown): InvitationPreview | null {
  if (!isRecord(body) || typeof body.email !== 'string') return null
  return {
    email: body.email,
    companyName: typeof body.companyName === 'string' ? body.companyName : null,
    role: typeof body.role === 'string' ? body.role : null,
  }
}

/**
 * Reads what an invitation link offers.
 *
 * @throws The fetch failure when the server cannot be reached.
 */
export async function readInvitationPreview(token: string): Promise<InvitationPreviewResult> {
  const response = await invitationSignUpRequests.previewInvitation(token)
  if (response.status === 400 || response.status === 404) return { kind: 'invalid' }
  if (!response.ok) return { kind: 'unavailable' }
  // An unreadable body is an off-spec answer and is reported as unavailable.
  const preview = parsePreview(await readApiData(response).catch(() => null))
  return preview ? { kind: 'ok', preview } : { kind: 'unavailable' }
}

/**
 * Creates the invited identity with the invitation's fixed address.
 *
 * @throws The fetch failure when the answer was lost; the account may exist.
 */
export async function signUpWithInvitation(
  token: string,
  body: InvitationSignUpBody
): Promise<InvitationSignUpResult> {
  const response = await invitationSignUpRequests.signUpWithInvitation(token, body)
  if (response.ok) return { kind: 'signed-up' }
  if (response.status >= 500) return { kind: 'uncertain' }
  const code = await readApiErrorCode(response)
  if (code === 'INVALID_TOKEN') return { kind: 'invalid-token' }
  if (code === 'EMAIL_IN_USE') return { kind: 'email-in-use' }
  return { kind: 'refused', message: await readApiError(response) }
}
