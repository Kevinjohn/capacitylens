import { inject } from '@adonisjs/core';
import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import access from '#config/access_control';
import { parseUserName } from '@capacitylens/shared/lib/strings';
import { InstallationCompanyService } from '#services/installation_company_service';

/** Whether first-company setup is open, and its input rules. */
@inject()
export class FirstCompanySetupService {
  #installationCompany: InstallationCompanyService;

  constructor(installationCompany: InstallationCompanyService) {
    this.#installationCompany = installationCompany;
  }

  /** Only the sole native user can claim an entirely uninitialised installation. */
  async isFirstCompanySetupRequired(userId: string, connection: TransactionClientContract) {
    const users = await connection.from('users').select('id').limit(2);
    return (
      users.length === 1 &&
      String(users[0]?.id) === userId &&
      (await this.#installationCompany.hasNoCompany(connection)) &&
      !(await connection.from(access.config.membershipsTable).select('id').first())
    );
  }

  /** Applies the name and time-zone rules to a validated first-company body; null when either fails. */
  parseFirstCompanyInput(body: {
    name: string;
    weekStartsOn?: 0 | 1;
    timeZone?: string;
  }): { name: string; weekStartsOn: 0 | 1; timeZone: string } | null {
    // The same name rule as every later company-settings write, so the stored name can be re-saved.
    const name = parseUserName(body.name);
    // New calendar fields are additive: existing name-only callers keep the browser defaults.
    const weekStartsOn = body.weekStartsOn ?? 1;
    const timeZone = body.timeZone ?? 'Etc/GMT';
    let validTimeZone = false;
    if (timeZone.length <= 128 && !/^[+-]/.test(timeZone)) {
      try {
        new Intl.DateTimeFormat(undefined, { timeZone });
        validTimeZone = true;
      } catch {
        // The supplied zone must be supported without falling back to the server's zone.
      }
    }
    if (name === null || !validTimeZone) return null;
    return { name, weekStartsOn, timeZone };
  }
}
