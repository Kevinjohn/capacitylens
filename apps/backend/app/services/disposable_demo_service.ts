import { basename, dirname, resolve } from 'node:path';
import { inject } from '@adonisjs/core';
import type { ApplicationService } from '@adonisjs/core/types';
import db from '@adonisjs/lucid/services/db';
import { AccountAdmission } from '@kevinjohn/adonisjs-account-kit/admission';
import { DevelopmentBootstrapService } from '#services/development_bootstrap_service';
import { seedForCurrentWeek } from '@capacitylens/shared/data/seed';
import { InitialCompanyAccessService } from '#services/initial_company_access_service';
import { tables } from '#models_support/product_tables';
import type { LucidModel } from '@adonisjs/lucid/types/model';
import type { AppDataKey } from '@capacitylens/shared/types/entities';
import { productModels } from '#models_support/product_models';
import { rowAttributes } from '#models_support/row_attributes';
import capacitylens from '#config/capacitylens';
import { InstallationCompanyService } from '#services/installation_company_service';
import User from '#models/user';

/** The disposable development demo installation. */
@inject()
export class DisposableDemoService {
  #developmentBootstrap: DevelopmentBootstrapService;
  #initialCompanyAccess: InitialCompanyAccessService;
  #admission: AccountAdmission;
  #installationCompany: InstallationCompanyService;

  constructor(
    developmentBootstrap: DevelopmentBootstrapService,
    initialCompanyAccess: InitialCompanyAccessService,
    admission: AccountAdmission,
    installationCompany: InstallationCompanyService
  ) {
    this.#developmentBootstrap = developmentBootstrap;
    this.#initialCompanyAccess = initialCompanyAccess;
    this.#admission = admission;
    this.#installationCompany = installationCompany;
  }

  /** Insert the single disposable company graph and its first membership in one transaction. */
  async #insertDisposableDemoSeed(ownerId: string) {
    await db.transaction(async (trx) => {
      if (!(await this.#installationCompany.hasNoCompany(trx))) {
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
      await this.#initialCompanyAccess.initializeCompanyAccess(trx, {
        companyId: company.id,
        ownerId,
        actorId: ownerId,
        now: new Date().toISOString(),
      });
    });
  }

  /** The demo commands run only on the per-launch storage `pnpm run dev:demo` creates under tmp/. */
  assertDisposableDemoDatabase(app: ApplicationService) {
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
  async assertEmptyDemoInstallation(app: ApplicationService) {
    if (app.inProduction) throw new Error('Disposable demo preparation is forbidden in production');
    if (!(await this.#installationCompany.hasNoCompany())) {
      throw new Error('Refusing demo seed: companies already exist');
    }
    if (await db.from('memberships').first()) {
      throw new Error('Refusing demo seed: memberships already exist');
    }
  }

  async prepareDisposableDemo(app: ApplicationService) {
    await this.assertEmptyDemoInstallation(app);
    await this.#developmentBootstrap.bootstrapDevelopmentCredential();
  }

  async seedDisposableDemo(app: ApplicationService) {
    await this.assertEmptyDemoInstallation(app);
    const owner = await User.findBy('email', 'admin@admin.admin');
    if (!owner) throw new Error('Refusing demo seed: development administrator is missing');
    if (!(await this.#admission.isAdmitted(owner.id))) {
      throw new Error('Refusing demo seed: development administrator is not admitted');
    }
    await this.#insertDisposableDemoSeed(owner.id);
  }
}
