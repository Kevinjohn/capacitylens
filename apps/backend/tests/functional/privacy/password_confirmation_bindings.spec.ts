import { test } from '@japa/runner';
import db from '@adonisjs/lucid/services/db';
import { buildCompanyExport } from '@capacitylens/shared/data/companyExport';
import { readState } from '#tests/helpers/state_fixture';
import { asDataOwner, resetAuthenticatedData } from '#tests/helpers/authenticated_data_fixture';
import { freshDatabase } from '#tests/helpers/fresh_database';
import { createIdentity, fixturePassword, signIn } from '#tests/helpers/identities';
import { asExportFile } from '#tests/helpers/export_file';
import { PlanningRevisionService } from '#services/planning_revision_service';

const planningRevisions = new PlanningRevisionService();

const companyId = 'a-studio';

async function revision() {
  return db.transaction((trx) => planningRevisions.getPlanningRevision(trx, companyId));
}

test.group('password confirmation bindings', (group) => {
  group.setup(() => freshDatabase());

  test('a successor Owner cannot spend the previous Owner proof over HTTP', async ({
    client,
    assert,
  }) => {
    const { cookie, userId } = await resetAuthenticatedData(client);
    const before = await readState(companyId, true);
    const baseRevision = await revision();
    const document = asExportFile(buildCompanyExport(before, { companyId, completeness: 'full' }));
    document.data.companies[0]!.name += ' by Lex';
    const issue = async (action: string, intent: unknown) => {
      const response = await asDataOwner(client.visit('api.password_confirmations.store'), cookie)
        // The helper takes any action and intent, including ones the server refuses.
        .json({ action, companyId, intent, password: fixturePassword } as never)
        .send();
      response.assertStatus(200);
      return (response.body().data as { confirmationId: string }).confirmationId;
    };
    const anonymiseProof = await issue('anonymise', {});
    const importProof = await issue('import', { baseRevision, document });

    const successorEmail = `clark.kent.${Date.now()}@wayne.example`;
    const successor = await createIdentity(successorEmail, { name: 'Clark Kent' });
    await db
      .from('memberships')
      .where({ scope_id: companyId, user_id: userId })
      .update({ role: 'admin' });
    const now = new Date().toISOString();
    await db.table('memberships').insert({
      scope_id: companyId,
      user_id: successor,
      role: 'owner',
      status: 'active',
      created_at: now,
      updated_at: now,
    });
    const { cookie: successorCookie } = await signIn(client, successorEmail);
    const auditBefore = await db.from('audit_entries').where('company_id', companyId);

    const anonymise = await asDataOwner(
      client.visit('api.company_anonymisations.store', { companyId }),
      successorCookie
    )
      .json({ confirmationId: anonymiseProof })
      .send();
    anonymise.assertStatus(403);
    assert.deepEqual(anonymise.body(), {
      error: 'Confirm this action again.',
      code: 'PASSWORD_CONFIRMATION_REQUIRED',
    });
    const imported = await asDataOwner(client.visit('api.imports.store'), successorCookie)
      .json({ companyId, document, baseRevision, confirmationId: importProof })
      .send();
    imported.assertStatus(403);
    assert.deepEqual(imported.body(), {
      error: 'Confirm this action again.',
      code: 'PASSWORD_CONFIRMATION_REQUIRED',
    });

    assert.deepEqual(await readState(companyId, true), before);
    assert.equal(await revision(), baseRevision);
    assert.lengthOf(
      await db.from('audit_entries').where('company_id', companyId),
      auditBefore.length
    );
    assert.lengthOf(
      await db
        .from('password_confirmations')
        .whereIn('id', [anonymiseProof, importProof])
        .whereNull('consumed_at'),
      2
    );
  });

  test('a proof issued for one protected action cannot authorize another route', async ({
    client,
    assert,
  }) => {
    const { cookie } = await resetAuthenticatedData(client);
    const before = await readState(companyId, true);
    const baseRevision = await revision();
    const document = asExportFile(buildCompanyExport(before, { companyId, completeness: 'full' }));
    const response = await asDataOwner(client.visit('api.password_confirmations.store'), cookie)
      .json({
        action: 'import',
        companyId,
        intent: { baseRevision, document },
        password: fixturePassword,
      })
      .send();
    response.assertStatus(200);
    const importProof = (response.body().data as { confirmationId: string }).confirmationId;
    const anonymise = await asDataOwner(
      client.visit('api.company_anonymisations.store', { companyId }),
      cookie
    )
      .json({ confirmationId: importProof })
      .send();
    anonymise.assertStatus(403);
    assert.deepEqual(anonymise.body(), {
      error: 'Confirm this action again.',
      code: 'PASSWORD_CONFIRMATION_REQUIRED',
    });
    assert.deepEqual(await readState(companyId, true), before);
    assert.equal(await revision(), baseRevision);
    const unspent = await db.from('password_confirmations').where('id', importProof).first();
    assert.isNull(unspent?.consumed_at);
  });
});
