import { useEffect, useRef, useState } from "react";
import { accountClient } from "@/account/accountClient";
import type { AuthProviderInfo } from "@/auth/authContext";
import { m } from "@/i18n";

function readIdentityProviderStatus(body: unknown): { connected: boolean } {
  if (!body || typeof body !== "object") throw new Error("Invalid identity-provider status response.");
  const status = body as { connected?: unknown; verified?: unknown };
  if (typeof status.connected !== "boolean" || typeof status.verified !== "boolean") {
    throw new Error("Invalid identity-provider status response.");
  }
  if (status.connected && !status.verified) throw new Error("Identity-provider connection is not verified.");
  return { connected: status.connected };
}

function readIdentityLinkResult(body: unknown): { url?: unknown; code?: unknown } | null {
  return body && typeof body === "object" ? body : null;
}

function isAlreadyLinked(result: { code?: unknown } | null): boolean {
  return result?.code === "PROVIDER_ALREADY_LINKED" || result?.code === "MULTIPLE_PROVIDER_LINKS";
}

function clearIdentityLinkParams(url: URL) {
  if (!url.searchParams.has("capacitylensSsoLinked") && !url.searchParams.has("capacitylensSsoLinkFailed")) return;
  url.searchParams.delete("capacitylensIdentityProvider");
  url.searchParams.delete("capacitylensSsoLinked");
  url.searchParams.delete("capacitylensSsoLinkFailed");
  window.history.replaceState(window.history.state, "", url);
}

export function useProviderConnection(
  provider: AuthProviderInfo | undefined,
  busy: boolean,
  setBusy: (busy: boolean) => void,
) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    if (!provider) return;
    const requestGeneration = ++generation.current;
    const url = new URL(window.location.href);
    const returnedProvider = url.searchParams.get("capacitylensIdentityProvider");
    const isProviderReturn = returnedProvider === null || returnedProvider === provider.id;
    const linkFailed = isProviderReturn && url.searchParams.has("capacitylensSsoLinkFailed");
    void accountClient
      .getIdentityProvider(provider.id)
      .then(async (response) => {
        if (!response.ok) throw new Error("Identity-provider status request failed.");
        const status = readIdentityProviderStatus(await response.json().catch(() => null));
        if (requestGeneration === generation.current) {
          setConnected(status.connected);
          setError(linkFailed ? m.settings_sso_connect_error() : null);
        }
      })
      .catch((cause: unknown) => {
        console.error("SecuritySection: identity-provider status failed", cause);
        if (requestGeneration === generation.current) setError(m.settings_sso_status_error());
      });
    if (isProviderReturn) clearIdentityLinkParams(url);
    return () => {
      generation.current += 1;
    };
  }, [provider]);

  const connect = async () => {
    if (!provider || busy) return;
    setBusy(true);
    setError(null);
    try {
      const callback = new URL(window.location.href);
      callback.searchParams.set("capacitylensIdentityProvider", provider.id);
      const response = await accountClient.linkIdentityProvider(callback.toString(), provider.id);
      const result = readIdentityLinkResult(await response.json().catch(() => null));
      if (response.status === 409 && isAlreadyLinked(result)) {
        setConnected(true);
        setError(result?.code === "MULTIPLE_PROVIDER_LINKS" ? m.settings_sso_status_error() : null);
        setBusy(false);
        return;
      }
      if (!response.ok || typeof result?.url !== "string") throw new Error("Invalid identity-link response.");
      window.location.assign(result.url);
    } catch (cause) {
      console.error("SecuritySection: identity-provider link failed", cause);
      setError(m.settings_sso_connect_error());
      setBusy(false);
    }
  };

  return { connected, error, connect };
}
