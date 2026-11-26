import type { RequestArgs } from '@tuyau/core/types';
import { client, requestApiResponse } from './queryClient';
import type { registry, Route } from '@capacitylens/backend/registry';

type Routes = typeof registry.routes;

/** Compile-time checks ensure generated request inputs cannot silently regress to empty objects. */
export function checkOrdinaryRequestContracts() {
  const signIn: RequestArgs<Routes['api.session.store']> = {
    body: { email: 'clark@wayne.example', password: 'secret' },
  };
  const signUp: RequestArgs<Routes['api.new_account.store']> = {
    body: { email: 'clark@wayne.example', password: 'secret', name: 'Clark Kent' },
  };
  const admission: RequestArgs<Routes['api.admission_requests.index']> = {
    query: { status: 'approved', cursor: 'opaque' },
  };
  const state: RequestArgs<Routes['api.company_state.show']> = {
    query: { companyId: 'a-studio', includeInactive: '1' },
  };
  const missingPassword: RequestArgs<Routes['api.session.store']> = {
    // @ts-expect-error Sign-in requires a password.
    body: { email: 'clark@wayne.example' },
  };
  const missingName: RequestArgs<Routes['api.new_account.store']> = {
    // @ts-expect-error The generated sign-up body requires the display name.
    body: { email: 'clark@wayne.example', password: 'secret' },
  };
  const invalidStatus: RequestArgs<Routes['api.admission_requests.index']> = {
    // @ts-expect-error Admission status is a generated finite union.
    query: { status: 'unknown' },
  };
  const invalidInactive: RequestArgs<Routes['api.company_state.show']> = {
    // @ts-expect-error State's inactive flag is the literal wire value.
    query: { companyId: 'a-studio', includeInactive: true },
  };
  void requestApiResponse('api.company_state.show', {
    // @ts-expect-error The generated read query refuses boolean inactive flags at the browser seam.
    query: { companyId: 'a-studio', includeInactive: true },
  });
  void requestApiResponse('api.company_state.show', {
    // @ts-expect-error Admission status cannot be supplied as a state query.
    query: { companyId: 'a-studio', status: 'pending' },
  });
  // @ts-expect-error Sign-in is a generated POST route, never GET.
  client.get('/api/v1/auth/sign-in', {});
  return {
    signIn,
    signUp,
    admission,
    state,
    missingPassword,
    missingName,
    invalidStatus,
    invalidInactive,
  };
}

/** Each body the browser builds is the generated validator input; a wrongly typed key fails here. */
export function checkBodyContracts() {
  return [
    {
      // @ts-expect-error The company name is a string.
      name: 42,
    } satisfies Route.Body<'api.first_company_setup.store'>,
    {
      document: {},
      // @ts-expect-error The transfer preview names its company by id.
      companyId: 42,
    } satisfies Route.Body<'api.import_previews.store'>,
    {
      companyId: 'a-studio',
      document: {},
      // @ts-expect-error The base revision is a number.
      baseRevision: null,
    } satisfies Route.Body<'api.imports.store'>,
    {
      // @ts-expect-error The anonymisation confirmation id is a string.
      confirmationId: 42,
    } satisfies Route.Body<'api.company_anonymisations.store'>,
    {
      action: 'transfer-ownership',
      companyId: 'a-studio',
      password: 'secret',
      intent: { toUserId: 42 },
      // @ts-expect-error A transfer-ownership intent names the new owner by id.
    } satisfies Route.Body<'api.password_confirmations.store'>,
    {
      // @ts-expect-error The recovery email is a string.
      email: 42,
    } satisfies Route.Body<'api.password_reset_requests.store'>,
    {
      // @ts-expect-error The reset token is a string.
      token: 42,
    } satisfies Route.Body<'api.password_resets.show'>,
    {
      token: 'token',
      // @ts-expect-error The new password is a string.
      newPassword: 42,
    } satisfies Route.Body<'api.password_resets.update'>,
    {
      newPassword: 'secret',
      // @ts-expect-error The current password is a string.
      currentPassword: 42,
    } satisfies Route.Body<'api.password.update'>,
    {
      // @ts-expect-error The current password is a string.
      currentPassword: 42,
    } satisfies Route.Body<'api.account.destroy'>,
    {
      // @ts-expect-error The confirmation token is a string.
      token: 42,
    } satisfies Route.Body<'api.email_verifications.show'>,
    {
      token: 'token',
      // @ts-expect-error The chosen password is a string.
      password: 42,
    } satisfies Route.Body<'api.email_verifications.update'>,
    {
      // @ts-expect-error Sign-in tracking is switched by a flag.
      enabled: null,
    } satisfies Route.Body<'api.member_sign_in_tracking.update'>,
    {
      // @ts-expect-error A member role is one of the company roles.
      role: 'superuser',
    } satisfies Route.Body<'api.members.update'>,
    {
      // @ts-expect-error A member status is active or suspended.
      status: 'deleted',
    } satisfies Route.Body<'api.member_status.update'>,
    {
      companyId: 'a-studio',
      email: 'clark@wayne.example',
      // @ts-expect-error An owner is never invited.
      role: 'owner',
    } satisfies Route.Body<'api.invitations.store'>,
    {
      name: 'Clark Kent',
      // @ts-expect-error The invited person's password is a string.
      password: 42,
    } satisfies Route.Body<'api.invitation_acceptances.store'>,
    {
      expectedRevision: null,
      // @ts-expect-error The linked resource is named by id.
      resourceId: 42,
    } satisfies Route.Body<'api.member_resource_links.update'>,
    {
      // @ts-expect-error Clearing a link needs the revision it replaces.
      expectedRevision: null,
    } satisfies Route.Body<'api.member_resource_links.destroy'>,
    {
      // @ts-expect-error The viewed member is named by id.
      targetUserId: 42,
    } satisfies Route.Body<'api.masquerade.store'>,
    {
      token: 'token',
      // @ts-expect-error A view ends for one of two reasons.
      reason: 'timeout',
    } satisfies Route.Body<'api.masquerade.destroy'>,
    {
      // @ts-expect-error The new owner is named by id.
      toUserId: 42,
    } satisfies Route.Body<'api.ownership_transfers.store'>,
    {
      // @ts-expect-error Getting started is only ever dismissed.
      dismissed: false,
    } satisfies Route.Body<'api.getting_started.update'>,
  ];
}
