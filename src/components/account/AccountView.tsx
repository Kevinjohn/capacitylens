import { useAuth } from "@/auth/authContext";
import demoAvatarUrl from "@/assets/avatar-demo.svg";
import { m } from "@/i18n";
import { FAKE_USER, useDemoAuthActive } from "@/lib/fakeAuth";
import { DEFAULT_COLORS } from "@/lib/palette";
import { useStore } from "@/store/useStore";
import { LogOut } from "lucide-react";
import { useState } from "react";
import { Avatar, ListPage } from "../common/ui";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { SecuritySection } from "../settings/SecuritySection";
import { SettingsSection } from "../settings/SettingsSection";

function resolveIdentity(auth: ReturnType<typeof useAuth>, demo: boolean) {
  const identity = demo ? FAKE_USER : auth.user;
  return {
    name: identity?.name ?? identity?.email ?? m.account_local_identity(),
    email: identity?.email,
    imageUrl: demo ? demoAvatarUrl : (auth.user?.image ?? undefined),
  };
}

function resolveAccessLabel(authMode: ReturnType<typeof useAuth>["authMode"], demo: boolean): string | null {
  if (demo) return m.account_demo_access();
  if (authMode === "off") return m.account_auth_off();
  return null;
}

function EmailCell({ email }: { email: string | undefined }) {
  return (
    <td className="max-w-52 py-2 px-4 text-xs text-muted-foreground">
      {email && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="block truncate" tabIndex={0} aria-label={email}>
              {email}
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-[min(20rem,calc(100vw-2rem))] break-all">{email}</TooltipContent>
        </Tooltip>
      )}
    </td>
  );
}

/** Renders the signed-in person's identity and personal security controls outside company data. */
export function AccountView() {
  const auth = useAuth();
  const demo = useDemoAuthActive();
  const signOutDemo = useStore((state) => state.signOutDemo);
  const { name, email, imageUrl } = resolveIdentity(auth, demo);
  const accessLabel = resolveAccessLabel(auth.authMode, demo);
  const [passwordOpen, setPasswordOpen] = useState(false);

  return (
    <ListPage title={m.account_title()} wide>
      <div className="flex flex-col gap-6">
        <SettingsSection title={m.account_identity_title()} help={m.account_identity_help()}>
          <div className="max-w-full overflow-x-auto rounded-md border bg-card">
            <table className="w-full min-w-[41rem] table-fixed text-sm">
              <caption className="sr-only">{m.account_identity_title()}</caption>
              <colgroup>
                <col className="w-[24%]" />
                <col className="w-[20%]" />
                <col className="w-[16%]" />
                <col className="w-[40%]" />
              </colgroup>
              <thead>
                <tr className="border-b text-left text-xs font-medium text-muted-foreground">
                  <th scope="col" className="py-2 px-4 font-medium">
                    {m.settings_member_col_name()}
                  </th>
                  <th scope="col" className="py-2 px-4 font-medium">
                    {m.settings_member_col_email()}
                  </th>
                  <th scope="col" className="py-2 px-4 font-medium">
                    {m.account_col_access()}
                  </th>
                  <th scope="col" className="py-2 px-4 text-right font-medium">
                    {m.settings_member_col_actions()}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr data-testid="account-identity-row">
                  <td className="py-2 px-4 font-medium text-ink whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <Avatar name={name} color={DEFAULT_COLORS.account} {...(imageUrl ? { imageUrl } : {})} />
                      <span className="block min-w-0 flex-1 truncate" title={name}>
                        {name}
                      </span>
                    </div>
                  </td>
                  <EmailCell email={email} />
                  <td className="py-2 px-4 text-xs text-muted-foreground whitespace-nowrap">
                    <span className="block truncate" title={accessLabel ?? undefined}>
                      {accessLabel}
                    </span>
                  </td>
                  <td className="py-2 px-4 text-right whitespace-nowrap">
                    <div className="flex justify-end gap-2">
                      {!demo && auth.authMode === "password" && auth.reauthMethod !== "provider" && (
                        <Button type="button" size="sm" variant="outline" onClick={() => setPasswordOpen(true)}>
                          {m.settings_security_change_password()}
                        </Button>
                      )}
                      {(demo || auth.authMode !== "off") && (
                        <Button
                          type="button"
                          size="sm"
                          variant="danger-soft"
                          onClick={() => {
                            if (demo) signOutDemo();
                            else void auth.signOut();
                          }}
                        >
                          <LogOut data-icon="inline-start" />
                          {m.nav_sign_out()}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </SettingsSection>
        {auth.authMode !== "off" && (
          <SecuritySection passwordOpen={passwordOpen} onPasswordOpenChange={setPasswordOpen} />
        )}
      </div>
    </ListPage>
  );
}
