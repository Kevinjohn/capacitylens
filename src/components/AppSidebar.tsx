import { EyeIcon } from "lucide-react";
import { matchPath, NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../auth/authContext";
import { usePermissionStatus, useRole } from "../auth/permissionContext";
import { useOfflineState } from "../data/useOfflineState";
import { accessLabelFor } from "../lib/accessCopy";
import { accessExperienceFor } from "../lib/accessMode";
import type { NavLinkDef } from "../lib/navLinks";
import { ImportExport } from "./ImportExport";
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
  demoAuthActive: boolean;
  navLinks: NavLinkDef[];
  onSignOut: () => void;
  onSwitchAccount: () => void;
  open: boolean;
}

/** CapacityLens navigation composed from the standard ShadCN Sidebar primitives. */
export function AppSidebar({
  activeAccount,
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

  // Vertical density ("Compact view" device pref, default OFF = roomier). Published as CSS custom
  // properties on the sidebar root rather than threaded as props: the nav is assembled from several
  // components (this file plus ImportExport's "Data" group), and the rules below key off the shadcn
  // primitives' own `data-slot` hooks, so every menu inside the sidebar picks the rhythm up without
  // each one having to read the store. Only GAPS and PADDING move — item height is untouched, so the
  // collapsed icon rail (which pins each button square) is unaffected. See src/index.css.
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
        <nav>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {navLinks.map(([to, label, NavIcon]) => {
                  const text = label();
                  const isActive = matchPath({ path: to, end: to === "/" }, pathname) !== null;
                  return (
                    <SidebarMenuItem key={to}>
                      <SidebarMenuButton asChild isActive={isActive} tooltip={text}>
                        <NavLink
                          to={to}
                          end={to === "/"}
                          data-nav={to}
                          onClick={() => {
                            if (isMobile) setOpenMobile(false);
                          }}
                        >
                          <NavIcon aria-hidden="true" focusable="false" />
                          <span>{text}</span>
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </nav>

        <SidebarSeparator />
        <ImportExport />
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
            {demoAuthActive && (
              <SidebarMenuItem>
                <SidebarMenuButton size="sm" onClick={onSignOut}>
                  {m.nav_sign_out()}
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        </SidebarFooter>
      )}

      <SidebarRail aria-hidden="true" />
    </Sidebar>
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
