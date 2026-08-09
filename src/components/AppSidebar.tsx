import { EyeIcon } from "lucide-react";
import { matchPath, NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../auth/authContext";
import { usePermissionStatus, useRole } from "../auth/permissionContext";
import { useOfflineState } from "../data/useOfflineState";
import { accessLabelFor } from "../lib/accessCopy";
import { accessExperienceFor } from "../lib/accessMode";
import { FAKE_USER } from "../lib/fakeAuth";
import demoAvatarUrl from "../assets/avatar-demo.svg";
import { DEFAULT_COLORS } from "../lib/palette";
import { Avatar } from "./common/ui";
import type { NavLinkDef } from "../lib/navLinks";
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
import { schedulerDensity } from "./scheduler/layout";
import { useStore } from "../store/useStore";
import type React from "react";
import { APP_NAME } from "@capacitylens/shared/brand";

interface AppSidebarProps {
  activeAccount: { name: string } | null;
  /** Administration destinations pinned to the bottom of the nav (Team & access, Settings). */
  adminLinks: NavLinkDef[];
  demoAuthActive: boolean;
  navLinks: NavLinkDef[];
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
  const compactView = useStore((s) => s.compactView);
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
  const density = schedulerDensity(compactView);

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
      <SidebarHeader className="flex-row items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <SidebarTrigger aria-expanded={expanded} aria-label={toggleLabel} />
          </TooltipTrigger>
          <TooltipContent>{toggleLabel}</TooltipContent>
        </Tooltip>
        <div
          data-visual-intent="brand"
          className="truncate text-xl font-bold text-brand group-data-[collapsible=icon]:hidden"
        >
          {APP_NAME}
        </div>
      </SidebarHeader>

      <SidebarContent>
        {/* ONE <nav> landmark around both groups. The admin group is a separate visual block (issues
            #169/#172) but the same navigation region, so screen-reader users still hear a single
            "Navigation" landmark rather than two competing ones. `mt-auto` pushes it to the bottom of
            the scroll area whenever the primary list is shorter than the viewport. */}
        <nav className="flex flex-1 flex-col">
          <SidebarGroup>
            <SidebarGroupContent>
              <NavMenu links={navLinks} pathname={pathname} onNavigate={closeOnMobile} />
            </SidebarGroupContent>
          </SidebarGroup>

          {adminLinks.length > 0 && (
            <SidebarGroup className="mt-auto">
              <SidebarSeparator className="mx-0 mb-1" />
              <SidebarGroupContent>
                <NavMenu links={adminLinks} pathname={pathname} onNavigate={closeOnMobile} />
              </SidebarGroupContent>
            </SidebarGroup>
          )}
        </nav>
      </SidebarContent>

      {activeAccount && (
        <SidebarFooter className="group-data-[collapsible=icon]:hidden">
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
            <SessionMenuItem demoAuthActive={demoAuthActive} onSignOutDemo={onSignOut} />
          </SidebarMenu>
        </SidebarFooter>
      )}

      <SidebarRail aria-hidden="true" />
    </Sidebar>
  );
}

/** One menu of nav destinations. Shared by the primary list and the pinned admin group so both
 *  render identical markup — same active matching, same `data-nav` tour anchor, same collapsed-rail
 *  tooltip — and can never drift apart. */
function NavMenu({ links, onNavigate, pathname }: { links: NavLinkDef[]; onNavigate: () => void; pathname: string }) {
  return (
    <SidebarMenu>
      {links.map(([to, label, NavIcon]) => {
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
 * The signed-in identity + sign-out control at the very bottom of the nav (issue #169).
 *
 * Two identities can be signed in here and they never overlap: the COSMETIC demo persona
 * (`demoAuthActive` — real auth is off, see fakeAuth.ts) and a REAL Better Auth session
 * (`authMode !== "off"`). An auth-off server with no demo build has neither, and renders nothing —
 * exactly as before. The control always reads "Sign out" rather than toggling to "Sign in": the
 * entry gate (AppEntryGate / LoginScreen) means the shell — and therefore this footer — only ever
 * renders for someone already signed in, so offering "Sign in" here would be a dead affordance.
 */
function SessionMenuItem({ demoAuthActive, onSignOutDemo }: { demoAuthActive: boolean; onSignOutDemo: () => void }) {
  const { authMode, signOut, user } = useAuth();
  if (!demoAuthActive && authMode === "off") return null;

  const name = demoAuthActive ? FAKE_USER.name : (user?.name ?? user?.email ?? m.settings_signed_in_unknown());
  const imageUrl = demoAuthActive ? demoAvatarUrl : (user?.image ?? undefined);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="sm"
        data-testid="nav-sign-out"
        title={m.nav_signed_in_as({ who: name })}
        onClick={demoAuthActive ? onSignOutDemo : () => void signOut()}
      >
        <Avatar name={name} color={DEFAULT_COLORS.account} size={20} imageUrl={imageUrl} />
        <span className="truncate">{m.nav_sign_out()}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/** Resolves the current account role from inside PermissionProvider. */
function ActiveRoleBadge() {
  const role = useRole();
  const permissionStatus = usePermissionStatus();
  const { authMode } = useAuth();
  const offline = useOfflineState();
  const accessExperience = accessExperienceFor(authMode);
  const resolvedRole = accessExperience === "authenticated" && permissionStatus === "resolved" ? role : null;
  const label = accessLabelFor({
    offlineReadOnly: offline.readOnly,
    experience: accessExperience,
    permissionStatus,
    role: resolvedRole,
  });
  const viewOnly = offline.readOnly || resolvedRole === "viewer";

  return (
    <Badge
      data-testid="active-role"
      variant="outline"
      className="mt-1 text-2xs text-muted-foreground"
      title={viewOnly ? m.nav_view_only_title() : undefined}
    >
      {viewOnly && <EyeIcon aria-hidden="true" focusable="false" />}
      {offline.readOnly ? (
        <span data-testid="view-only">{label}</span>
      ) : resolvedRole === "viewer" ? (
        <>
          {label} · <span data-testid="view-only">{m.nav_view_only()}</span>
        </>
      ) : (
        label
      )}
    </Badge>
  );
}
