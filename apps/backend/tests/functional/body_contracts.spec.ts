import { test } from '@japa/runner';
import db from '@adonisjs/lucid/services/db';
import limiter from '@adonisjs/limiter/services/main';
import { freshDatabase } from '#tests/helpers/fresh_database';
import { resetAuthenticatedClient } from '#tests/helpers/authenticated_data_fixture';
import { captureMail } from '#tests/helpers/identities';

type Method = 'post' | 'put' | 'patch' | 'delete';

interface BodyContract {
  method: Method;
  url: (companyId: string) => string;
  body: (companyId: string) => Record<string, unknown>;
  /** Keys whose value Vine accepts in any form; they have their own parser. */
  untyped?: string[];
  /** Keys validated as a strict boolean or number, refused in string form. */
  scalar?: Record<string, string>;
}

const password = 'krypton-password-2026';

const contracts: Record<string, BodyContract> = {
  'api.first_company_setup.store': {
    method: 'post',
    url: () => '/api/installation/company',
    body: () => ({ name: 'Wayne Enterprises', weekStartsOn: 1, timeZone: 'Etc/GMT' }),
    scalar: { weekStartsOn: '1' },
  },
  'api.import_previews.store': {
    method: 'post',
    url: () => '/api/import/preview',
    body: (companyId) => ({ companyId, document: {} }),
    untyped: ['document'],
  },
  'api.imports.store': {
    method: 'post',
    url: () => '/api/import/apply',
    body: (companyId) => ({ companyId, document: {}, baseRevision: 0, confirmationId: 'x' }),
    untyped: ['document'],
    scalar: { baseRevision: '1' },
  },
  'api.company_anonymisations.store': {
    method: 'post',
    url: (companyId) => `/api/companies/${companyId}/anonymise`,
    body: () => ({ confirmationId: 'x' }),
  },
  'api.resource_anonymisations.store': {
    method: 'post',
    url: (companyId) => `/api/companies/${companyId}/resources/r1/anonymise`,
    body: () => ({}),
  },
  'api.password_confirmations.store': {
    method: 'post',
    url: () => '/api/auth/password-confirmation',
    body: (companyId) => ({ action: 'anonymise', companyId, intent: {}, password }),
  },
  'api.password_reset_requests.store': {
    method: 'post',
    url: () => '/api/auth/request-reset',
    body: () => ({ email: 'clark.kent@wayne.example' }),
  },
  'api.password_resets.show': {
    method: 'post',
    url: () => '/api/auth/inspect-reset',
    body: () => ({ token: 'token' }),
  },
  'api.password_resets.update': {
    method: 'post',
    url: () => '/api/auth/reset-password',
    body: () => ({ token: 'token', newPassword: password }),
  },
  'api.password.update': {
    method: 'post',
    url: () => '/api/auth/change-password',
    body: () => ({ currentPassword: password, newPassword: password }),
  },
  'api.account.destroy': {
    method: 'post',
    url: () => '/api/auth/delete-account',
    body: () => ({ currentPassword: password }),
  },
  'api.email_verifications.show': {
    method: 'post',
    url: () => '/api/auth/verification/inspect',
    body: () => ({ token: 'token' }),
  },
  'api.email_verifications.update': {
    method: 'post',
    url: () => '/api/auth/verification/complete',
    body: () => ({ token: 'token', password }),
  },
  'api.member_sign_in_tracking.update': {
    method: 'put',
    url: (companyId) => `/api/companies/${companyId}/member-sign-in-tracking`,
    body: () => ({ enabled: true }),
    scalar: { enabled: 'true' },
  },
  'api.members.update': {
    method: 'patch',
    url: (companyId) => `/api/companies/${companyId}/members/u1`,
    body: () => ({ role: 'editor' }),
  },
  'api.member_status.update': {
    method: 'patch',
    url: (companyId) => `/api/companies/${companyId}/members/u1/status`,
    body: () => ({ status: 'active' }),
  },
  'api.invitations.store': {
    method: 'post',
    url: () => '/api/invitations',
    body: (companyId) => ({ companyId, role: 'viewer', email: 'clark.kent@wayne.example' }),
  },
  'api.invitation_acceptances.store': {
    method: 'post',
    url: () => '/api/invitations/token/sign-up',
    body: () => ({ name: 'Clark Kent', password }),
  },
  'api.member_resource_links.update': {
    method: 'put',
    url: (companyId) => `/api/companies/${companyId}/members/u1/resource-link`,
    body: () => ({ resourceId: 'r1', expectedRevision: null }),
  },
  'api.member_resource_links.destroy': {
    method: 'delete',
    url: (companyId) => `/api/companies/${companyId}/members/u1/resource-link`,
    body: () => ({ expectedRevision: '1' }),
  },
  'api.masquerade.store': {
    method: 'post',
    url: (companyId) => `/api/companies/${companyId}/masquerade`,
    body: () => ({ targetUserId: 'u1' }),
  },
  'api.masquerade.destroy': {
    method: 'delete',
    url: () => '/api/masquerade',
    body: () => ({ token: 'token', reason: 'explicit' }),
  },
  'api.ownership_transfers.store': {
    method: 'post',
    url: (companyId) => `/api/companies/${companyId}/ownership-transfer`,
    body: () => ({ toUserId: 'u1', confirmationId: '00000000-0000-0000-0000-000000000000' }),
  },
};

test.group('request body contracts', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(() => limiter.clear());

  test('{$self} refuses unknown keys and wrongly typed values with 400 VALIDATION_ERROR')
    .with(Object.keys(contracts))
    .run(async ({ client, assert, cleanup }, name) => {
      captureMail(cleanup);
      const contract = contracts[name];
      const owner = await resetAuthenticatedClient(client);
      const { id: companyId } = await db.from('companies').select('id').firstOrFail();
      const valid = contract.body(companyId);
      const refusals: [string, Record<string, unknown>][] = [
        ['unknown key', { ...valid, extra: true }],
      ];
      for (const key of Object.keys(valid)) {
        if (contract.untyped?.includes(key)) continue;
        refusals.push([`${key} as an array`, { ...valid, [key]: [] }]);
        const stringForm = contract.scalar?.[key];
        if (stringForm !== undefined) {
          refusals.push([`${key} as a string`, { ...valid, [key]: stringForm }]);
        }
      }
      for (const [label, body] of refusals) {
        const response = await owner[contract.method](contract.url(companyId)).json(body).send();
        assert.equal(response.status(), 400, `${name}: ${label}`);
        assert.equal(
          (response.body() as { code?: unknown }).code,
          'VALIDATION_ERROR',
          `${name}: ${label}`
        );
      }
    });
});
