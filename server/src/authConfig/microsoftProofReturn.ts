import { MicrosoftProofError, type MicrosoftProofIntent } from "./microsoftProofPrimitives";

/** Resolve encrypted application return targets only for the initiating browser's intent. */
export function createMicrosoftProofReturn(input: {
  publicUrl: URL;
  fromHeaders: (headers: Headers) => MicrosoftProofIntent | null;
  decrypt: (value: string) => string;
}) {
  function errorReturnUrl(headers: Headers, code: string): URL | null {
    const intent = input.fromHeaders(headers);
    if (!intent) return null;
    const url = new URL(input.decrypt(intent.errorCallbackUrl));
    url.searchParams.set("error", code);
    return url;
  }

  function resolveInternalReturn(headers: Headers, location: string): URL | null {
    const url = new URL(location, input.publicUrl);
    if (url.origin !== input.publicUrl.origin || url.pathname !== "/api/auth/microsoft-proof-return") return null;
    const intent = input.fromHeaders(headers);
    if (!intent || url.searchParams.get("intent") !== intent.id) {
      throw new MicrosoftProofError("MICROSOFT_PROOF_CALLBACK_MISMATCH", 403);
    }
    const outcome = url.searchParams.get("outcome");
    if (outcome === "success" && intent.state === "completed") return new URL(input.decrypt(intent.callbackUrl));
    if (outcome === "failure") {
      const target = new URL(input.decrypt(intent.errorCallbackUrl));
      const error = url.searchParams.get("error");
      if (error) target.searchParams.set("error", error.slice(0, 128));
      return target;
    }
    throw new MicrosoftProofError("MICROSOFT_PROOF_CALLBACK_MISMATCH", 403);
  }

  return { errorReturnUrl, resolveInternalReturn };
}
