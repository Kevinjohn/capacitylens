/** Maximum length of a normalised external avatar URL. */
export const RESOURCE_AVATAR_URL_MAX_LENGTH = 2048;

/** Result of parsing an optional avatar URL; failures distinguish length from all other syntax/policy errors. */
export type ResourceAvatarUrlResult =
  { ok: true; value: string | undefined } | { ok: false; reason: "invalid" | "too_long" };

/**
 * Parse and normalise an optional browser-loaded avatar reference without making a network request.
 * Empty strings and nullish input become an absent value; non-empty input must be absolute HTTPS,
 * credential-free, and at most {@link RESOURCE_AVATAR_URL_MAX_LENGTH} characters after serialisation.
 */
export function parseResourceAvatarUrl(value: unknown): ResourceAvatarUrlResult {
  if (typeof value !== "string")
    return value == null ? { ok: true, value: undefined } : { ok: false, reason: "invalid" };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: undefined };
  let url: URL;
  try {
    // The platform URL parser is the canonical normalization and credential-policy primitive here.
    // eslint-disable-next-line no-restricted-globals
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (url.protocol !== "https:" || url.username || url.password) return { ok: false, reason: "invalid" };
  const normalized = url.toString();
  return normalized.length <= RESOURCE_AVATAR_URL_MAX_LENGTH
    ? { ok: true, value: normalized }
    : { ok: false, reason: "too_long" };
}
