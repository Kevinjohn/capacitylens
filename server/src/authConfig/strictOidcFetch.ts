import { isLoopbackHostname } from "./strictOidcAddressPolicy";
import { MAX_OIDC_JSON_BYTES, StrictOidcConfigError, StrictOidcProviderUnavailableError } from "./strictOidcErrors";

export function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function requiredUrl(value: unknown, field: string): URL {
  if (typeof value !== "string") throw new StrictOidcConfigError(`OIDC discovery is missing ${field}.`);
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new StrictOidcConfigError(`OIDC discovery returned an invalid ${field}.`, { cause });
  }
  const loopback = isLoopbackHostname(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new StrictOidcConfigError(`OIDC discovery ${field} must use HTTPS outside loopback development.`);
  }
  if (url.username || url.password)
    throw new StrictOidcConfigError(`OIDC discovery ${field} must not contain credentials.`);
  if (url.hash) throw new StrictOidcConfigError(`OIDC discovery ${field} must not contain a fragment.`);
  return url;
}

export function optionalPictureUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export async function json(url: string, init: RequestInit = {}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (cause) {
    throw new StrictOidcProviderUnavailableError("OIDC endpoint request failed.", { cause });
  }
  const rejectBeforeRead = async (message: string): Promise<never> => {
    try {
      await response.body?.cancel();
    } catch {
      // Cleanup must not replace the bounded, operator-facing protocol error.
    }
    throw new Error(message);
  };
  if (!response.ok) {
    if (response.status === 429 || response.status >= 500) {
      try {
        await response.body?.cancel();
      } catch {
        // Cleanup must not replace the availability failure.
      }
      throw new StrictOidcProviderUnavailableError(`OIDC endpoint returned HTTP ${response.status}.`);
    }
    return rejectBeforeRead(`OIDC endpoint returned HTTP ${response.status}.`);
  }
  const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json" && !mediaType?.endsWith("+json")) {
    return rejectBeforeRead("OIDC endpoint did not return a JSON media type.");
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_OIDC_JSON_BYTES) {
    return rejectBeforeRead("OIDC endpoint response exceeds the accepted size limit.");
  }
  if (!response.body) throw new Error("OIDC endpoint returned an empty response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_OIDC_JSON_BYTES) {
      await reader.cancel();
      throw new Error("OIDC endpoint response exceeds the accepted size limit.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch (cause) {
    throw new Error("OIDC endpoint returned malformed JSON.", { cause });
  }
}
