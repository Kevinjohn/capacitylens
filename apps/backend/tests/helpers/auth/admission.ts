import type { ApiClient, ApiRequest, ApiResponse } from '@japa/api-client';
import app from '@adonisjs/core/services/app';
import { AccountAdmission } from '@kevinjohn/adonisjs-account-kit/admission';
import {
  asDataOwner,
  createFixtureCompanyForOwner,
} from '#tests/helpers/authenticated_data_fixture';
import { createIdentity, signIn } from '#tests/helpers/identities';

export const companyId = 'a-studio';
export const owner = 'bruce.wayne@wayne.example';
export const person = 'clark.kent@wayne.example';
export const password = 'admission-password-2026';
export const decisionRoutes = {
  approve: 'api.admission_approvals.store',
  reject: 'api.admission_rejections.store',
  revoke: 'api.admission_revocations.store',
} as const;

export const as = (cookie: string) => ({
  get: (request: ApiRequest): Promise<ApiResponse> => asDataOwner(request, cookie).send(),
  post: (request: ApiRequest, body: object = {}): Promise<ApiResponse> =>
    asDataOwner(request, cookie).json(body).send(),
});

export const planning = (client: ApiClient, cookie: string) =>
  as(cookie).get(client.visit('api.planning.show', { companyId }));

export async function company(api: ApiClient) {
  const ownerId = await createIdentity(owner, { name: 'Bruce Wayne' });
  await createFixtureCompanyForOwner(ownerId, 'Wayne Enterprises', companyId);
  return signIn(api, owner);
}

/** A confirmed identity with operator invitation evidence for `role`, waiting for approval. */
export async function invitedIdentity(role: string) {
  const userId = await createIdentity(person, { password, admitted: false });
  const admission = await app.container.make(AccountAdmission);
  await admission.operator.grantInvitation({ email: person, role });
  return userId;
}
