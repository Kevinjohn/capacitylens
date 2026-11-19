import { createId } from '@capacitylens/shared/lib/id';
import { clampWorkingHoursPerDay } from '@capacitylens/shared/types/entities';
import {
  isWeekdaySet,
  normalizeCompanyWorkingDays,
} from '@capacitylens/shared/lib/companyWorkingDays';
import { assertResourceExists } from '@capacitylens/shared/domain/mutations';
import { getOwned } from '@capacitylens/shared/domain/mutations';
import type {
  Company,
  Activity,
  Client,
  Closure,
  Discipline,
  Phase,
  Project,
  Resource,
  TimeOff,
} from '@capacitylens/shared/types/entities';
import {
  buildCatalogueCreate,
  buildCatalogueUpdate,
  buildClosureCreate,
  buildClosureUpdate,
  buildResourceCreate,
  buildResourceUpdate,
  buildSettingsUpdate,
  buildTimeOffCreate,
  buildTimeOffUpdate,
} from '@/data/planning/planningCommands';
import type { PlanningCommand } from '@/data/planning/planningCommands';
import type { CreateResult, Draft, Patch, RepeatRange, StoreState } from './types';
import type { StoreInternals } from './storeInternal';

function requireCreatedId(value: unknown): string {
  if (typeof value !== 'string') throw new Error('The planning row has no id.');
  return value;
}

/** The remaining planning writers share the allocation controller and await its reconciliation. */
export function createTypedPlanningActions(
  get: () => Pick<StoreState, 'data' | 'planning' | 'masquerade' | 'sendPlanningCommand'>,
  { requireCompany, blockedByViewer }: Pick<StoreInternals, 'requireCompany' | 'blockedByViewer'>,
) {
  const blocked = blockedByViewer;
  // After a failed first read the company row was never published, so a create reports that, as it
  // did before the authority gate existed, instead of the gate's role-unavailable notice.
  const requireCreateAccount = () => {
    const companyId = requireCompany();
    const { data, planning, masquerade } = get();
    if (
      masquerade.kind === 'inactive' &&
      planning.authority === null &&
      planning.phase.kind === 'failed' &&
      !data.accounts.some((row) => row.id === companyId)
    ) {
      throw new Error('No active company is selected.');
    }
    return companyId;
  };
  // The guard admits a company still loading from the summaries; no command can be built for it
  // until its row is published, which the person sees as no company being selected yet.
  const buildUnpreparedError = (companyId: string, message: string) =>
    new Error(
      get().data.accounts.some((row) => row.id === companyId)
        ? message
        : 'No active company is selected.',
    );
  const owned = <
    K extends
      | 'clients'
      | 'projects'
      | 'phases'
      | 'activities'
      | 'disciplines'
      | 'resources'
      | 'timeOff'
      | 'closures',
  >(
    key: K,
    id: string,
    companyId: string,
  ) => getOwned(get().data, companyId, key, id);
  const send = async (command: PlanningCommand | null) =>
    command ? get().sendPlanningCommand(command) : undefined;
  /** Adds the edited row's opening `updatedAt` to an update, when the form supplied one. */
  const applyExpectedUpdatedAt = (
    command: PlanningCommand | null,
    expectedUpdatedAt: string | undefined,
  ) => (command && expectedUpdatedAt !== undefined ? { ...command, expectedUpdatedAt } : command);
  const created = <
    K extends keyof Pick<
      StoreState['data'],
      | 'clients'
      | 'projects'
      | 'phases'
      | 'activities'
      | 'disciplines'
      | 'resources'
      | 'timeOff'
      | 'closures'
    >,
  >(
    key: K,
    id: string,
  ): StoreState['data'][K][number] => {
    const row = get().data[key].find((candidate) => candidate.id === id);
    if (!row) throw new Error('The saved planning row was not returned.');
    return row;
  };
  const createCatalogue = async <T extends Client | Project | Phase | Activity | Discipline>(
    key: 'clients' | 'projects' | 'phases' | 'activities' | 'disciplines',
    fields: Draft<T>,
  ): Promise<CreateResult<T>> => {
    const companyId = requireCreateAccount();
    if (blocked()) return { kind: 'blocked' };
    const id = createId();
    const command = buildCatalogueCreate({
      data: get().data,
      companyId,
      args: { entity: key, id, fields } as Parameters<typeof buildCatalogueCreate>[0]['args'],
    });
    if (!command) {
      throw buildUnpreparedError(companyId, 'The planning change could not be prepared.');
    }
    await send(command);
    return { kind: 'created', value: created(key, id) as T };
  };
  const updateCatalogue = async (
    key: 'clients' | 'projects' | 'phases' | 'activities' | 'disciplines',
    id: string,
    changes: object,
    expectedUpdatedAt?: string,
  ) => {
    const companyId = requireCompany();
    if (blocked()) return;
    const original = owned(key, id, companyId);
    if (!original) return;
    await send(
      applyExpectedUpdatedAt(
        buildCatalogueUpdate({
          data: get().data,
          companyId,
          original,
          args: { entity: key, id, changes },
        }),
        expectedUpdatedAt,
      ),
    );
  };
  const deleteCatalogue = async (key: 'phases' | 'disciplines', id: string) => {
    const companyId = requireCompany();
    if (blocked() || !owned(key, id, companyId)) return;
    await send({ intent: { operation: 'catalogue.delete', entity: { entity: key, id } } });
  };
  const createTimeOff = async (input: Draft<TimeOff>): Promise<CreateResult<TimeOff>> => {
    const companyId = requireCreateAccount();
    if (blocked()) return { kind: 'blocked' };
    assertResourceExists({ data: get().data, companyId, resourceId: input.resourceId });
    const id = createId();
    const command = buildTimeOffCreate({
      data: get().data,
      companyId,
      args: { id, fields: input },
    });
    if (!command) {
      throw buildUnpreparedError(companyId, 'The time-off entry could not be prepared.');
    }
    await send(command);
    return { kind: 'created', value: created('timeOff', id) };
  };
  return {
    addDiscipline: (input: Draft<Discipline>) => createCatalogue<Discipline>('disciplines', input),
    updateDiscipline: (id: string, patch: Patch<Discipline>, expectedUpdatedAt?: string) =>
      updateCatalogue('disciplines', id, patch, expectedUpdatedAt),
    deleteDiscipline: (id: string) => deleteCatalogue('disciplines', id),
    addClient: (input: Draft<Client>) => createCatalogue<Client>('clients', input),
    updateClient: (id: string, patch: Patch<Client>, expectedUpdatedAt?: string) =>
      updateCatalogue('clients', id, patch, expectedUpdatedAt),
    addProject: (input: Draft<Project>) => createCatalogue<Project>('projects', input),
    updateProject: (id: string, patch: Patch<Project>, expectedUpdatedAt?: string) =>
      updateCatalogue('projects', id, patch, expectedUpdatedAt),
    addPhase: (input: Draft<Phase>) => createCatalogue<Phase>('phases', input),
    updatePhase: (id: string, patch: Patch<Phase>) => updateCatalogue('phases', id, patch),
    deletePhase: (id: string) => deleteCatalogue('phases', id),
    addActivity: (input: Draft<Activity>) => createCatalogue<Activity>('activities', input),
    updateActivity: (id: string, patch: Patch<Activity>, expectedUpdatedAt?: string) =>
      updateCatalogue('activities', id, patch, expectedUpdatedAt),
    deleteActivity: async (id: string) => {
      const companyId = requireCompany();
      if (blocked() || !owned('activities', id, companyId)) return undefined;
      return send({
        intent: { operation: 'catalogue.archive', entity: { entity: 'activities', id } },
      });
    },
    addResource: async (input: Draft<Resource>): Promise<CreateResult<Resource>> => {
      const companyId = requireCreateAccount();
      if (blocked()) return { kind: 'blocked' };
      const id = createId();
      const fields = {
        ...input,
        workingHoursPerDay: clampWorkingHoursPerDay(input.workingHoursPerDay),
      };
      const command = buildResourceCreate({
        data: get().data,
        companyId,
        args: { id, fields },
      });
      if (!command) throw buildUnpreparedError(companyId, 'The resource could not be prepared.');
      await send(command);
      return { kind: 'created', value: created('resources', id) };
    },
    updateResource: async (id: string, patch: Patch<Resource>, expectedUpdatedAt?: string) => {
      const companyId = requireCompany();
      if (blocked()) return;
      const original = owned('resources', id, companyId);
      if (!original) return;
      const changes =
        patch.workingHoursPerDay === undefined
          ? patch
          : { ...patch, workingHoursPerDay: clampWorkingHoursPerDay(patch.workingHoursPerDay) };
      await send(
        applyExpectedUpdatedAt(
          buildResourceUpdate({
            data: get().data,
            companyId,
            original,
            args: { id, changes },
          }),
          expectedUpdatedAt,
        ),
      );
    },
    addTimeOff: createTimeOff,
    addRepeatedTimeOff: async (
      input: Draft<TimeOff>,
      repeat: RepeatRange,
      count: number,
    ): Promise<CreateResult<TimeOff[]>> => {
      if (!Number.isSafeInteger(count) || count < 2) {
        throw new Error('A repeat needs at least two entries.');
      }
      const companyId = requireCreateAccount();
      if (blocked()) return { kind: 'blocked' };
      assertResourceExists({ data: get().data, companyId, resourceId: input.resourceId });
      const command = buildTimeOffCreate({
        data: get().data,
        companyId,
        args: { id: createId(), fields: input },
      });
      if (!command || command.intent.operation !== 'timeOff.create') {
        throw buildUnpreparedError(companyId, 'The time-off entry could not be prepared.');
      }
      const timeOff = command.intent.timeOff;
      // Later entry ids are minted here too, so every created row can be returned by id.
      const occurrenceIds = Array.from({ length: count - 1 }, () => createId());
      const ids = [requireCreatedId(timeOff.id), ...occurrenceIds];
      await send({ intent: { operation: 'timeOff.repeat', timeOff, repeat, occurrenceIds } });
      return { kind: 'created', value: ids.map((id) => created('timeOff', id)) };
    },
    updateTimeOff: async (id: string, changes: Patch<TimeOff>, expectedUpdatedAt?: string) => {
      const companyId = requireCompany();
      if (blocked()) return;
      const original = owned('timeOff', id, companyId);
      if (original) {
        await send(
          applyExpectedUpdatedAt(
            buildTimeOffUpdate({
              data: get().data,
              companyId,
              original,
              args: { id, changes },
            }),
            expectedUpdatedAt,
          ),
        );
      }
    },
    deleteTimeOff: async (id: string) => {
      const companyId = requireCompany();
      if (blocked() || !owned('timeOff', id, companyId)) return;
      await send({ intent: { operation: 'timeOff.delete', id } });
    },
    addClosure: async (input: Draft<Closure>): Promise<CreateResult<Closure>> => {
      const companyId = requireCreateAccount();
      if (blocked()) return { kind: 'blocked' };
      const id = createId();
      const command = buildClosureCreate({
        data: get().data,
        companyId,
        args: { id, fields: input },
      });
      if (!command) throw buildUnpreparedError(companyId, 'The closure could not be prepared.');
      await send(command);
      return { kind: 'created', value: created('closures', id) };
    },
    updateClosure: async (id: string, changes: Patch<Closure>, expectedUpdatedAt?: string) => {
      const companyId = requireCompany();
      if (blocked()) return;
      const original = owned('closures', id, companyId);
      if (original) {
        await send(
          applyExpectedUpdatedAt(
            buildClosureUpdate({
              data: get().data,
              companyId,
              original,
              args: { id, changes },
            }),
            expectedUpdatedAt,
          ),
        );
      }
    },
    deleteClosure: async (id: string) => {
      const companyId = requireCompany();
      if (blocked() || !owned('closures', id, companyId)) return;
      await send({ intent: { operation: 'closure.delete', id } });
    },
    updateCompany: async (id: string, patch: Patch<Company>) => {
      const companyId = requireCompany();
      if (blocked()) return;
      if (id !== companyId) {
        throw new Error('Cannot update a company other than the active company.');
      }
      const original = get().data.accounts.find((row) => row.id === id);
      if (!original) return;
      if (
        patch.workingDays != null &&
        (!isWeekdaySet(patch.workingDays) || patch.workingDays.length === 0)
      ) {
        throw new Error(
          'At least one working day is required, using unique whole-number weekdays from 0 to 6.',
        );
      }
      const changes =
        patch.workingDays == null
          ? patch
          : {
              ...patch,
              workingDays: normalizeCompanyWorkingDays(
                patch.workingDays,
                original.weekStartsOn ?? 1,
              ),
            };
      await send(buildSettingsUpdate({ data: get().data, companyId: id, original, args: changes }));
    },
  };
}
