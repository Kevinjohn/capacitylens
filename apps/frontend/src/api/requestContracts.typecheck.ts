import type { RequestArgs } from '@tuyau/core/types';
import { client, apiReadRouteUrl } from './queryClient';
import type { registry } from '@capacitylens/backend/registry';

type Routes = typeof registry.routes;

/** Compile-time checks ensure generated request inputs cannot silently regress to empty objects. */
export function checkOrdinaryRequestContracts() {
  const signIn: RequestArgs<Routes['api.auth.sign-in']> = {
    body: { email: 'clark@wayne.example', password: 'secret' },
  };
  const signUp: RequestArgs<Routes['api.auth.sign-up']> = {
    body: { email: 'clark@wayne.example', password: 'secret', name: 'Clark Kent' },
  };
  const admission: RequestArgs<Routes['api.admission.index']> = {
    query: { status: 'approved', cursor: 'opaque' },
  };
  const state: RequestArgs<Routes['api.state']> = {
    query: { accountId: 'a-studio', includeInactive: '1' },
  };
  const missingPassword: RequestArgs<Routes['api.auth.sign-in']> = {
    // @ts-expect-error Sign-in requires a password.
    body: { email: 'clark@wayne.example' },
  };
  const missingName: RequestArgs<Routes['api.auth.sign-up']> = {
    // @ts-expect-error The generated sign-up body requires the display name.
    body: { email: 'clark@wayne.example', password: 'secret' },
  };
  const invalidStatus: RequestArgs<Routes['api.admission.index']> = {
    // @ts-expect-error Admission status is a generated finite union.
    query: { status: 'unknown' },
  };
  // @ts-expect-error State's inactive flag is the literal wire value.
  const invalidInactive: RequestArgs<Routes['api.state']> = { query: { includeInactive: true } };
  // @ts-expect-error The generated read query refuses boolean inactive flags at the browser seam.
  apiReadRouteUrl('api.state', { query: { includeInactive: true } });
  // @ts-expect-error Admission status cannot be supplied as a state query.
  apiReadRouteUrl('api.state', { query: { status: 'pending' } });
  // @ts-expect-error Sign-in is a generated POST route, never GET.
  client.get('/api/auth/sign-in', {});
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
