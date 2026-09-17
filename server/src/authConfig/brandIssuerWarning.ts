import { resolveAccountConfigKey } from "../accountConfig";
import type { AuthProviderBrand } from "./authTypes";

/** Reports a startup configuration problem; the server's console in production. */
export type WarnFn = (message: string) => void;

// A branded button promises the person which company they are about to sign in to, so the issuer
// has to be that company. The brand is presentation only and an operator may have a reason we
// cannot see, so a mismatch warns rather than refusing to start.
const BRAND_ISSUER_HOSTS: Partial<Record<AuthProviderBrand, readonly string[]>> = {
  google: ["accounts.google.com"],
  microsoft: ["login.microsoftonline.com", "sts.windows.net"],
};

export function warnOnBrandIssuerMismatch(brand: AuthProviderBrand, issuer: string | undefined, warn: WarnFn): void {
  const expectedHosts = BRAND_ISSUER_HOSTS[brand];
  if (!expectedHosts || !issuer) return;
  let host: string;
  try {
    host = new URL(issuer).hostname.toLowerCase();
  } catch {
    // An unparseable issuer is reported by the issuer validation that runs beside this.
    return;
  }
  if (expectedHosts.includes(host)) return;
  warn(
    `capacitylens-server: configuration warning — ${resolveAccountConfigKey("CAPACITYLENS_SSO_BRAND")}=${brand} ` +
      `shows the ${brand} sign-in button, but ${resolveAccountConfigKey("CAPACITYLENS_SSO_ISSUER")} is ${host}, ` +
      `not ${expectedHosts.join(" or ")}. People will be offered a ${brand} button that signs them in somewhere else.`,
  );
}
