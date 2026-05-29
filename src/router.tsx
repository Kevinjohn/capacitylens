import { createBrowserRouter } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { SchedulerView } from './components/scheduler/SchedulerView'
import { ResourceList } from './components/resources/ResourceList'
import { DisciplineList } from './components/disciplines/DisciplineList'
import { ClientList } from './components/clients/ClientList'
import { ProjectList } from './components/projects/ProjectList'
import { TaskList } from './components/tasks/TaskList'
import { TimeOffList } from './components/timeoff/TimeOffList'

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
    ],
  },
])
