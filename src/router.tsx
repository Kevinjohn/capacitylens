/* eslint-disable react-refresh/only-export-components -- route config, not a component module */
import { lazy } from 'react'
import { createBrowserRouter } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { SchedulerView } from './components/scheduler/SchedulerView'

// The scheduler is the index route (first paint) so it stays eager. The CRUD list
// pages are split out — not needed until navigated to, which trims the initial
// bundle. AppShell wraps <Outlet> in a Suspense boundary for these lazy chunks.
const ResourceList = lazy(() => import('./components/resources/ResourceList').then((m) => ({ default: m.ResourceList })))
const DisciplineList = lazy(() => import('./components/disciplines/DisciplineList').then((m) => ({ default: m.DisciplineList })))
const ClientList = lazy(() => import('./components/clients/ClientList').then((m) => ({ default: m.ClientList })))
const ProjectList = lazy(() => import('./components/projects/ProjectList').then((m) => ({ default: m.ProjectList })))
const TaskList = lazy(() => import('./components/tasks/TaskList').then((m) => ({ default: m.TaskList })))
const TimeOffList = lazy(() => import('./components/timeoff/TimeOffList').then((m) => ({ default: m.TimeOffList })))
const SettingsView = lazy(() => import('./components/settings/SettingsView').then((m) => ({ default: m.SettingsView })))

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <SchedulerView /> },
      { path: 'resources', element: <ResourceList /> },
      { path: 'disciplines', element: <DisciplineList /> },
      { path: 'clients', element: <ClientList /> },
      { path: 'projects', element: <ProjectList /> },
      { path: 'tasks', element: <TaskList /> },
      { path: 'timeoff', element: <TimeOffList /> },
      { path: 'settings', element: <SettingsView /> },
    ],
  },
])
