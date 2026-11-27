import { m } from '@/i18n'
import type { Client, Project } from '@capacitylens/shared/types/entities'
import type { Option } from './fields/fieldTypes'

/** Formats a project's dropdown label as `Client / Project`, or the project name alone without a client. */
export function formatProjectLabel(projectName: string, clientName: string | undefined): string {
  return clientName ? `${clientName} / ${projectName}` : projectName
}

/** The lists and current selection a record's project dropdown is built from. */
export interface ProjectOptionsInput {
  /** Active projects offered for selection. */
  projects: Project[]
  /** Active clients used to label the active projects. */
  clients: Client[]
  /** Every project, including archived ones, used to label an archived current project. */
  rawProjects: Project[]
  /** Every client, including archived ones, used to label an archived current project. */
  rawClients: Client[]
  /** The record's current project, kept as a disabled option when it is no longer active. */
  currentProjectId: string | null | undefined
}

/** Builds the project dropdown: active projects, plus a disabled entry for a current project that is archived or missing. */
export function buildProjectOptions({
  projects,
  clients,
  rawProjects,
  rawClients,
  currentProjectId,
}: ProjectOptionsInput): Option[] {
  const options = projects.map((project) => {
    const client = clients.find((candidate) => candidate.id === project.clientId)
    return { value: project.id, label: formatProjectLabel(project.name, client?.name) }
  })
  if (!currentProjectId || projects.some((project) => project.id === currentProjectId)) {
    return options
  }

  const rawProject = rawProjects.find((project) => project.id === currentProjectId)
  const rawClient = rawProject && rawClients.find((client) => client.id === rawProject.clientId)
  return [
    ...options,
    {
      value: currentProjectId,
      label: rawProject
        ? m.list_label_archived({ name: formatProjectLabel(rawProject.name, rawClient?.name) })
        : m.form_option_current_archived(),
      disabled: true,
    },
  ]
}
