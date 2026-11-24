import { basename, dirname, resolve } from 'node:path';
import type { ApplicationService } from '@adonisjs/core/types';
import db from '@adonisjs/lucid/services/db';
import { AccountAdmission } from '@kevinjohn/adonisjs-account-kit/admission';
import { bootstrapDevelopmentCredential } from '#services/development_bootstrap';
import { seedForCurrentWeek } from '@capacitylens/shared/data/seed';
import { initializeCompanyAccess } from '#services/initial_company_access';
import { tables } from '#services/product_tables';
import type { LucidModel } from '@adonisjs/lucid/types/model';
import type { AppDataKey } from '@capacitylens/shared/types/entities';
import { productModels } from '#models_support/product_models';
import { rowAttributes } from '#models_support/row_attributes';
import capacitylens from '#config/capacitylens';
import { hasNoCompany } from '#services/installation_company';

/** Insert the single disposable company graph and its first membership in one transaction. */
async function insertDisposableDemoSeed(ownerId: string) {
  await db.transaction(async (trx) => {
    if (!(await hasNoCompany(trx))) {
      throw new Error('Refusing demo seed: companies already exist');
    }
    if (await trx.from('memberships').first()) {
      throw new Error('Refusing demo seed: memberships already exist');
    }
    const data = seedForCurrentWeek();
    const company = data.companies.find((row) => row.id === 'a-studio');
    if (!company) throw new Error('Disposable demo company is missing');
    for (const key of Object.keys(tables) as AppDataKey[]) {
      const rows: readonly object[] =
        key === 'companies'
          ? [company]
          : data[key].filter((row) => 'companyId' in row && row.companyId === company.id);
      const model: LucidModel = productModels[key];
      await model.createMany(
        rows.map((row) => rowAttributes(model, row)),
        { client: trx }
      );
    }
    await initializeCompanyAccess(trx, {
      companyId: company.id,
      ownerId,
      actorId: ownerId,
      now: new Date().toISOString(),
    });
  });
}

/** The demo commands run only on the per-launch storage `pnpm run dev:demo` creates under tmp/. */
export function assertDisposableDemoDatabase(app: ApplicationService) {
  const databasePath = capacitylens.databasePath;
  const directory = databasePath ? dirname(resolve(databasePath)) : '';
  if (
    !databasePath ||
    basename(databasePath) !== '.demo.db' ||
    dirname(directory) !== app.tmpPath() ||
    !/^demo-l\d+-/.test(basename(directory))
  ) {
    throw new Error('Refusing demo preparation: the database is not disposable demo storage');
  }
}

/** Demo preparation and seeding are restricted to an empty development installation. */
export async function assertEmptyDemoInstallation(app: ApplicationService) {
  if (app.inProduction) throw new Error('Disposable demo preparation is forbidden in production');
  if (!(await hasNoCompany(db))) {
    throw new Error('Refusing demo seed: companies already exist');
  }
  if (await db.from('memberships').first()) {
    throw new Error('Refusing demo seed: memberships already exist');
  }
}

export async function prepareDisposableDemo(app: ApplicationService) {
  await assertEmptyDemoInstallation(app);
  await bootstrapDevelopmentCredential(app);
}

export async function seedDisposableDemo(app: ApplicationService) {
  await assertEmptyDemoInstallation(app);
  const owner = await db.from('users').where('email', 'admin@admin.admin').first();
  if (!owner) throw new Error('Refusing demo seed: development administrator is missing');
  const admission = await app.container.make(AccountAdmission);
  if (!(await admission.isAdmitted(owner.id))) {
    throw new Error('Refusing demo seed: development administrator is not admitted');
  }
  await insertDisposableDemoSeed(owner.id);
}
