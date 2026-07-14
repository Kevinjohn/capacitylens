/* eslint-disable react-refresh/only-export-components -- route config, not a component module */
import { lazy, Suspense } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { SchedulerView } from './components/scheduler/SchedulerView'
import { RouteError } from './components/common/ErrorBoundary'
import { useStore } from './store/useStore'
import { disciplinesEnabledFor } from './store/selectors'

// The scheduler is the index route (first paint) so it stays eager. The CRUD list
// pages are split out — not needed until navigated to, which trims the initial
// bundle. AppShell wraps <Outlet> in a Suspense boundary for these lazy chunks.
const ResourceList = lazy(() => import('./components/resources/ResourceList').then((m) => ({ default: m.ResourceList })))
const DisciplineList = lazy(() => import('./components/disciplines/DisciplineList').then((m) => ({ default: m.DisciplineList })))
const ClientList = lazy(() => import('./components/clients/ClientList').then((m) => ({ default: m.ClientList })))
const ProjectList = lazy(() => import('./components/projects/ProjectList').then((m) => ({ default: m.ProjectList })))
const ActivityList = lazy(() => import('./components/activities/ActivityList').then((m) => ({ default: m.ActivityList })))
const TimeOffList = lazy(() => import('./components/timeoff/TimeOffList').then((m) => ({ default: m.TimeOffList })))
const SettingsView = lazy(() => import('./components/settings/SettingsView').then((m) => ({ default: m.SettingsView })))
// Invite accept (P1.9): its own top-level route, OUTSIDE AppShell's tenant/account gate so the
// accept POST fires immediately rather than being intercepted by the AccountPicker — but still
// inside AuthProvider (which wraps the whole router in main.tsx), so an UNAUTHENTICATED visit to
// /invite/:token shows the LoginScreen first; on sign-in AuthProvider reloads onto the SAME URL and
// this page renders, so the token survives the auth wall. Lazy, like LoginScreen, so the default OFF
// bundle is unaffected (the chunk loads only when an invite link is actually opened).
const InviteAccept = lazy(() => import('./components/invites/InviteAccept').then((m) => ({ default: m.InviteAccept })))
// Password reset (P1.18): like InviteAccept, its own top-level route outside AppShell — but unlike
// an invite it must render for a visitor with NO session (they're locked out; that's the point), so
// AuthProvider carves /reset-password/ out of the login wall (see the status 'login' branch there).
// Lazy for the same bundle reason: the chunk loads only when a reset link is actually opened.
const ResetPassword = lazy(() => import('./auth/ResetPassword').then((m) => ({ default: m.ResetPassword })))

// Disciplines is an optional feature (account.disciplinesEnabled). When off, the nav
// entry is hidden — guard the route too so a direct URL / bookmark can't reach the page.
function DisciplineRoute() {
  const enabled = useStore((s) => disciplinesEnabledFor(s.data, s.activeAccountId))
  return enabled ? <DisciplineList /> : <Navigate to="/" replace />
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    // A render error in AppShell or ANY child route bubbles to this boundary and shows
    // the branded recovery screen — otherwise the data router renders its bland default.
    errorElement: <RouteError />,
    children: [
      { index: true, element: <SchedulerView /> },
      { path: 'resources', element: <ResourceList /> },
      // External / 3rd parties moved into the Resources tab (behind the per-account
      // `externalEnabled` setting). Keep the old path so saved bookmarks don't 404 — redirect
      // it to /resources rather than leaving a dangling lazy chunk.
      { path: 'external', element: <Navigate to="/resources" replace /> },
      { path: 'disciplines', element: <DisciplineRoute /> },
      { path: 'clients', element: <ClientList /> },
      { path: 'projects', element: <ProjectList /> },
      { path: 'activities', element: <ActivityList /> },
      { path: 'timeoff', element: <TimeOffList /> },
      { path: 'settings', element: <SettingsView /> },
    ],
  },
  {
    // Invite accept (P1.9). DELIBERATELY a sibling of the AppShell route, NOT a child: AppShell's
    // tenant gate would otherwise show the AccountPicker before this page ever ran. It carries its
    // own errorElement + Suspense boundary (AppShell provides those only for ITS children). The
    // surrounding AuthProvider (main.tsx) still walls an unauthenticated visit behind the login.
    path: '/invite/:token',
    errorElement: <RouteError />,
    element: (
      <Suspense fallback={null}>
        <InviteAccept />
      </Suspense>
    ),
  },
  {
    // Password reset (P1.18). A sibling of AppShell for the same reason as /invite (no tenant gate),
    // with its own errorElement + Suspense. AuthProvider additionally lets this path through the
    // login wall — the visitor redeeming a reset link is exactly the person who cannot sign in.
    path: '/reset-password/:token',
    errorElement: <RouteError />,
    element: (
      <Suspense fallback={null}>
        <ResetPassword />
      </Suspense>
    ),
  },
])
