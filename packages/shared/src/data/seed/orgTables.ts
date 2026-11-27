import { NULLABLE_FIELDS } from '../../types/nullableFields.js'
import type { AppData } from '../../types/entities.js'
import { buildDefaultCompanyWorkingDays } from '../../lib/companyWorkingDays.js'
import { buildInternalClient } from '../internalClient.js'
import { SEED_TIMESTAMP, STUDIO, LOFT } from './constants.js'

type OrgTables = Pick<AppData, 'companies' | 'disciplines' | 'clients' | 'projects' | 'phases'>

const ORG_TABLES: OrgTables = {
  companies: [
    {
      ...NULLABLE_FIELDS.companies,
      id: STUDIO,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
      name: 'Wayne Enterprises',
      color: '#2d75da',
      workingDays: buildDefaultCompanyWorkingDays(),
    },
    {
      ...NULLABLE_FIELDS.companies,
      id: LOFT,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
      name: 'Stark Industries',
      color: '#2d75da',
      workingDays: buildDefaultCompanyWorkingDays(),
    },
  ],
  disciplines: [
    {
      id: 'd-design',
      companyId: STUDIO,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
      name: 'Design',
      color: '#2d75da',
      sortOrder: 0,
    },
    {
      id: 'd-dev',
      companyId: STUDIO,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
      name: 'Development',
      color: '#3ace6b',
      sortOrder: 1,
    },
    {
      id: 'd-copy',
      companyId: STUDIO,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
      name: 'Copywriting',
      color: '#ed841b',
      sortOrder: 2,
    },
    {
      id: 'd-loft-design',
      companyId: LOFT,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
      name: 'Design',
      color: '#2d75da',
      sortOrder: 0,
    },
  ],
  clients: [
    // One built-in "Internal" pseudo-client per company (builtin: true), owns project-less
    // internal/all-projects work and can own real projects. Protected (no rename/delete). See
    // internalClient.ts; the invariant is also enforced by imports and company setup.
    buildInternalClient(STUDIO, SEED_TIMESTAMP, 'c-internal-studio'),
    buildInternalClient(LOFT, SEED_TIMESTAMP, 'c-internal-loft'),
    {
      ...NULLABLE_FIELDS.clients,
      id: 'c-acme',
      companyId: STUDIO,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
      name: 'Queen Consolidated',
      color: '#e02727',
    },
    {
      ...NULLABLE_FIELDS.clients,
      id: 'c-globex',
      companyId: STUDIO,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
      name: 'LexCorp',
      color: '#2d75da',
    },
    {
      ...NULLABLE_FIELDS.clients,
      id: 'c-loft-northwind',
      companyId: LOFT,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
      name: 'Rand Corporation',
      color: '#34c7d4',
    },
  ],
  projects: [
    {
      ...NULLABLE_FIELDS.projects,
      id: 'p-acme',
      companyId: STUDIO,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
      name: 'Project Watchtower',
      clientId: 'c-acme',
      color: '#da2d92',
    },
    {
      ...NULLABLE_FIELDS.projects,
      id: 'p-brand',
      companyId: STUDIO,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
      name: 'Metropolis Rebrand',
      clientId: 'c-globex',
      color: '#34c7d4',
    },
    {
      ...NULLABLE_FIELDS.projects,
      id: 'p-loft-app',
      companyId: LOFT,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
      name: 'Rand Mobile App',
      clientId: 'c-loft-northwind',
      color: '#2d75da',
    },
  ],
  phases: [
    {
      id: 'ph-disc',
      companyId: STUDIO,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
      name: 'Discovery',
      projectId: 'p-acme',
    },
    {
      id: 'ph-build',
      companyId: STUDIO,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
      name: 'Build',
      projectId: 'p-acme',
    },
  ],
}

/** Fresh copies of the seed companies, disciplines, clients, projects and phases. */
export function createOrgTables(): OrgTables {
  return {
    companies: ORG_TABLES.companies.map((company) => ({
      ...company,
      workingDays: [...(company.workingDays ?? [])],
    })),
    disciplines: ORG_TABLES.disciplines.map((discipline) => ({ ...discipline })),
    clients: ORG_TABLES.clients.map((client) => ({ ...client })),
    projects: ORG_TABLES.projects.map((project) => ({ ...project })),
    phases: ORG_TABLES.phases.map((phase) => ({ ...phase })),
  }
}
