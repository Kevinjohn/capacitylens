import type { Db } from "../../db";
import { tx } from "../../txn";
import { cancelJoinIntent, readJoinIntent } from "../../controlTables/joiningIntents";
import {
  hashJoiningValue,
  joiningCookie,
  joiningCookieNames,
  joiningEmailHint,
  readJoiningCookie,
} from "./joiningIntentSecrets";

/** The browser can inspect or cancel its current named-provider join without a session. */
export function createJoiningProviderLifecycle(input: { db: Db; applicationId: string; secureCookies: boolean }) {
  const { db, applicationId, secureCookies } = input;
  const names = joiningCookieNames({ applicationId: applicationId, secure: secureCookies });
  function fromHeaders(headers: Headers) {
    const nonce = readJoiningCookie(headers, names.intent);
    const browser = readJoiningCookie(headers, names.browser);
    if (!nonce || !browser) return null;
    const intent = readJoinIntent(db, hashJoiningValue("nonce", nonce));
    return intent?.browserHash === hashJoiningValue("browser", browser) ? intent : null;
  }
  function status(headers: Headers) {
    const intent = fromHeaders(headers);
    if (!intent || intent.expiresAt <= Date.now() || intent.state === "completed" || intent.state === "cancelled") {
      return { state: "expired" as const };
    }
    return {
      state: intent.state === "approved" ? ("approved" as const) : ("pending" as const),
      accountId: intent.accountId,
      purpose: intent.purpose,
      providerId: intent.providerId,
      email: intent.email,
      emailHint: joiningEmailHint(intent.email),
      deliveryUnavailable: false,
    };
  }
  function cancel(headers: Headers) {
    const intent = fromHeaders(headers);
    if (intent) tx(db, () => cancelJoinIntent(db, intent.nonceHash, Date.now()), "immediate");
    return {
      ok: true,
      setCookie: joiningCookie({ name: names.intent, value: "", secure: secureCookies, maxAge: 0 }),
    };
  }
  return { status, cancel };
}
