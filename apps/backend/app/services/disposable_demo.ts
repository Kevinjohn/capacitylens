import { basename, dirname, resolve } from 'node:path';
import type { ApplicationService } from '@adonisjs/core/types';
import db from '@adonisjs/lucid/services/db';
import { AccountAdmission } from '@kevinjohn/adonisjs-account-kit/admission';
import { bootstrapDevelopmentCredential } from '#services/development_bootstrap';
import { insertDisposableDemoSeed } from '#services/state_repository';
import env from '#start/env';
import { hasNoCompany } from '#services/installation_company';

/** The demo commands run only on the per-launch storage `pnpm run dev:demo` creates under tmp/. */
export function assertDisposableDemoDatabase(app: ApplicationService) {
  const databasePath = env.get('CAPACITYLENS_DB');
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
