import { test } from '@japa/runner';
import db from '@adonisjs/lucid/services/db';
import {
  hasMultipleCompanies,
  hasNoCompany,
  installationCompanyId,
} from '#services/installation_company';
import { resetState } from '../helpers/state_fixture.js';

test.group('installation company', () => {
  test('an installation without a company has none to name', async ({ assert }) => {
    await resetState(false);
    assert.isTrue(await hasNoCompany(db));
    assert.isFalse(await hasMultipleCompanies(db));
    assert.isNull(await installationCompanyId(db));
  });

  test('a single company is the installation company', async ({ assert }) => {
    await resetState('single');
    const [company] = await db.from('accounts').select('id');
    assert.isFalse(await hasNoCompany(db));
    assert.isFalse(await hasMultipleCompanies(db));
    assert.equal(await installationCompanyId(db), String(company.id));
  });

  test('a second company is refused with one code', async ({ assert }) => {
    await resetState(true);
    assert.isFalse(await hasNoCompany(db));
    assert.isTrue(await hasMultipleCompanies(db));
    try {
      await installationCompanyId(db);
      assert.fail('Expected the second company to be refused');
    } catch (error) {
      assert.include(error, { status: 409, code: 'MULTIPLE_COMPANIES' });
    }
  });
});
