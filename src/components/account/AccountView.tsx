import { useAuth } from "@/auth/authContext";
import demoAvatarUrl from "@/assets/avatar-demo.svg";
import { m } from "@/i18n";
import { FAKE_USER, useDemoAuthActive } from "@/lib/fakeAuth";
import { DEFAULT_COLORS } from "@/lib/palette";
import { Avatar, ListPage } from "../common/ui";
import { SecuritySection } from "../settings/SecuritySection";
import { SettingsSection } from "../settings/SettingsSection";
import { Badge } from "../ui/badge";

function resolveIdentity(auth: ReturnType<typeof useAuth>, demo: boolean) {
  const identity = demo ? FAKE_USER : auth.user;
  return {
    name: identity?.name ?? identity?.email ?? m.account_local_identity(),
    email: identity?.email,
    imageUrl: demo ? demoAvatarUrl : (auth.user?.image ?? undefined),
  };
}

function resolveAccess(authMode: ReturnType<typeof useAuth>["authMode"], demo: boolean): string {
  if (demo) return m.account_demo_access();
  if (authMode === "off") return m.account_auth_off();
  return m.account_signed_in();
}

export function AccountView() {
  const auth = useAuth();
  const demo = useDemoAuthActive();
  const { name, email, imageUrl } = resolveIdentity(auth, demo);
  const access = resolveAccess(auth.authMode, demo);

  return (
    <ListPage title={m.account_title()}>
      <div className="flex flex-col gap-6">
        <SettingsSection title={m.account_identity_title()} help={m.account_identity_help()}>
          <div className="flex items-center gap-3">
            <Avatar name={name} color={DEFAULT_COLORS.account} {...(imageUrl ? { imageUrl } : {})} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">{name}</p>
              {email && email !== name && <p className="truncate text-sm text-muted-foreground">{email}</p>}
              <Badge variant="outline" className="mt-1">
                {access}
              </Badge>
            </div>
          </div>
        </SettingsSection>
        {auth.authMode !== "off" && <SecuritySection />}
      </div>
    </ListPage>
  );
}
