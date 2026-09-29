/** Maximum length of a normalised external avatar URL. */
export const RESOURCE_AVATAR_URL_MAX_LENGTH = 2048;

/**
 * Decode and normalise an optional browser-loaded avatar reference without making a network request.
 * Returns `undefined` for an absent value (nullish or blank input), the normalised URL when it is
 * absolute HTTPS, credential-free and at most {@link RESOURCE_AVATAR_URL_MAX_LENGTH} characters after
 * serialisation, and `null` for anything else. Test failure with `=== null`: `undefined` is valid.
 */
export function parseResourceAvatarUrl(value: unknown): string | undefined | null {
  if (typeof value !== "string") return value == null ? undefined : null;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  let url: URL;
  try {
    // The platform URL parser is the canonical normalization and credential-policy primitive here.
    // eslint-disable-next-line no-restricted-globals
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const normalized = url.toString();
  return normalized.length <= RESOURCE_AVATAR_URL_MAX_LENGTH ? normalized : null;
}
