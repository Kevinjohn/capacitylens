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
  'api.installation.company': {
    method: 'post',
    url: () => '/api/installation/company',
    sentence: firstCompanySetupMessage,
    body: () => ({ name: 'Wayne Enterprises', weekStartsOn: 1, timeZone: 'Etc/GMT' }),
    scalar: { weekStartsOn: '1' },
  },
  'api.transfer.preview': {
    method: 'post',
    url: () => '/api/transfer/preview',
    sentence: 'Invalid beta transfer document.',
    body: (companyId) => ({ companyId, document: {} }),
    untyped: ['document'],
  },
  'api.transfer.apply': {
    method: 'post',
    url: () => '/api/transfer/apply',
    sentence: 'Invalid beta transfer request.',
    body: (companyId) => ({ companyId, document: {}, baseRevision: 0, confirmationId: 'x' }),
    untyped: ['document'],
    scalar: { baseRevision: '1' },
  },
  'api.accounts.anonymise': {
    method: 'post',
    url: (companyId) => `/api/companies/${companyId}/anonymise`,
    sentence: 'Invalid anonymisation request.',
    body: () => ({ confirmationId: 'x' }),
  },
  'api.resources.anonymise': {
    method: 'post',
    url: (companyId) => `/api/companies/${companyId}/resources/r1/anonymise`,
    sentence: 'Invalid anonymisation request.',
    body: () => ({}),
  },
  'api.auth.password-confirmation': {
    method: 'post',
    url: () => '/api/auth/password-confirmation',
    sentence: 'Invalid password confirmation.',
    body: (companyId) => ({ action: 'anonymise', companyId, intent: {}, password }),
  },
  'api.auth.request-reset': {
    method: 'post',
    url: () => '/api/auth/request-reset',
    sentence: 'Invalid recovery request.',
    body: () => ({ email: 'clark.kent@wayne.example' }),
  },
  'api.auth.inspect-reset': {
    method: 'post',
    url: () => '/api/auth/inspect-reset',
    sentence: 'Invalid recovery request.',
    body: () => ({ token: 'token' }),
  },
  'api.auth.reset-password': {
    method: 'post',
    url: () => '/api/auth/reset-password',
    sentence: 'Invalid recovery request.',
    body: () => ({ token: 'token', newPassword: password }),
  },
  'api.auth.change-password': {
    method: 'post',
    url: () => '/api/auth/change-password',
    sentence: 'Invalid credential request.',
    body: () => ({ currentPassword: password, newPassword: password }),
  },
  'api.auth.delete-account': {
    method: 'post',
    url: () => '/api/auth/delete-account',
    sentence: 'Invalid credential request.',
    body: () => ({ currentPassword: password }),
  },
  'api.auth.verification.inspect': {
    method: 'post',
    url: () => '/api/auth/verification/inspect',
    sentence: 'Invalid confirmation request.',
    body: () => ({ token: 'token' }),
  },
  'api.auth.verification.complete': {
    method: 'post',
    url: () => '/api/auth/verification/complete',
    sentence: 'Invalid confirmation request.',
    body: () => ({ token: 'token', password }),
  },
  'api.members.tracking': {
    method: 'put',
    url: (companyId) => `/api/companies/${companyId}/member-sign-in-tracking`,
    sentence: 'enabled must be a Boolean.',
    body: () => ({ enabled: true }),
    scalar: { enabled: 'true' },
  },
  'api.members.role': {
    method: 'patch',
    url: (companyId) => `/api/companies/${companyId}/members/u1`,
    sentence: 'Invalid member role.',
    body: () => ({ role: 'editor' }),
  },
  'api.members.status': {
    method: 'patch',
    url: (companyId) => `/api/companies/${companyId}/members/u1/status`,
    sentence: 'Invalid member status.',
    body: () => ({ status: 'active' }),
  },
  'api.invites.create': {
    method: 'post',
    url: () => '/api/invites',
    sentence: admission,
    body: (companyId) => ({ companyId, role: 'viewer', email: 'clark.kent@wayne.example' }),
    keySentences: { email: 'Invalid invitation email.' },
  },
  'api.invites.sign-up': {
    method: 'post',
    url: () => '/api/invites/token/signup',
    sentence: admission,
    body: () => ({ name: 'Clark Kent', password }),
    keySentences: { name: 'Invalid sign-up details.', password: 'Invalid sign-up details.' },
  },
  'api.member-resources.set': {
    method: 'put',
    url: (companyId) => `/api/companies/${companyId}/members/u1/resource-link`,
    sentence: admission,
    body: () => ({ resourceId: 'r1', expectedRevision: null }),
  },
  'api.member-resources.clear': {
    method: 'delete',
    url: (companyId) => `/api/companies/${companyId}/members/u1/resource-link`,
    sentence: admission,
    body: () => ({ expectedRevision: '1' }),
  },
  'api.masquerade.start': {
    method: 'post',
    url: (companyId) => `/api/companies/${companyId}/masquerade`,
    sentence: 'Target member is required.',
    body: () => ({ targetUserId: 'u1' }),
  },
  'api.masquerade.end': {
    method: 'delete',
    url: () => '/api/masquerade',
    sentence: 'Invalid masquerade end request.',
    body: () => ({ token: 'token', reason: 'explicit' }),
  },
  'api.ownership.transfer': {
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
      const { id: companyId } = await db.from('accounts').select('id').firstOrFail();
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
