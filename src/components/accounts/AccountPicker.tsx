import { m } from "@/i18n";
import { can } from "@capacitylens/shared/domain/access";
import { useId } from "react";
import type { ReactNode } from "react";
import { transitionAccount } from "../../auth/accountTransition";
import { useAuth } from "../../auth/authContext";
import { useOfflineState } from "../../data/useOfflineState";
import { resolveAccessLabel } from "../../lib/accessCopy";
import { resolveAccessExperience } from "../../lib/resolveAccessExperience";
import type { AccessExperience } from "../../lib/resolveAccessExperience";
import { useDemoAuthActive } from "../../lib/fakeAuth";
import { DEFAULT_COLORS } from "../../lib/palette";
import type { AccountSummary } from "../../store/useStore";
import { useStore } from "../../store/useStore";
import { AddButton, Avatar, DeleteButton, SegmentedControl, TextField } from "../common/ui";
import type { Option, SegmentedOption } from "../common/ui";
import { Alert, AlertDescription } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../ui/card";
import { FieldError } from "../ui/field";
import { Item, ItemGroup } from "../ui/item";
import { DeleteCompanyDialog } from "./DeleteCompanyDialog";
import { TimeZoneField } from "./TimeZoneField";
import { AccountPickerHeader } from "./AccountPickerHeader";
import { useCreateAccountForm } from "./useCreateAccountForm";
import { useDeleteAccount } from "./useDeleteAccount";

interface AccountItemsProps {
  accounts: AccountSummary[];
  accessExperience: AccessExperience;
  offlineReadOnly: boolean;
  roleDescriptionPrefix: string;
  onActivate: (id: string) => void;
  onConfirmDelete: (account: AccountSummary) => void;
}

function AccountItems(input: AccountItemsProps) {
  return (
    <ItemGroup className="gap-2">
      {input.accounts.map((account, index) => {
        const roleDescriptionId = `${input.roleDescriptionPrefix}-company-role-${index}`;
        const accessLabel = resolveAccessLabel({
          offlineReadOnly: input.offlineReadOnly,
          experience: input.accessExperience,
          permissionStatus: account.roleStatus ?? "resolved",
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
            {account.roleStatus !== "unavailable" && can(account.role, "deleteAccount") && (
              <DeleteButton
                label={m.picker_delete_company({ name: account.name })}
                onClick={() => input.onConfirmDelete(account)}
              />
            )}
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
  return (
    <div data-testid="company-empty-options" className="mt-4 flex flex-col gap-2">
      {canCreateAccount && (
        <Card>
          <CardHeader>
            <CardDescription>{m.picker_empty_create_hint()}</CardDescription>
          </CardHeader>
          <CardFooter>
            <AddButton label={m.picker_new()} onClick={onCreate} testId="new-company-button" requiresEdit={false} />
          </CardFooter>
        </Card>
      )}
      {!companySetupEligible && (
        <Alert>
          <AlertDescription>{m.picker_empty_invite()}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

interface CreateAccountPanelProps {
  name: string;
  weekStartsOn: 0 | 1;
  timezone: string;
  error: string | null;
  errorField: string | null;
  errorId: string;
  submitting: boolean;
  timeZoneSelectOptions: Option[];
  weekStartSelectOptions: SegmentedOption<0 | 1>[];
  onNameChange: (name: string) => void;
  onWeekStartChange: (weekStartsOn: 0 | 1) => void;
  onTimeZoneChange: (timezone: string) => void;
  onClearError: () => void;
  onSubmit: () => void;
  onCancel: () => void;
}

interface CreateAccountFormState {
  name: string;
  setName: (name: string) => void;
  weekStartsOn: 0 | 1;
  setWeekStartsOn: (weekStartsOn: 0 | 1) => void;
  timezone: string;
  setTimezone: (timezone: string) => void;
  error: string | null;
  errorField: string | null;
  errorId: string;
  clear: () => void;
  submitting: boolean;
  timeZoneSelectOptions: Option[];
  weekStartSelectOptions: SegmentedOption<0 | 1>[];
}

function buildCreateAccountPanelProps(
  form: CreateAccountFormState,
  onSubmit: () => void,
  onCancel: () => void,
): CreateAccountPanelProps {
  return {
    name: form.name,
    weekStartsOn: form.weekStartsOn,
    timezone: form.timezone,
    error: form.error,
    errorField: form.errorField,
    errorId: form.errorId,
    submitting: form.submitting,
    timeZoneSelectOptions: form.timeZoneSelectOptions,
    weekStartSelectOptions: form.weekStartSelectOptions,
    onNameChange: form.setName,
    onWeekStartChange: form.setWeekStartsOn,
    onTimeZoneChange: form.setTimezone,
    onClearError: form.clear,
    onSubmit,
    onCancel,
  };
}

function AccountLanguageDisplay() {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-ink">{m.picker_language()}</p>
      <p className="text-sm text-muted-foreground" data-testid="create-language">
        {m.picker_language_english()}
      </p>
    </div>
  );
}

function CreateAccountPanel(input: CreateAccountPanelProps) {
  const changeName = (name: string) => {
    input.onNameChange(name);
    if (input.errorField === "name") input.onClearError();
  };
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        input.onSubmit();
      }}
      className="mt-4"
    >
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{m.picker_new()}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <TextField
            label={m.picker_company_name()}
            value={input.name}
            onChange={changeName}
            autoFocus
            invalid={input.errorField === "name"}
            describedById={input.errorId}
          />
          <div>
            <p className="mb-1.5 text-xs font-medium text-ink">{m.picker_week_start()}</p>
            <SegmentedControl
              ariaLabel={m.picker_week_start()}
              value={input.weekStartsOn}
              onChange={input.onWeekStartChange}
              options={input.weekStartSelectOptions}
              fullWidth
            />
          </div>
          <TimeZoneField
            label={m.picker_timezone()}
            value={input.timezone}
            onChange={input.onTimeZoneChange}
            options={input.timeZoneSelectOptions}
          />
          <AccountLanguageDisplay />
          <FieldError id={input.errorId}>{input.error}</FieldError>
        </CardContent>
        <CardFooter className="flex-col gap-2 sm:flex-row sm:justify-end [&>button]:w-full sm:[&>button]:w-auto">
          <Button size="sm" type="button" variant="outline" onClick={input.onCancel}>
            {m.picker_cancel()}
          </Button>
          <Button size="sm" type="submit" disabled={input.submitting}>
            {m.picker_create()}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

interface AccountDeletionDialogProps {
  account: AccountSummary;
  deleting: boolean;
  onConfirm: (id: string) => void;
  onCancel: () => void;
}

function AccountDeletionDialog({ account, deleting, onConfirm, onCancel }: AccountDeletionDialogProps) {
  return (
    <DeleteCompanyDialog
      account={account}
      busy={deleting}
      onConfirm={() => onConfirm(account.id)}
      onCancel={() => {
        if (!deleting) onCancel();
      }}
    />
  );
}

function CreateAccountAffordance({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="mt-4">
      <AddButton label={m.picker_new()} onClick={onCreate} testId="new-company-button" requiresEdit={false} />
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
export function AccountPicker() {
  const accounts = useStore((state) => state.accountSummaries);
  const accountSummariesComplete = useStore((state) => state.accountSummariesComplete);
  const previousAccountId = useStore((state) => state.previousAccountId);
  const signOutDemo = useStore((state) => state.signOutDemo);
  const previous = accounts.find((account) => account.id === previousAccountId) ?? null;
  const demoAuthActive = useDemoAuthActive();
  const { authMode, canCreateAccount, refreshAuth } = useAuth();
  const offline = useOfflineState();
  const roleDescriptionPrefix = useId();
  const { form, submit, reset } = useCreateAccountForm({ refreshAuth });
  const accountDeletion = useDeleteAccount({ refreshAuth });
  const beginCreating = () => form.setCreating(true);
  const createAccountPanelProps = buildCreateAccountPanelProps(form, submit, reset);
  const companySetupEligible = accounts.length === 0 && accountSummariesComplete && canCreateAccount;

  return (
    <PickerLayout>
      <AccountPickerHeader
        demoAuthActive={demoAuthActive}
        previous={previous}
        accountCount={accounts.length}
        canCreateAccount={canCreateAccount}
        companySetupEligible={companySetupEligible}
        onSignOut={signOutDemo}
        onActivate={activateAccount}
      />
      {accounts.length === 0 && !form.creating && (
        <EmptyAccountOptions
          canCreateAccount={canCreateAccount}
          companySetupEligible={companySetupEligible}
          onCreate={beginCreating}
        />
      )}
      {accounts.length > 0 && (
        <AccountItems
          accounts={accounts}
          accessExperience={resolveAccessExperience(authMode)}
          offlineReadOnly={offline.readOnly}
          roleDescriptionPrefix={roleDescriptionPrefix}
          onActivate={activateAccount}
          onConfirmDelete={accountDeletion.setConfirming}
        />
      )}
      {form.creating && <CreateAccountPanel {...createAccountPanelProps} />}
      {!form.creating && accounts.length > 0 && canCreateAccount && (
        <CreateAccountAffordance onCreate={beginCreating} />
      )}
      {accountDeletion.confirming && (
        <AccountDeletionDialog
          account={accountDeletion.confirming}
          deleting={accountDeletion.deleting}
          onConfirm={accountDeletion.confirmDelete}
          onCancel={() => accountDeletion.setConfirming(null)}
        />
      )}
    </PickerLayout>
  );
}
