import { m } from "@/i18n";
import { APP_NAME } from "@capacitylens/shared/brand";
import { can } from "@capacitylens/shared/domain/access";
import { useId } from "react";
import { transitionAccount } from "../../auth/accountTransition";
import { useAuth } from "../../auth/authContext";
import { useOfflineState } from "../../data/useOfflineState";
import { accessLabelFor } from "../../lib/accessCopy";
import { accessExperienceFor } from "../../lib/accessMode";
import { FAKE_USER, useDemoAuthActive } from "../../lib/fakeAuth";
import { DEFAULT_COLORS } from "../../lib/palette";
import { useStore } from "../../store/useStore";
import { AddButton, Avatar, DeleteButton, SegmentedControl, SelectField, TextField } from "../common/ui";
import { Alert, AlertDescription } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../ui/card";
import { FieldError } from "../ui/field";
import { Item, ItemGroup } from "../ui/item";
import { DeleteCompanyDialog } from "./DeleteCompanyDialog";
import { useCreateAccountForm } from "./useCreateAccountForm";
import { useDeleteAccount } from "./useDeleteAccount";

// Full-screen tenant chooser. Shown on first entry, every multi-company load and whenever the user
// picks "Switch company". A browser reload with one valid company can bypass it without persisting
// activeAccountId. Lets you open an existing company, create one inline, or delete one
// (cascade-drops its data).
//
// The list comes from `accountSummaries` (P1.13), NOT `data.accounts`: in server mode `data` holds
// only the ACTIVE account's slice, so it can't list the login's OTHER tenants — `accountSummaries`
// (server-sourced from GET /api/accounts; local-derived from data.accounts) is the only complete list.
export function AccountPicker() {
  const accounts = useStore((s) => s.accountSummaries);
  const previousAccountId = useStore((s) => s.previousAccountId);
  // If we got here via "Switch company" and that account is still in the list, offer a way back.
  const previous = accounts.find((a) => a.id === previousAccountId) ?? null;
  // Cosmetic demo sign-in (see FakeSignIn): when the real auth seam is off, the picker is
  // the post-"login" screen, so show who's "signed in" + a Sign out back to the demo gate.
  const demoAuthActive = useDemoAuthActive();
  const signOutDemo = useStore((s) => s.signOutDemo);
  // Hide the create affordance whenever the server says a create would be refused
  // (canCreateAccount: false — the single-company cap, or auth-on with no owner/admin standing).
  // Fails open to `true` (see authContext.ts) whenever the fact is unavailable, so a
  // self-hosted/demo build with no policy in place is unaffected. `refreshAuth` re-asks /me after
  // an org create/delete — the server recomputes canCreateAccount per request, so those are exactly
  // the moments the boot-time snapshot goes stale (see the call sites below).
  const { authMode, canCreateAccount, refreshAuth } = useAuth();
  const accessExperience = accessExperienceFor(authMode);
  const offline = useOfflineState();
  const activateAccount = (id: string) => {
    void transitionAccount(id);
  };

  const roleDescriptionPrefix = useId();
  const { form, submit, reset: resetForm } = useCreateAccountForm({ refreshAuth });
  const {
    creating,
    setCreating,
    submitting,
    name,
    setName,
    weekStartsOn,
    setWeekStartsOn,
    timezone,
    setTimezone,
    error,
    errorField,
    errorId,
    clear,
    tzSelectOptions,
    weekStartSelectOptions,
  } = form;
  const { deleting, confirming, setConfirming, confirmDelete } = useDeleteAccount({ refreshAuth });

  return (
    <div className="flex min-h-full items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-md">
        {demoAuthActive && (
          <div className="mb-4 flex items-center justify-between gap-2 text-sm">
            <span className="truncate text-muted-foreground">
              {m.picker_signed_in_as()}
              <span className="font-medium text-ink">{FAKE_USER.name}</span>
            </span>
            <Button variant="link" onClick={signOutDemo} className="h-auto shrink-0 p-0 text-muted-foreground">
              {m.picker_sign_out()}
            </Button>
          </div>
        )}
        {previous && (
          <Button
            variant="link"
            onClick={() => activateAccount(previous.id)}
            className="mb-4 h-auto p-0 text-sm text-muted-foreground"
          >
            {m.picker_back({ name: previous.name })}
          </Button>
        )}
        <div className="mb-6 text-center">
          <div className="mb-1 text-2xl font-bold text-brand">{APP_NAME}</div>
          <h1 className="text-lg font-semibold text-ink">
            {accounts.length === 0 ? m.picker_empty_title() : m.picker_title()}
          </h1>
          {/* At the single-company cap the create affordance is hidden (see below), so the
              subtitle must not promise "or create a new one" — that copy would point at nothing. */}
          <p className="text-sm text-muted-foreground">
            {accounts.length === 0
              ? canCreateAccount
                ? m.picker_empty_subtitle()
                : m.picker_empty_subtitle_no_create()
              : canCreateAccount
                ? m.picker_subtitle()
                : m.picker_subtitle_capped()}
          </p>
        </div>

        {accounts.length === 0 && !creating && (
          <div data-testid="company-empty-options" className="mt-4 flex flex-col gap-2">
            {canCreateAccount && (
              <Card>
                <CardHeader>
                  <CardDescription>{m.picker_empty_create_hint()}</CardDescription>
                </CardHeader>
                <CardFooter>
                  <AddButton
                    label={m.picker_new()}
                    onClick={() => setCreating(true)}
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
        )}

        {accounts.length > 0 && (
          <ItemGroup className="gap-2">
            {accounts.map((a, index) => {
              const roleDescriptionId = `${roleDescriptionPrefix}-company-role-${index}`;
              const accessLabel = accessLabelFor({
                offlineReadOnly: offline.readOnly,
                experience: accessExperience,
                permissionStatus: a.roleStatus ?? "resolved",
                role: a.role,
              });
              return (
                <Item key={a.id} role="listitem" className="gap-2 p-0">
                  <Button
                    variant="outline"
                    aria-label={a.name}
                    aria-describedby={roleDescriptionId}
                    onClick={() => activateAccount(a.id)}
                    className="h-auto flex-1 justify-start gap-3 px-3 py-2.5 text-left"
                  >
                    {/* AccountSummary carries no colour (it's the minimal server-sourced shape — P1.13), so
                      the picker swatch uses the default account colour. The real per-account colour shows
                      once the slice is loaded; the picker pre-loads only id/name/role. */}
                    <Avatar name={a.name} color={DEFAULT_COLORS.account} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{a.name}</span>
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
                  {/* Company deletion is owner-only server-side, so every non-owner summary gets no
                    Delete affordance at all — offering one would let them type-to-confirm an
                    irreversible-looking action that then just 403s. Demo summaries are always 'owner'. */}
                  {a.roleStatus !== "unavailable" && can(a.role, "deleteAccount") && (
                    <DeleteButton label={m.picker_delete_company({ name: a.name })} onClick={() => setConfirming(a)} />
                  )}
                </Item>
              );
            })}
          </ItemGroup>
        )}

        {creating ? (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              submit();
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
                  value={name}
                  onChange={(next) => {
                    setName(next);
                    if (errorField === "name") clear();
                  }}
                  autoFocus
                  invalid={errorField === "name"}
                  describedById={errorId}
                />
                {/* The three calendar/locale facts captured at creation and FROZEN afterwards (P1.14). */}
                <div>
                  <p className="mb-1.5 text-xs font-medium text-ink">{m.picker_week_start()}</p>
                  <SegmentedControl
                    ariaLabel={m.picker_week_start()}
                    value={weekStartsOn}
                    onChange={setWeekStartsOn}
                    options={weekStartSelectOptions}
                  />
                </div>
                <SelectField
                  label={m.picker_timezone()}
                  value={timezone}
                  onChange={setTimezone}
                  options={tzSelectOptions}
                />
                <div>
                  {/* Language is English-only until P1.5.1 (Paraglide), so a fixed display, not a chooser. */}
                  <p className="mb-1.5 text-xs font-medium text-ink">{m.picker_language()}</p>
                  <p className="text-sm text-muted-foreground" data-testid="create-language">
                    {m.picker_language_english()}
                  </p>
                </div>
                <FieldError id={errorId}>{error}</FieldError>
              </CardContent>
              <CardFooter className="justify-end">
                <Button size="sm" type="button" variant="outline" onClick={resetForm}>
                  {m.picker_cancel()}
                </Button>
                <Button size="sm" type="submit" disabled={submitting}>
                  {m.picker_create()}
                </Button>
              </CardFooter>
            </Card>
          </form>
        ) : (
          // The button itself disappears whenever a create would be refused — the single-company
          // cap, or auth-on without owner/admin standing (a stricter read than disabling it —
          // there's nothing useful to do once it's hidden). canCreateAccount is kept FRESH, not
          // just read at boot: the server recomputes it per /me request, and this picker re-asks
          // (refreshAuth) after every org create/delete — so deleting the last company re-surfaces
          // this button via the zero-accounts bootstrap exemption, without a manual reload.
          accounts.length > 0 &&
          canCreateAccount && (
            <div className="mt-4">
              <AddButton
                label={m.picker_new()}
                onClick={() => setCreating(true)}
                testId="new-company-button"
                requiresEdit={false}
              />
            </div>
          )
        )}

        {confirming && (
          <DeleteCompanyDialog
            account={confirming}
            busy={deleting}
            onConfirm={() => confirmDelete(confirming.id)}
            onCancel={() => {
              if (!deleting) setConfirming(null);
            }}
          />
        )}
      </div>
    </div>
  );
}
