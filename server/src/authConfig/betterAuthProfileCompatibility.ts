import type { StrictOidcProfile } from "./strictOidcErrors";
import { parseResourceAvatarUrl } from "@capacitylens/shared/domain/resourceAvatarUrl";

type BetterAuthProfileCompatibility = {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  image?: string;
};

/**
 * Bridge Better Auth 1.6's narrower declaration to its runtime-supported null-clearing update.
 * The generic OAuth adapter forwards this object unchanged; `overrideUserInfo` then persists null.
 */
export function adaptStrictOidcProfileForBetterAuth(profile: StrictOidcProfile): BetterAuthProfileCompatibility {
  return profile as unknown as BetterAuthProfileCompatibility;
}

/** Map a provider picture claim: valid HTTPS updates while absent or invalid input clears. */
export function mapExternalAvatar(value: unknown): { image?: string } {
  const parsed = parseResourceAvatarUrl(value);
  return { image: ((parsed.ok ? parsed.value : null) ?? null) as unknown as string };
}
