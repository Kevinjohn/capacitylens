/** The name of the person the smoke schedule creates. */
export const RESOURCE_NAME: string;

/** Write one scheduled allocation through authenticated typed planning routes. */
export function writeSmokeSchedule(
  baseUrl: string,
  cookie: string,
  accountId: string,
  fixture: unknown,
  contextToken: string,
): Promise<{ allocation: { id: string } }>;
