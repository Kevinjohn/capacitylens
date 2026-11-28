import type { ApiClient, ApiRequest, ApiResponse } from '@japa/api-client'
import app from '@adonisjs/core/services/app'
import { AccountAdmission } from '@kevinjohn/adonisjs-account-kit/admission'
import User from '#models/user'
import { asActor, createFixtureCompanyForOwner } from '#tests/helpers/authenticated_data_fixture'
import { createIdentity } from '#tests/helpers/identities'

export const companyId = 'a-studio'
export const owner = 'bruce.wayne@wayne.example'
export const person = 'clark.kent@wayne.example'
export const password = 'admission-password-2026'
export const decisionRoutes = {
  approve: 'api.admission_approvals.store',
  reject: 'api.admission_rejections.store',
  revoke: 'api.admission_revocations.store',
} as const

/** A user signs in afresh on every request; a session cookie is reused as is. */
export const as = (actor: User | string) => ({
  get: (request: ApiRequest): Promise<ApiResponse> => asActor(request, actor).send(),
  post: (request: ApiRequest, body: object = {}): Promise<ApiResponse> =>
    asActor(request, actor).json(body).send(),
})

export const planning = (client: ApiClient, actor: User | string) =>
  as(actor).get(client.visit('api.planning.show', { companyId }))

export async function company() {
  const ownerId = await createIdentity(owner, { name: 'Bruce Wayne' })
  await createFixtureCompanyForOwner(ownerId, 'Wayne Enterprises', companyId)
  return User.findOrFail(ownerId)
}

/** A confirmed identity with operator invitation evidence for `role`, waiting for approval. */
export async function invitedIdentity(role: string) {
  const userId = await createIdentity(person, { password, admitted: false })
  const admission = await app.container.make(AccountAdmission)
  await admission.operator.grantInvitation({ email: person, role })
  return userId
}
