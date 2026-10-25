import { m } from "@/i18n";
import { APP_NAME } from "@capacitylens/shared/brand";
import type { AccountSummary } from "@/store/useStore";
import { Button } from "@/components/ui/button";

interface PickerHeadingProps {
  accountCount: number;
  canCreateAccount: boolean;
  companySetupEligible: boolean;
}

function resolvePickerTitle({ accountCount, companySetupEligible }: PickerHeadingProps): string {
  if (accountCount > 0) return m.picker_title();
  return companySetupEligible ? m.picker_first_company_title() : m.picker_empty_title();
}

function PickerHeading({ accountCount, canCreateAccount, companySetupEligible }: PickerHeadingProps) {
  let subtitle = canCreateAccount ? m.picker_subtitle() : m.picker_subtitle_capped();
  if (accountCount === 0) {
    subtitle = canCreateAccount ? m.picker_empty_subtitle() : m.picker_empty_subtitle_no_create();
  }
  return (
    <div className="mb-6 text-center">
      <div className="mb-1 text-2xl font-bold text-brand">{APP_NAME}</div>
      <h1 className={companySetupEligible ? "sr-only" : "text-lg font-semibold text-ink"}>
        {resolvePickerTitle({ accountCount, canCreateAccount, companySetupEligible })}
      </h1>
      <p className="text-sm text-muted-foreground">
        {companySetupEligible ? m.picker_first_company_subtitle() : subtitle}
      </p>
    </div>
  );
}

/** Shows account picker context and actions for the current auth mode. */
export function AccountPickerHeader({
  previous,
  accountCount,
  canCreateAccount,
  companySetupEligible,
  onActivate,
}: {
  previous: AccountSummary | null;
  accountCount: number;
  canCreateAccount: boolean;
  companySetupEligible: boolean;
  onActivate: (id: string) => void;
}) {
  return (
    <>
      {previous && (
        <Button
          variant="link"
          onClick={() => onActivate(previous.id)}
          className="mb-4 h-auto p-0 text-sm text-muted-foreground"
        >
          {m.picker_back({ name: previous.name })}
        </Button>
      )}
      <PickerHeading
        accountCount={accountCount}
        canCreateAccount={canCreateAccount}
        companySetupEligible={companySetupEligible}
      />
    </>
  );
}
