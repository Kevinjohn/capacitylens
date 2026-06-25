/* eslint-disable react-refresh/only-export-components -- route config, not a component module */
import { lazy } from 'react'
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
])
