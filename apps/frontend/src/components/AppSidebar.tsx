import { matchPath, NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '@/auth/authContext'
import { DEFAULT_COLORS } from '@/lib/palette'
import { Avatar } from './common/ui'
import { ACCOUNT_LINK, HELP_LINK } from '@/lib/navLinks'
import { ROUTE_DIAGNOSTICS } from '@/lib/tourAnchors'
import type { NavigationLinkDefinition } from '@/lib/navLinks'
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
} from './ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { m } from '@/i18n'
import { CHROME_SPACING } from './scheduler/layout'
import type React from 'react'
import { APP_NAME } from '@capacitylens/shared/brand'

interface AppSidebarProps {
  adminLinks: NavigationLinkDefinition[]
  navLinks: NavigationLinkDefinition[]
  open: boolean
}

/** CapacityLens navigation composed from the standard ShadCN Sidebar primitives. */
export function AppSidebar({ adminLinks, navLinks, open }: AppSidebarProps) {
  const { pathname } = useLocation()
  const { isMobile, openMobile, setOpenMobile } = useSidebar()
  const expanded = isMobile ? openMobile : open
  const toggleLabel = expanded ? m.nav_collapse_menu() : m.nav_expand_menu()
  // On mobile the sidebar is an overlay sheet; following a link must dismiss it or the destination
  // stays hidden behind the nav. On desktop the sidebar is persistent, so this is a no-op.
  const closeOnMobile = () => {
    if (isMobile) setOpenMobile(false)
  }

  // Sidebar spacing flows through shared CSS variables so menu groups use one rhythm while icon-rail buttons retain square geometry.
  const spacing = CHROME_SPACING

  return (
    <Sidebar
      collapsible="icon"
      data-testid="app-sidebar"
      style={
        {
          '--nav-menu-gap-y': `${spacing.navMenuGapY}px`,
          '--nav-section-pad-y': `${spacing.navSectionPadY}px`,
          '--nav-section-gap-y': `${spacing.navSectionGapY}px`,
        } as React.CSSProperties
      }
    >
      <SidebarHeaderContent expanded={expanded} toggleLabel={toggleLabel} />
      <SidebarNavigation
        navLinks={navLinks}
        adminLinks={adminLinks}
        pathname={pathname}
        onNavigate={closeOnMobile}
      />
      <SidebarAccountFooter onNavigate={closeOnMobile} pathname={pathname} />

      <SidebarRail aria-hidden="true" />
    </Sidebar>
  )
}

function SidebarHeaderContent({
  expanded,
  toggleLabel,
}: {
  expanded: boolean
  toggleLabel: string
}) {
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
  )
}

function SidebarNavigation({
  navLinks,
  adminLinks,
  pathname,
  onNavigate,
}: {
  navLinks: NavigationLinkDefinition[]
  adminLinks: NavigationLinkDefinition[]
  pathname: string
  onNavigate: () => void
}) {
  return (
    <SidebarContent>
      {/* One <nav> landmark around both groups. The admin group is a separate visual block
          but the same navigation region, so screen-reader users still hear a single
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
  )
}

function SidebarAccountFooter({
  onNavigate,
  pathname,
}: {
  onNavigate: () => void
  pathname: string
}) {
  return (
    <SidebarFooter>
      <SidebarSeparator className="mx-0" />
      <SidebarMenu>
        <HelpMenuItem onNavigate={onNavigate} pathname={pathname} />
        <SessionMenuItem onNavigate={onNavigate} pathname={pathname} />
      </SidebarMenu>
    </SidebarFooter>
  )
}

function HelpMenuItem({ onNavigate, pathname }: { onNavigate: () => void; pathname: string }) {
  const HelpIcon = HELP_LINK.icon
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        size="sm"
        isActive={
          matchPath({ path: HELP_LINK.to, end: true }, pathname) !== null ||
          matchPath({ path: ROUTE_DIAGNOSTICS, end: true }, pathname) !== null
        }
        tooltip={HELP_LINK.label()}
      >
        <NavLink to={HELP_LINK.to} onClick={onNavigate}>
          <HelpIcon aria-hidden="true" focusable="false" />
          <span>{HELP_LINK.label()}</span>
        </NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

// Share destination markup so primary and administration links keep matching and tour anchors consistent.
function NavMenu({
  links,
  onNavigate,
  pathname,
}: {
  links: NavigationLinkDefinition[]
  onNavigate: () => void
  pathname: string
}) {
  return (
    <SidebarMenu>
      {links.map(({ to, label, icon: NavIcon }) => {
        const text = label()
        const isActive = matchPath({ path: to, end: to === '/' }, pathname) !== null
        return (
          <SidebarMenuItem key={to}>
            <SidebarMenuButton asChild isActive={isActive} tooltip={text}>
              <NavLink to={to} end={to === '/'} data-nav={to} onClick={onNavigate}>
                <NavIcon aria-hidden="true" focusable="false" />
                <span>{text}</span>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )
      })}
    </SidebarMenu>
  )
}

function SessionMenuItem({ onNavigate, pathname }: { onNavigate: () => void; pathname: string }) {
  const { user } = useAuth()

  const name = user?.name ?? user?.email ?? m.settings_signed_in_unknown()
  const imageUrl = user?.image ?? undefined

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        size="sm"
        isActive={matchPath({ path: ACCOUNT_LINK.to, end: true }, pathname) !== null}
        tooltip={ACCOUNT_LINK.label()}
      >
        <NavLink
          to={ACCOUNT_LINK.to}
          onClick={onNavigate}
          title={m.nav_signed_in_as({ who: name })}
        >
          <Avatar
            name={name}
            color={DEFAULT_COLORS.account}
            size={20}
            {...(imageUrl ? { imageUrl } : {})}
          />
          <span>{ACCOUNT_LINK.label()}</span>
        </NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
