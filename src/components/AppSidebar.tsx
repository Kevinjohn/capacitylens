import { EyeIcon } from "lucide-react";
import { matchPath, NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../auth/authContext";
import { usePermissionStatus, useRole } from "../auth/permissionContext";
import { useOfflineState } from "../data/useOfflineState";
import { resolveAccessLabel } from "../lib/accessCopy";
import { resolveAccessExperience } from "../lib/resolveAccessExperience";
import { FAKE_USER } from "../lib/fakeAuth";
import demoAvatarUrl from "../assets/avatar-demo.svg";
import { DEFAULT_COLORS } from "../lib/palette";
import { Avatar } from "./common/ui";
import { ACCOUNT_LINK, type NavigationLinkDefinition } from "../lib/navLinks";
import { Badge } from "./ui/badge";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "./ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { m } from "@/i18n";
import { buildSchedulerDensity } from "./scheduler/layout";
import { useStore } from "../store/useStore";
import type React from "react";
import { APP_NAME } from "@capacitylens/shared/brand";

interface AppSidebarProps {
  activeAccount: { name: string } | undefined;
  /** Administration destinations pinned to the bottom of the nav (Team & access, Settings). */
  adminLinks: NavigationLinkDefinition[];
  demoAuthActive: boolean;
  navLinks: NavigationLinkDefinition[];
  onSignOut: () => void;
  onSwitchAccount: () => void;
  open: boolean;
}

/** CapacityLens navigation composed from the standard ShadCN Sidebar primitives. */
export function AppSidebar({
  activeAccount,
  adminLinks,
  demoAuthActive,
  navLinks,
  onSignOut,
  onSwitchAccount,
  open,
}: AppSidebarProps) {
  const { pathname } = useLocation();
  const { isMobile, openMobile, setOpenMobile } = useSidebar();
  const expanded = isMobile ? openMobile : open;
  const compactView = useStore((state) => state.compactView);
  const toggleLabel = expanded ? m.nav_collapse_menu() : m.nav_expand_menu();
  // On mobile the sidebar is an overlay sheet; following a link must dismiss it or the destination
  // stays hidden behind the nav. On desktop the sidebar is persistent, so this is a no-op.
  const closeOnMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  // Vertical density ("Compact view" device pref, default OFF = roomier). Published as CSS custom
  // properties on the sidebar root rather than threaded as props: the nav is assembled from several
  // groups (the primary destinations, the pinned admin group, the account footer), and the rules
  // below key off the shadcn primitives' own `data-slot` hooks, so every menu inside the sidebar
  // picks the rhythm up without each one having to read the store. Only GAPS and PADDING move — item
  // height is untouched, so the collapsed icon rail (which pins each button square) is unaffected.
  // See src/index.css.
  const density = buildSchedulerDensity({ compact: compactView });

  return (
    <Sidebar
      collapsible="icon"
      data-testid="app-sidebar"
      style={
        {
          "--nav-menu-gap-y": `${density.navMenuGapY}px`,
          "--nav-section-pad-y": `${density.navSectionPadY}px`,
          "--nav-section-gap-y": `${density.navSectionGapY}px`,
        } as React.CSSProperties
      }
    >
      <SidebarHeaderContent expanded={expanded} toggleLabel={toggleLabel} />
      <SidebarNavigation navLinks={navLinks} adminLinks={adminLinks} pathname={pathname} onNavigate={closeOnMobile} />
      <SidebarAccountFooter
        activeAccount={activeAccount}
        demoAuthActive={demoAuthActive}
        onSignOut={onSignOut}
        onSwitchAccount={onSwitchAccount}
        onNavigate={closeOnMobile}
        pathname={pathname}
      />

      <SidebarRail aria-hidden="true" />
    </Sidebar>
  );
}

function SidebarHeaderContent({ expanded, toggleLabel }: { expanded: boolean; toggleLabel: string }) {
  return (
    <SidebarHeader className="flex-row items-center">
      <Tooltip>
        <TooltipTrigger asChild>
          <SidebarTrigger aria-expanded={expanded} aria-label={toggleLabel} />
        </TooltipTrigger>
        <TooltipContent>{toggleLabel}</TooltipContent>
      </Tooltip>
      <div
        data-visual-intent="brand"
        className="truncate text-xl font-bold text-sidebar-foreground group-data-[collapsible=icon]:hidden"
      >
        {APP_NAME}
      </div>
    </SidebarHeader>
  );
}

function SidebarNavigation({
  navLinks,
  adminLinks,
  pathname,
  onNavigate,
}: {
  navLinks: NavigationLinkDefinition[];
  adminLinks: NavigationLinkDefinition[];
  pathname: string;
  onNavigate: () => void;
}) {
  return (
    <SidebarContent>
      {/* ONE <nav> landmark around both groups. The admin group is a separate visual block (issues
          #169/#172) but the same navigation region, so screen-reader users still hear a single
          "Navigation" landmark rather than two competing ones. `mt-auto` pushes it to the bottom of
          the scroll area whenever the primary list is shorter than the viewport. */}
      <nav className="flex flex-1 flex-col">
        <SidebarGroup>
          <SidebarGroupContent>
            <NavMenu links={navLinks} pathname={pathname} onNavigate={onNavigate} />
          </SidebarGroupContent>
        </SidebarGroup>

        {adminLinks.length > 0 && (
          <SidebarGroup className="mt-auto">
            <SidebarSeparator className="mx-0 mb-1" />
            <SidebarGroupContent>
              <NavMenu links={adminLinks} pathname={pathname} onNavigate={onNavigate} />
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </nav>
    </SidebarContent>
  );
}

function SidebarAccountFooter({
  activeAccount,
  demoAuthActive,
  onSignOut,
  onSwitchAccount,
  onNavigate,
  pathname,
}: {
  activeAccount: AppSidebarProps["activeAccount"];
  demoAuthActive: boolean;
  onSignOut: () => void;
  onSwitchAccount: () => void;
  onNavigate: () => void;
  pathname: string;
}) {
  return (
    <SidebarFooter>
      {activeAccount && (
        <div className="group-data-[collapsible=icon]:hidden">
          <SidebarSeparator className="mx-0" />
          <div className="min-w-0 px-2">
            <div className="truncate text-sm font-semibold" title={activeAccount.name}>
              {activeAccount.name}
            </div>
            <ActiveRoleBadge />
          </div>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="sm" onClick={onSwitchAccount}>
                {m.nav_switch_company()}
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </div>
      )}
      <SidebarMenu>
        <SessionMenuItem
          demoAuthActive={demoAuthActive}
          onNavigate={onNavigate}
          onSignOutDemo={onSignOut}
          pathname={pathname}
        />
      </SidebarMenu>
    </SidebarFooter>
  );
}

/** One menu of nav destinations. Shared by the primary list and the pinned admin group so both
 *  render identical markup — same active matching, same `data-nav` tour anchor, same collapsed-rail
 *  tooltip — and can never drift apart. */
function NavMenu({
  links,
  onNavigate,
  pathname,
}: {
  links: NavigationLinkDefinition[];
  onNavigate: () => void;
  pathname: string;
}) {
  return (
    <SidebarMenu>
      {links.map(({ to, label, icon: NavIcon }) => {
        const text = label();
        const isActive = matchPath({ path: to, end: to === "/" }, pathname) !== null;
        return (
          <SidebarMenuItem key={to}>
            <SidebarMenuButton asChild isActive={isActive} tooltip={text}>
              <NavLink to={to} end={to === "/"} data-nav={to} onClick={onNavigate}>
                <NavIcon aria-hidden="true" focusable="false" />
                <span>{text}</span>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

/**
 * The personal Account destination plus signed-in identity/sign-out controls at the very bottom
 * of the nav (issue #169).
 *
 * Two identities can be signed in here and they never overlap: the COSMETIC demo persona
 * (`demoAuthActive` — real auth is off, see fakeAuth.ts) and a REAL Better Auth session
 * (`authMode !== "off"`). The Account destination remains available for an auth-off local identity;
 * the sign-out control appears only for the demo persona or a real session. It always reads
 * "Sign out" rather than toggling to "Sign in": the entry gate (AppEntryGate / LoginScreen) means
 * the shell only renders after demo sign-in or a real session has passed its outer gate.
 */
function SessionMenuItem({
  demoAuthActive,
  onNavigate,
  onSignOutDemo,
  pathname,
}: {
  demoAuthActive: boolean;
  onNavigate: () => void;
  onSignOutDemo: () => void;
  pathname: string;
}) {
  const { authMode, signOut, user } = useAuth();
  const AccountIcon = ACCOUNT_LINK.icon;
  const showSignOut = demoAuthActive || authMode !== "off";

  let name: string = FAKE_USER.name;
  let imageUrl: string | undefined = demoAvatarUrl;
  let onSignOut = onSignOutDemo;
  if (!demoAuthActive) {
    name = user?.name ?? user?.email ?? m.settings_signed_in_unknown();
    imageUrl = user?.image ?? undefined;
    onSignOut = () => void signOut();
  }

  return (
    <>
      <SidebarMenuItem>
        <SidebarMenuButton
          asChild
          size="sm"
          isActive={matchPath({ path: ACCOUNT_LINK.to, end: true }, pathname) !== null}
          tooltip={ACCOUNT_LINK.label()}
        >
          <NavLink to={ACCOUNT_LINK.to} onClick={onNavigate}>
            <AccountIcon aria-hidden="true" focusable="false" />
            <span>{ACCOUNT_LINK.label()}</span>
          </NavLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
      {showSignOut && (
        <SidebarMenuItem className="group-data-[collapsible=icon]:hidden">
          <SidebarMenuButton
            size="sm"
            data-testid="nav-sign-out"
            title={m.nav_signed_in_as({ who: name })}
            onClick={onSignOut}
          >
            <Avatar name={name} color={DEFAULT_COLORS.account} size={20} {...(imageUrl ? { imageUrl } : {})} />
            <span className="truncate">{m.nav_sign_out()}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      )}
    </>
  );
}

/** Resolves the current account role from inside PermissionProvider. */
function ActiveRoleBadge() {
  const role = useRole();
  const permissionStatus = usePermissionStatus();
  const { authMode } = useAuth();
  const offline = useOfflineState();
  const accessExperience = resolveAccessExperience(authMode);
  const resolvedRole = accessExperience === "authenticated" && permissionStatus === "resolved" ? role : null;
  const label = resolveAccessLabel({
    offlineReadOnly: offline.readOnly,
    experience: accessExperience,
    permissionStatus,
    role: resolvedRole,
  });
  const viewOnly = offline.readOnly || resolvedRole === "viewer";
  let roleContent: React.ReactNode = label;
  if (offline.readOnly) {
    roleContent = <span data-testid="view-only">{label}</span>;
  } else if (resolvedRole === "viewer") {
    roleContent = (
      <>
        {label} · <span data-testid="view-only">{m.nav_view_only()}</span>
      </>
    );
  }

  return (
    <Badge
      data-testid="active-role"
      variant="outline"
      className="mt-1 text-2xs text-(--chrome-sidebar-muted-ink)"
      title={viewOnly ? m.nav_view_only_title() : undefined}
    >
      {viewOnly && <EyeIcon aria-hidden="true" focusable="false" />}
      {roleContent}
    </Badge>
  );
}
