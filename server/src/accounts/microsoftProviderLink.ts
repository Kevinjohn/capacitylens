import type { FastifyRequest } from "fastify";
import type { Auth } from "../auth";
import type { SsoCutoverIdentityPort } from "./betterAuthIdentityPort";
import { MicrosoftProofError } from "../authConfig/microsoftProof";
import { newId } from "@capacitylens/shared/lib/id";
import { resolveRequestClientIp } from "../routes/appErrors";

type LinkBody = { callbackURL: string; errorCallbackURL: string; providerId?: string };

function returnUrl(value: string, marker: string, ceremonyId: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new MicrosoftProofError("INVALID_CALLBACK_URL", 400);
  }
  url.searchParams.set("capacitylensIdentityProvider", "microsoft");
  url.searchParams.set(marker, ceremonyId);
  return url.toString();
}

export async function startMicrosoftProviderLink(input: {
  auth: Auth;
  identity: SsoCutoverIdentityPort;
  request: FastifyRequest;
  body: LinkBody;
  headers: Headers;
  trustProxyHeaders: boolean;
}): Promise<{ url: string; setCookies: string[] } | null> {
  const { auth, identity, request, body, headers } = input;
  if (
    body.providerId !== "microsoft" ||
    !auth.microsoftProof ||
    !auth.providers.some((provider) => provider.id === "microsoft" && !provider.experimental)
  )
    return null;
  const principalId = request.accountActor?.principalId;
  if (!principalId) throw new MicrosoftProofError("MICROSOFT_LINK_SESSION_EXPIRED", 401);
  const links = identity.inspectProviderLinks(principalId, "microsoft");
  if (links.length > 0) {
    throw new MicrosoftProofError(links.length === 1 ? "PROVIDER_ALREADY_LINKED" : "MULTIPLE_PROVIDER_LINKS", 409);
  }
  const ceremonyId = newId();
  return auth.microsoftProof.start({
    body: {
      purpose: "link",
      callbackURL: returnUrl(body.callbackURL, "capacitylensSsoLinked", ceremonyId),
      errorCallbackURL: returnUrl(body.errorCallbackURL, "capacitylensSsoLinkFailed", ceremonyId),
    },
    headers,
    sourceIp: resolveRequestClientIp({ request, trustProxyHeaders: input.trustProxyHeaders }),
  });
}
