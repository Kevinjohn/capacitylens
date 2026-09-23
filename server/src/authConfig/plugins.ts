import type { BetterAuthPlugin, BetterAuthOptions } from "better-auth";
import { twoFactor } from "better-auth/plugins";

export function buildPlugins({
  mode,
  totpIssuer,
}: {
  mode: "password" | "sso";
  totpIssuer: string;
}): Pick<BetterAuthOptions, "plugins"> {
  const plugins: BetterAuthPlugin[] = [];
  if (mode === "password") {
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
