import { API_BASE } from "../data/apiConfig";
import { apiFetch } from "../data/requestTimeout";

export type MicrosoftConnectionPurpose = "bootstrap" | "invite" | "link";
export type MicrosoftConnectionStatus = {
  state: "pending" | "approved" | "expired";
  emailHint?: string;
  deliveryUnavailable?: boolean;
};

type StartInput = {
  purpose: MicrosoftConnectionPurpose;
  callbackURL: string;
  errorCallbackURL: string;
  email?: string;
  inviteToken?: string;
};

async function request(path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
  const init: RequestInit = {
    method: body === undefined ? "GET" : "POST",
    credentials: "include",
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    ...(signal ? { signal } : {}),
  };
  const response = await apiFetch(`${API_BASE}/api/account/microsoft/${path}`, init);
  if (!response.ok) throw new MicrosoftConnectionError(response.status);
  return response.json() as Promise<unknown>;
}

export class MicrosoftConnectionError extends Error {
  readonly status: number;

  constructor(status: number) {
    super("Microsoft connection request failed.");
    this.name = "MicrosoftConnectionError";
    this.status = status;
  }
}

function parseProviderUrl(value: unknown): string {
  if (typeof value !== "string") throw new MicrosoftConnectionError(502);
  let url: URL;
  try {
    url = new URL(value, window.location.href);
  } catch {
    throw new MicrosoftConnectionError(502);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new MicrosoftConnectionError(502);
  return url.href;
}

export async function startMicrosoftConnection(input: StartInput, signal?: AbortSignal) {
  const response = await request("start", input, signal);
  if (!response || typeof response !== "object" || !("url" in response)) {
    throw new MicrosoftConnectionError(502);
  }
  return { data: { url: parseProviderUrl(response.url) } };
}

export async function getMicrosoftConnectionStatus(signal?: AbortSignal): Promise<MicrosoftConnectionStatus> {
  const response = await request("status", undefined, signal);
  if (!response || typeof response !== "object" || !("state" in response)) {
    throw new MicrosoftConnectionError(502);
  }
  const state = response.state;
  if (state !== "pending" && state !== "approved" && state !== "expired") {
    throw new MicrosoftConnectionError(502);
  }
  const emailHint = "emailHint" in response ? response.emailHint : undefined;
  if (emailHint !== undefined && typeof emailHint !== "string") {
    throw new MicrosoftConnectionError(502);
  }
  return {
    state,
    ...readDeliveryStatus(response),
    ...(typeof emailHint === "string" ? { emailHint } : {}),
  };
}

function readDeliveryStatus(response: object): Pick<MicrosoftConnectionStatus, "deliveryUnavailable"> {
  const deliveryUnavailable = "deliveryUnavailable" in response ? response.deliveryUnavailable : undefined;
  if (deliveryUnavailable !== undefined && typeof deliveryUnavailable !== "boolean") {
    throw new MicrosoftConnectionError(502);
  }
  return typeof deliveryUnavailable === "boolean" ? { deliveryUnavailable } : {};
}

export function confirmMicrosoftConnection(token?: string, signal?: AbortSignal) {
  return request("confirm", { token }, signal).then((result) => {
    if (!result || typeof result !== "object" || !("url" in result)) {
      throw new MicrosoftConnectionError(502);
    }
    return { url: parseProviderUrl(result.url) };
  });
}

export async function resendMicrosoftConnection(signal?: AbortSignal) {
  await requestAction("resend", signal);
}

export async function cancelMicrosoftConnection(signal?: AbortSignal) {
  await requestAction("cancel", signal);
}

async function requestAction(action: "resend" | "cancel", signal?: AbortSignal): Promise<void> {
  const response = await request(action, {}, signal);
  if (!response || typeof response !== "object" || !("ok" in response) || response.ok !== true) {
    throw new MicrosoftConnectionError(502);
  }
}
