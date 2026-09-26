import { allowsPasswordSignIn } from "@capacitylens/shared/account/types";
import type { BetterAuthPlugin, BetterAuthOptions } from "better-auth";
import { twoFactor } from "better-auth/plugins";

export function buildPlugins({
  mode,
  totpIssuer,
}: {
  mode: "password-only" | "sso-only" | "password-and-sso";
  totpIssuer: string;
}): Pick<BetterAuthOptions, "plugins"> {
  const plugins: BetterAuthPlugin[] = [];
  if (allowsPasswordSignIn(mode)) {
    plugins.push(
      twoFactor({
        issuer: totpIssuer,
        allowPasswordless: true,
        twoFactorCookieMaxAge: 5 * 60,
        trustDeviceMaxAge: 7 * 24 * 60 * 60,
        totpOptions: { digits: 6, period: 30, allowPasswordless: true },
        accountLockout: {
          enabled: true,
          maxFailedAttempts: 5,
          durationSeconds: 15 * 60,
        },
      }),
    );
  }
  return { plugins };
}
