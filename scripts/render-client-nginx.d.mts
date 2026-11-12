/**
 * Parses the configured remote API origin, or returns null when unset.
 * @throws When the value is not an absolute HTTP(S) origin without credentials, path, query, or fragment.
 */
export function parseClientApiOrigin(apiValue: string): string | null;

/**
 * Renders the client nginx template with the configured API origin.
 * @throws When the template placeholder count or API configuration is invalid.
 */
export function renderClientNginx(
  template: string,
  env?: Record<string, string | undefined>,
): string;
