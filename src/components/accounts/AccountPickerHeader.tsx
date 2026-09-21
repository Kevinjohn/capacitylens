import { m } from "@/i18n";
import { APP_NAME } from "@capacitylens/shared/brand";
import { FAKE_USER } from "../../lib/fakeAuth";
import type { AccountSummary } from "../../store/useStore";
import { Button } from "../ui/button";

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
      <h1 className="text-lg font-semibold text-ink">
        {resolvePickerTitle({ accountCount, canCreateAccount, companySetupEligible })}
      </h1>
      <p className="text-sm text-muted-foreground">
        {companySetupEligible ? m.picker_first_company_subtitle() : subtitle}
      </p>
    </div>
  );
}

function DemoSessionBar({ onSignOut }: { onSignOut: () => void }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-2 text-sm">
      <span className="truncate text-muted-foreground">
        {m.picker_signed_in_as()}
        <span className="font-medium text-ink">{FAKE_USER.name}</span>
      </span>
      <Button variant="link" onClick={onSignOut} className="h-auto shrink-0 p-0 text-muted-foreground">
        {m.picker_sign_out()}
      </Button>
    </div>
  );
}

export function AccountPickerHeader({
  demoAuthActive,
  previous,
  accountCount,
  canCreateAccount,
  companySetupEligible,
  onSignOut,
  onActivate,
}: {
  demoAuthActive: boolean;
  previous: AccountSummary | null;
  accountCount: number;
  canCreateAccount: boolean;
  companySetupEligible: boolean;
  onSignOut: () => void;
  onActivate: (id: string) => void;
}) {
  return (
    <>
      {demoAuthActive && <DemoSessionBar onSignOut={onSignOut} />}
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
