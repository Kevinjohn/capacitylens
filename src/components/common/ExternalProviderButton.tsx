import type { ComponentProps } from "react";
import type { AuthProviderInfo } from "../../auth/authContext";
import { cn } from "@/lib/utils";
import googleSignInDark from "../../assets/google-sign-in-dark.png";
import googleSignInLight from "../../assets/google-sign-in-light.png";
import { Button } from "../ui/button";

type ExternalProviderButtonProps = Omit<ComponentProps<typeof Button>, "children"> & {
  provider: Pick<AuthProviderInfo, "id" | "kind">;
  /** The provider-specific label used for non-Google providers. */
  label: string;
  /** The localized Google action label, which is also the accessible name. */
  googleLabel: string;
};

function isGoogleSocialProvider(provider: Pick<AuthProviderInfo, "id" | "kind">): boolean {
  return provider.kind === "social" && provider.id === "google";
}

/**
 * Renders external sign-in actions with Google's recognisable mark and approved high-contrast
 * treatment when the configured provider is Google. Other providers retain their configured copy.
 * See Google's current button requirements: https://developers.google.com/identity/branding-guidelines
 */
export function ExternalProviderButton({
  provider,
  label,
  googleLabel,
  className,
  style,
  "aria-label": ariaLabel,
  ...buttonProps
}: ExternalProviderButtonProps) {
  const google = isGoogleSocialProvider(provider);
  return (
    <Button
      {...buttonProps}
      className={cn(
        google &&
          "h-10 min-h-10 rounded-[4px] border-0 bg-transparent p-0 outline-solid outline-1 outline-[#747775] focus-visible:ring-0 dark:outline-[#8e918f]",
        className,
      )}
      style={style}
      aria-label={google ? googleLabel : ariaLabel}
    >
      {google ? <GoogleMark /> : null}
      {google ? <span className="sr-only">{googleLabel}</span> : label}
    </Button>
  );
}

function GoogleMark() {
  return (
    <>
      <img
        src={googleSignInLight}
        alt=""
        aria-hidden="true"
        data-testid="google-mark-light"
        width="180"
        height="40"
        className="block h-10 w-[180px] max-w-full object-contain dark:hidden"
      />
      <img
        src={googleSignInDark}
        alt=""
        aria-hidden="true"
        data-testid="google-mark-dark"
        width="180"
        height="40"
        className="hidden h-10 w-[180px] max-w-full object-contain dark:block"
      />
    </>
  );
}
