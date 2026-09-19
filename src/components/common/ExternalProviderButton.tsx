import type { ComponentProps } from "react";
import { hasGoogleProviderBrand, type AuthProviderInfo } from "../../auth/authContext";
import { cn } from "@/lib/utils";
import googleSignInDark from "../../assets/google-sign-in-dark.png";
import googleSignInLight from "../../assets/google-sign-in-light.png";
import { Button } from "../ui/button";

type ExternalProviderButtonProps = Omit<ComponentProps<typeof Button>, "children"> & {
  provider: Pick<AuthProviderInfo, "id" | "kind" | "brand">;
  /** The provider-specific label used for non-Google providers. */
  label: string;
  /** The localized Google action label, which is also the accessible name. */
  googleLabel: string;
  /** Microsoft's prescribed action label, used for social and branded OIDC providers. */
  microsoftLabel: string;
};

/**
 * Renders recognisable sign-in actions for every supported social provider and preserves configured
 * copy for generic OIDC providers. Branded OIDC providers share their matching presentation.
 */
export function ExternalProviderButton({
  provider,
  label,
  googleLabel,
  microsoftLabel,
  className,
  style,
  "aria-label": ariaLabel,
  ...buttonProps
}: ExternalProviderButtonProps) {
  const presentation = resolveProviderPresentation(provider);
  if (!presentation) {
    return (
      <Button {...buttonProps} className={className} style={style} aria-label={ariaLabel}>
        {label}
      </Button>
    );
  }

  let accessibleLabel = ariaLabel;
  if (presentation === "google") accessibleLabel = googleLabel;
  if (presentation === "microsoft") accessibleLabel = microsoftLabel;
  return (
    <Button
      {...buttonProps}
      className={cn(
        "h-10 min-h-10 self-center rounded-[4px] p-0 shadow-none",
        providerButtonClassNames[presentation],
        className,
      )}
      style={style}
      aria-label={accessibleLabel}
    >
      <ProviderButtonContent
        presentation={presentation}
        googleLabel={googleLabel}
        microsoftLabel={microsoftLabel}
        label={label}
      />
    </Button>
  );
}

type ProviderPresentation = "google" | "microsoft" | "github";

const providerButtonClassNames: Record<ProviderPresentation, string> = {
  google: "w-[180px] border-0 bg-transparent focus-visible:ring-0",
  microsoft:
    "w-[215px] border border-[#8c8c8c] bg-white px-3 text-[#5e5e5e] hover:bg-[#f5f5f5] hover:text-[#5e5e5e] dark:border-[#8c8c8c] dark:bg-[#2f2f2f] dark:text-white dark:hover:bg-[#3b3b3b] dark:hover:text-white",
  github:
    "w-[215px] border border-[#24292f] bg-[#24292f] px-3 text-white hover:bg-[#1b1f23] hover:text-white dark:border-white/30 dark:bg-white dark:text-[#24292f] dark:hover:bg-[#f0f0f0] dark:hover:text-[#24292f]",
};

function resolveProviderPresentation(
  provider: Pick<AuthProviderInfo, "id" | "kind" | "brand">,
): ProviderPresentation | null {
  if (hasGoogleProviderBrand(provider)) return "google";
  if (
    provider.brand === "microsoft" ||
    (provider.brand === undefined && provider.kind === "social" && provider.id === "microsoft")
  )
    return "microsoft";
  if (provider.kind === "social" && provider.id === "github") return "github";
  return null;
}

function ProviderButtonContent({
  presentation,
  googleLabel,
  microsoftLabel,
  label,
}: {
  presentation: ProviderPresentation;
  googleLabel: string;
  microsoftLabel: string;
  label: string;
}) {
  if (presentation === "google")
    return (
      <>
        <GoogleMark />
        <span className="sr-only">{googleLabel}</span>
      </>
    );
  if (presentation === "microsoft")
    return (
      <>
        <MicrosoftMark />
        {microsoftLabel}
      </>
    );
  return (
    <>
      <GitHubMark />
      {label}
    </>
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
        width="360"
        height="80"
        className="block h-10 w-[180px] max-w-full object-contain dark:hidden"
      />
      <img
        src={googleSignInDark}
        alt=""
        aria-hidden="true"
        data-testid="google-mark-dark"
        width="360"
        height="80"
        className="hidden h-10 w-[180px] max-w-full object-contain dark:block"
      />
    </>
  );
}

/** Microsoft logo geometry and colours follow Microsoft's identity-platform branding guidance. */
function MicrosoftMark() {
  return (
    <svg viewBox="0 0 21 21" aria-hidden="true" data-testid="microsoft-mark" className="size-[21px]">
      <path fill="#f25022" d="M1 1h9v9H1z" />
      <path fill="#7fba00" d="M11 1h9v9h-9z" />
      <path fill="#00a4ef" d="M1 11h9v9H1z" />
      <path fill="#ffb900" d="M11 11h9v9h-9z" />
    </svg>
  );
}

/** GitHub's Invertocat silhouette, from the source-owned Primer Octicons mark. */
function GitHubMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" data-testid="github-mark" className="size-5 fill-current">
      <path d="M12 1C5.923 1 1 5.923 1 12c0 4.867 3.149 8.979 7.521 10.436.55.096.756-.233.756-.522 0-.262-.013-1.128-.013-2.049-2.764.509-3.479-.674-3.699-1.293-.124-.317-.66-1.293-1.128-1.554-.385-.207-.935-.715-.014-.729.866-.014 1.485.797 1.691 1.128.99 1.663 2.571 1.196 3.204.907.096-.715.385-1.196.701-1.471-2.448-.275-5.005-1.224-5.005-5.432 0-1.196.426-2.186 1.128-2.956-.111-.275-.496-1.402.11-2.915 0 0 .921-.288 3.024 1.128A10.193 10.193 0 0 1 12 6.306c.935 0 1.87.124 2.75.371 2.104-1.43 3.025-1.128 3.025-1.128.605 1.513.22 2.64.11 2.915.702.77 1.128 1.747 1.128 2.956 0 4.222-2.571 5.157-5.019 5.432.399.344.743 1.004.743 2.035 0 1.471-.014 2.654-.014 3.025 0 .289.206.632.756.522C19.851 20.979 23 16.854 23 12c0-6.077-4.923-11-11-11Z" />
    </svg>
  );
}
