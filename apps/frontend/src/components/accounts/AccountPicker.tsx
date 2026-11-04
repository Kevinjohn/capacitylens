import { m } from '@/i18n';
import { isServerConfigured } from '@/data/apiConfig';
import { useId } from 'react';
import type { ReactNode } from 'react';
import { transitionAccount } from '@/auth/accountTransition';
import { useAuth } from '@/auth/authContext';
import { resolveAccessLabel } from '@/lib/accessCopy';
import { resolveAccessExperience } from '@/lib/resolveAccessExperience';
import type { AccessExperience } from '@/lib/resolveAccessExperience';
import { useDemoAuthActive } from '@/lib/fakeAuth';
import { DEFAULT_COLORS } from '@/lib/palette';
import type { AccountSummary } from '@/store/useStore';
import { useStore } from '@/store/useStore';
import { AddButton, Avatar } from '@/components/common/ui';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardFooter, CardHeader } from '@/components/ui/card';
import { Item, ItemGroup } from '@/components/ui/item';
import { AccountPickerHeader } from './AccountPickerHeader';
import { useCreateAccountForm } from './useCreateAccountForm';
import { AccountCreationPanel } from './CreateAccountPanel';

interface AccountItemsProps {
  accounts: AccountSummary[];
  accessExperience: AccessExperience;
  roleDescriptionPrefix: string;
  onActivate: (id: string) => void;
}

function AccountItems(input: AccountItemsProps) {
  return (
    <ItemGroup className="gap-2">
      {input.accounts.map((account, index) => {
        const roleDescriptionId = `${input.roleDescriptionPrefix}-company-role-${index}`;
        const accessLabel = resolveAccessLabel({
          experience: input.accessExperience,
          permissionStatus: account.roleStatus ?? 'resolved',
          role: account.role,
        });
        return (
          <Item key={account.id} role="listitem" className="gap-2 p-0">
            <Button
              variant="outline"
              aria-label={account.name}
              aria-describedby={roleDescriptionId}
              onClick={() => input.onActivate(account.id)}
              className="h-auto flex-1 justify-start gap-3 px-3 py-2.5 text-left"
            >
              <Avatar name={account.name} color={DEFAULT_COLORS.account} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{account.name}</span>
                <Badge
                  id={roleDescriptionId}
                  data-testid="company-role"
                  variant="outline"
                  className="mt-1 text-2xs text-muted-foreground"
                >
                  {accessLabel}
                </Badge>
              </span>
            </Button>
          </Item>
        );
      })}
    </ItemGroup>
  );
}

function EmptyAccountOptions({
  canCreateAccount,
  companySetupEligible,
  onCreate,
}: {
  canCreateAccount: boolean;
  companySetupEligible: boolean;
  onCreate: () => void;
}) {
  if (companySetupEligible) return null;
  return (
    <div data-testid="company-empty-options" className="mt-4 flex flex-col gap-2">
      {canCreateAccount && (
        <Card>
          <CardHeader>
            <CardDescription>{m.picker_empty_create_hint()}</CardDescription>
          </CardHeader>
          <CardFooter>
            <AddButton
              label={m.picker_new()}
              onClick={onCreate}
              testId="new-company-button"
              requiresEdit={false}
            />
          </CardFooter>
        </Card>
      )}
      <Alert>
        <AlertDescription>{m.picker_empty_invite()}</AlertDescription>
      </Alert>
    </div>
  );
}

function CreateAccountAffordance({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="mt-4">
      <AddButton
        label={m.picker_new()}
        onClick={onCreate}
        testId="new-company-button"
        requiresEdit={false}
      />
    </div>
  );
}

function PickerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}

function activateAccount(id: string): void {
  void transitionAccount(id);
}

// Full-screen tenant chooser. `accountSummaries`, rather than the active account slice, is the
// complete server-backed list of companies this login may open.
/** Lists accessible accounts and exposes account creation and management actions. */
export function AccountPicker() {
  const accounts = useStore((state) => state.accountSummaries);
  const accountSummariesComplete = useStore((state) => state.accountSummariesComplete);
  const accountSummariesAmbiguous = useStore((state) => state.accountSummariesAmbiguous);
  const previousAccountId = useStore((state) => state.previousAccountId);
  const demoAuthActive = useDemoAuthActive();
  const previous = demoAuthActive
    ? (accounts.find((account) => account.id === previousAccountId) ?? null)
    : null;
  const { canCreateAccount: authCanCreateAccount } = useAuth();
  const roleDescriptionPrefix = useId();
  const { form, submit, reset } = useCreateAccountForm();
  const beginCreating = () => form.setCreating(true);
  const productionMode = isServerConfigured();
  const canCreateAccount = !productionMode && authCanCreateAccount;
  const companySetupEligible =
    accounts.length === 0 && accountSummariesComplete && canCreateAccount;
  const conflictingProductionCompanies = productionMode && accounts.length > 1;
  const ambiguousInstallation =
    productionMode && (conflictingProductionCompanies || accountSummariesAmbiguous);

  if (ambiguousInstallation) {
    return (
      <PickerLayout>
        <p role="alert" className="max-w-md text-center text-sm text-danger">
          {m.picker_multiple_companies_error()}
        </p>
      </PickerLayout>
    );
  }

  if (productionMode && (accounts.length > 0 || !accountSummariesComplete)) {
    return (
      <PickerLayout>
        <p role="status" className="text-sm text-muted-foreground">
          {m.app_loading()}
        </p>
      </PickerLayout>
    );
  }

  return (
    <PickerLayout>
      <AccountPickerHeader
        previous={previous}
        accountCount={accounts.length}
        canCreateAccount={canCreateAccount}
        companySetupEligible={companySetupEligible}
        onActivate={activateAccount}
      />
      {accounts.length === 0 && !form.creating ? (
        <EmptyAccountOptions
          canCreateAccount={canCreateAccount}
          companySetupEligible={companySetupEligible}
          onCreate={beginCreating}
        />
      ) : null}
      {!productionMode && accounts.length > 0 && (
        <AccountItems
          accounts={accounts}
          accessExperience={resolveAccessExperience()}
          roleDescriptionPrefix={roleDescriptionPrefix}
          onActivate={activateAccount}
        />
      )}
      <AccountCreationPanel
        form={form}
        companySetupEligible={companySetupEligible}
        onSubmit={submit}
        onCancel={reset}
      />
      {!productionMode && !form.creating && accounts.length > 0 && canCreateAccount && (
        <CreateAccountAffordance onCreate={beginCreating} />
      )}
    </PickerLayout>
  );
}
