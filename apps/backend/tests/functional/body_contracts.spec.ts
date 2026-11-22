import { test } from '@japa/runner';
import db from '@adonisjs/lucid/services/db';
import limiter from '@adonisjs/limiter/services/main';
import { freshDatabase } from '#tests/helpers/fresh_database';
import { resetAuthenticatedClient } from '#tests/helpers/authenticated_data_fixture';
import { captureMail } from '#tests/helpers/identities';
import { firstCompanySetupMessage } from '#validators/first_company_setup';

type Method = 'post' | 'put' | 'patch' | 'delete';

interface BodyContract {
  method: Method;
  url: (companyId: string) => string;
  sentence: string;
  body: (companyId: string) => Record<string, unknown>;
  /** Keys whose value Vine accepts in any form; they have their own parser. */
  untyped?: string[];
  /** Keys validated as a strict boolean or number, refused in string form. */
  scalar?: Record<string, string>;
  /** A key that answers with its own sentence when its value is wrong. */
  keySentences?: Record<string, string>;
}

const admission = 'Invalid admission request.';
const password = 'krypton-password-2026';

const contracts: Record<string, BodyContract> = {
  'api.first_company_setup.store': {
    method: 'post',
    url: () => '/api/installation/company',
    sentence: firstCompanySetupMessage,
    body: () => ({ name: 'Wayne Enterprises', weekStartsOn: 1, timeZone: 'Etc/GMT' }),
    scalar: { weekStartsOn: '1' },
  },
  'api.import_previews.store': {
    method: 'post',
    url: () => '/api/import/preview',
    sentence: 'Invalid beta import document.',
    body: (companyId) => ({ companyId, document: {} }),
    untyped: ['document'],
  },
  'api.imports.store': {
    method: 'post',
    url: () => '/api/import/apply',
    sentence: 'Invalid beta import request.',
    body: (companyId) => ({ companyId, document: {}, baseRevision: 0, confirmationId: 'x' }),
    untyped: ['document'],
    scalar: { baseRevision: '1' },
  },
  'api.company_anonymisations.store': {
    method: 'post',
    url: (companyId) => `/api/companies/${companyId}/anonymise`,
    sentence: 'Invalid anonymisation request.',
    body: () => ({ confirmationId: 'x' }),
  },
  'api.resource_anonymisations.store': {
    method: 'post',
    url: (companyId) => `/api/companies/${companyId}/resources/r1/anonymise`,
    sentence: 'Invalid anonymisation request.',
    body: () => ({}),
  },
  'api.password_confirmations.store': {
    method: 'post',
    url: () => '/api/auth/password-confirmation',
    sentence: 'Invalid password confirmation.',
    body: (companyId) => ({ action: 'anonymise', companyId, intent: {}, password }),
  },
  'api.password_reset_requests.store': {
    method: 'post',
    url: () => '/api/auth/request-reset',
    sentence: 'Invalid recovery request.',
    body: () => ({ email: 'clark.kent@wayne.example' }),
  },
  'api.password_resets.show': {
    method: 'post',
    url: () => '/api/auth/inspect-reset',
    sentence: 'Invalid recovery request.',
    body: () => ({ token: 'token' }),
  },
  'api.password_resets.update': {
    method: 'post',
    url: () => '/api/auth/reset-password',
    sentence: 'Invalid recovery request.',
    body: () => ({ token: 'token', newPassword: password }),
  },
  'api.password.update': {
    method: 'post',
    url: () => '/api/auth/change-password',
    sentence: 'Invalid credential request.',
    body: () => ({ currentPassword: password, newPassword: password }),
  },
  'api.account.destroy': {
    method: 'post',
    url: () => '/api/auth/delete-account',
    sentence: 'Invalid credential request.',
    body: () => ({ currentPassword: password }),
  },
  'api.email_verifications.show': {
    method: 'post',
    url: () => '/api/auth/verification/inspect',
    sentence: 'Invalid confirmation request.',
    body: () => ({ token: 'token' }),
  },
  'api.email_verifications.update': {
    method: 'post',
    url: () => '/api/auth/verification/complete',
    sentence: 'Invalid confirmation request.',
    body: () => ({ token: 'token', password }),
  },
  'api.member_sign_in_tracking.update': {
    method: 'put',
    url: (companyId) => `/api/companies/${companyId}/member-sign-in-tracking`,
    sentence: 'enabled must be a Boolean.',
    body: () => ({ enabled: true }),
    scalar: { enabled: 'true' },
  },
  'api.members.update': {
    method: 'patch',
    url: (companyId) => `/api/companies/${companyId}/members/u1`,
    sentence: 'Invalid member role.',
    body: () => ({ role: 'editor' }),
  },
  'api.member_status.update': {
    method: 'patch',
    url: (companyId) => `/api/companies/${companyId}/members/u1/status`,
    sentence: 'Invalid member status.',
    body: () => ({ status: 'active' }),
  },
  'api.invitations.store': {
    method: 'post',
    url: () => '/api/invites',
    sentence: admission,
    body: (companyId) => ({ companyId, role: 'viewer', email: 'clark.kent@wayne.example' }),
    keySentences: { email: 'Invalid invitation email.' },
  },
  'api.invitation_acceptances.store': {
    method: 'post',
    url: () => '/api/invites/token/signup',
    sentence: admission,
    body: () => ({ name: 'Clark Kent', password }),
    keySentences: { name: 'Invalid sign-up details.', password: 'Invalid sign-up details.' },
  },
  'api.member_resource_links.update': {
    method: 'put',
    url: (companyId) => `/api/companies/${companyId}/members/u1/resource-link`,
    sentence: admission,
    body: () => ({ resourceId: 'r1', expectedRevision: null }),
  },
  'api.member_resource_links.destroy': {
    method: 'delete',
    url: (companyId) => `/api/companies/${companyId}/members/u1/resource-link`,
    sentence: admission,
    body: () => ({ expectedRevision: '1' }),
  },
  'api.masquerade.store': {
    method: 'post',
    url: (companyId) => `/api/companies/${companyId}/masquerade`,
    sentence: 'Target member is required.',
    body: () => ({ targetUserId: 'u1' }),
  },
  'api.masquerade.destroy': {
    method: 'delete',
    url: () => '/api/masquerade',
    sentence: 'Invalid masquerade end request.',
    body: () => ({ token: 'token', reason: 'explicit' }),
  },
  'api.ownership_transfers.store': {
    method: 'post',
    url: (companyId) => `/api/companies/${companyId}/ownership-transfer`,
    sentence: 'An eligible target user is required.',
    body: () => ({ toUserId: 'u1', confirmationId: '00000000-0000-0000-0000-000000000000' }),
  },
};

test.group('request body contracts', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(() => limiter.clear());

  test('{$self} refuses unknown keys and wrongly typed values with its sentence')
    .with(Object.keys(contracts))
    .run(async ({ client, assert, cleanup }, name) => {
      captureMail(cleanup);
      const contract = contracts[name];
      const owner = await resetAuthenticatedClient(client);
      const { id: companyId } = await db.from('companies').select('id').firstOrFail();
      const valid = contract.body(companyId);
      const refusals: [string, Record<string, unknown>, string][] = [
        ['unknown key', { ...valid, extra: true }, contract.sentence],
      ];
      for (const key of Object.keys(valid)) {
        if (contract.untyped?.includes(key)) continue;
        const sentence = contract.keySentences?.[key] ?? contract.sentence;
        refusals.push([`${key} as an array`, { ...valid, [key]: [] }, sentence]);
        const stringForm = contract.scalar?.[key];
        if (stringForm !== undefined) {
          refusals.push([`${key} as a string`, { ...valid, [key]: stringForm }, sentence]);
        }
      }
      for (const [label, body, sentence] of refusals) {
        const response = await owner[contract.method](contract.url(companyId)).json(body).send();
        assert.equal(response.status(), 400, `${name}: ${label}`);
        assert.equal((response.body() as { error?: unknown }).error, sentence, `${name}: ${label}`);
      }
    });
});
