import db from '@adonisjs/lucid/services/db';
import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import access from '#config/access_control';
import { hasOnlyFields } from '#services/request_helpers';
import { parseUserName } from '@capacitylens/shared/lib/strings';
import { hasNoCompany } from '#services/installation_company';

/** Only the sole native principal can claim an entirely uninitialized installation. */
export async function requiresFirstCompanySetup(
  userId: string,
  connection: Pick<typeof db, 'from'> | TransactionClientContract = db
) {
  const users = await connection.from('users').select('id').limit(2);
  return (
    users.length === 1 &&
    String(users[0]?.id) === userId &&
    (await hasNoCompany(connection)) &&
    !(await connection.from(access.config.membershipsTable).select('id').first())
  );
}

/** Reads the first company's name, week start and time zone; null when any supplied value is invalid. */
export function parseFirstCompanyInput(
  body: unknown
): { name: string; weekStartsOn: 0 | 1; timeZone: string } | null {
  // The same name rule as every later company-settings write, so the stored name can be re-saved.
  const calendar = hasOnlyFields(body, ['name', 'weekStartsOn', 'timeZone']) ? body : null;
  const name = calendar === null ? null : parseUserName(calendar.name);
  // New calendar fields are additive: existing name-only callers keep the browser defaults.
  // Supplied null or invalid values still fail validation rather than being defaulted.
  const weekStartsOn =
    calendar !== null && Object.hasOwn(calendar, 'weekStartsOn') ? calendar.weekStartsOn : 1;
  const timeZone =
    calendar !== null && Object.hasOwn(calendar, 'timeZone') ? calendar.timeZone : 'Etc/GMT';
  let validTimeZone = false;
  if (typeof timeZone === 'string' && timeZone.length <= 128 && !/^[+-]/.test(timeZone)) {
    try {
      new Intl.DateTimeFormat(undefined, { timeZone });
      validTimeZone = true;
    } catch {
      // The supplied zone must be supported without falling back to the server's zone.
    }
  }
  if (name === null || ![0, 1].includes(weekStartsOn as number) || !validTimeZone) return null;
  return { name, weekStartsOn: weekStartsOn as 0 | 1, timeZone: timeZone as string };
}
