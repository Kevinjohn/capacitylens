import type { HttpContext } from '@adonisjs/core/http';
import {
  readPlanning,
  readArchiveRecovery,
  mutatePlanning,
  lookupPlanningMutation,
  validatePlanningMutationId,
} from '#services/planning';
import { PlanningOperationError } from '#services/planning/execute';
import { allocationMutationValidator } from '#validators/planning/allocation';
import { catalogueMutationValidator } from '#validators/planning/catalogue';
import { resourceMutationValidator } from '#validators/planning/resource';
import { timeOffMutationValidator } from '#validators/planning/time_off';
import { closureMutationValidator } from '#validators/planning/closure';
import { settingsMutationValidator } from '#validators/planning/settings';
import { planningMutationValidator } from '#validators/planning_operations';
import type { PlanningMutationInput } from '#validators/planning/contracts';
import { sendRefusal } from '#services/planning/http_refusal';

/** Resource routes accept only their named operation and matching target; the body never selects a table. */
export default class PlanningController {
  async show(ctx: HttpContext) {
    try {
      return await readPlanning(ctx, String(ctx.params.accountId));
    } catch (error) {
      return sendRefusal(error, ctx);
    }
  }

  async archive(ctx: HttpContext) {
    try {
      return await readArchiveRecovery(ctx, String(ctx.params.accountId));
    } catch (error) {
      return sendRefusal(error, ctx);
    }
  }

  async lookup(ctx: HttpContext) {
    try {
      const mutationId = await validatePlanningMutationId(ctx.params.mutationId);
      return await lookupPlanningMutation(ctx, String(ctx.params.accountId), mutationId);
    } catch (error) {
      return sendRefusal(error, ctx);
    }
  }

  /** Validate the route's body, check that its operation and target match the route, then run it.
   * Each action passes its own validateUsing call so the route registry can type the body. */
  private async execute(
    ctx: HttpContext,
    validate: () => Promise<PlanningMutationInput>,
    operation: PlanningMutationInput['intent']['operation'],
    entity?: string
  ) {
    try {
      const input = await validate();
      if (input.intent.operation !== operation) {
        throw new PlanningOperationError(
          400,
          'VALIDATION_ERROR',
          'The operation does not match this resource route.'
        );
      }
      const target = 'entity' in input.intent ? input.intent.entity : input.intent;
      if (entity && (!('entity' in target) || target.entity !== entity)) {
        throw new PlanningOperationError(
          400,
          'VALIDATION_ERROR',
          'The operation does not match this resource route.'
        );
      }
      const targetId =
        'sourceAllocationId' in target
          ? target.sourceAllocationId
          : 'id' in target
            ? target.id
            : undefined;
      if (ctx.params.id !== undefined && targetId !== ctx.params.id) {
        throw new PlanningOperationError(
          400,
          'VALIDATION_ERROR',
          'The operation target does not match this resource route.'
        );
      }
      return await mutatePlanning(ctx, String(ctx.params.accountId), input);
    } catch (error) {
      return sendRefusal(error, ctx);
    }
  }

  async allocationCreate(ctx: HttpContext) {
    return this.execute(
      ctx,
      () => ctx.request.validateUsing(allocationMutationValidator),
      'allocation.create'
    );
  }

  async allocationUpdate(ctx: HttpContext) {
    return this.execute(
      ctx,
      () => ctx.request.validateUsing(allocationMutationValidator),
      'allocation.update'
    );
  }

  async allocationDuplicate(ctx: HttpContext) {
    return this.execute(
      ctx,
      () => ctx.request.validateUsing(allocationMutationValidator),
      'allocation.duplicate'
    );
  }

  async allocationRepeat(ctx: HttpContext) {
    return this.execute(
      ctx,
      () => ctx.request.validateUsing(allocationMutationValidator),
      'allocation.repeat'
    );
  }

  async allocationCreateGroup(ctx: HttpContext) {
    return this.execute(
      ctx,
      () => ctx.request.validateUsing(allocationMutationValidator),
      'allocation.createGroup'
    );
  }

  async allocationDelete(ctx: HttpContext) {
    return this.execute(
      ctx,
      () => ctx.request.validateUsing(allocationMutationValidator),
      'allocation.delete'
    );
  }

  async allocationDeleteGroup(ctx: HttpContext) {
    return this.execute(
      ctx,
      () => ctx.request.validateUsing(allocationMutationValidator),
      'allocation.deleteGroup'
    );
  }

  async restoreGroup(ctx: HttpContext) {
    return this.execute(
      ctx,
      () => ctx.request.validateUsing(planningMutationValidator),
      'planning.restoreGroup'
    );
  }

  async resourceCreate(ctx: HttpContext) {
    return this.execute(
      ctx,
      () => ctx.request.validateUsing(resourceMutationValidator),
      'resource.create'
    );
  }

  async resourceUpdate(ctx: HttpContext) {
    return this.execute(
      ctx,
      () => ctx.request.validateUsing(resourceMutationValidator),
      'resource.update'
    );
  }

  async timeOffCreate(ctx: HttpContext) {
    return this.execute(
      ctx,
      () => ctx.request.validateUsing(timeOffMutationValidator),
      'timeOff.create'
    );
  }

  async timeOffUpdate(ctx: HttpContext) {
    return this.execute(
      ctx,
      () => ctx.request.validateUsing(timeOffMutationValidator),
      'timeOff.update'
    );
  }

  async timeOffDelete(ctx: HttpContext) {
    return this.execute(
      ctx,
      () => ctx.request.validateUsing(timeOffMutationValidator),
      'timeOff.delete'
    );
  }

  async timeOffDeleteGroup(ctx: HttpContext) {
    return this.execute(
      ctx,
      () => ctx.request.validateUsing(timeOffMutationValidator),
      'timeOff.deleteGroup'
    );
  }

  async timeOffRepeat(ctx: HttpContext) {
    return this.execute(
      ctx,
      () => ctx.request.validateUsing(timeOffMutationValidator),
      'timeOff.repeat'
    );
  }

  async closureCreate(ctx: HttpContext) {
    return this.execute(
      ctx,
      () => ctx.request.validateUsing(closureMutationValidator),
      'closure.create'
    );
  }

  async closureUpdate(ctx: HttpContext) {
    return this.execute(
      ctx,
      () => ctx.request.validateUsing(closureMutationValidator),
      'closure.update'
    );
  }

  async closureDelete(ctx: HttpContext) {
    return this.execute(
      ctx,
      () => ctx.request.validateUsing(closureMutationValidator),
      'closure.delete'
    );
  }

  async settingsUpdate(ctx: HttpContext) {
    return this.execute(
      ctx,
      () => ctx.request.validateUsing(settingsMutationValidator),
      'settings.update'
    );
  }

  async clientCreate(ctx: HttpContext) {
    return this.execute(
      ctx,
      () => ctx.request.validateUsing(catalogueMutationValidator),
      'catalogue.create',
      'clients'
    );
  }

  async clientUpdate(ctx: HttpContext) {
    return this.execute(
      ctx,
      () => ctx.request.validateUsing(catalogueMutationValidator),
      'catalogue.update',
      'clients'
    );
  }

  async clientArchive(ctx: HttpContext) {
    return this.execute(
      ctx,
      () => ctx.request.validateUsing(catalogueMutationValidator),
      'catalogue.archive',
      'clients'
    );
  }

  async clientUnarchive(ctx: HttpContext) {
    return this.execute(
      ctx,
      () => ctx.request.validateUsing(catalogueMutationValidator),
      'catalogue.unarchive',
      'clients'
    );
  }

  async projectCreate(ctx: HttpContext) {
    return this.execute(
      ctx,
      () => ctx.request.validateUsing(catalogueMutationValidator),
      'catalogue.create',
      'projects'
    );
  }

  async projectUpdate(ctx: HttpContext) {
    return this.execute(
      ctx,
      () => ctx.request.validateUsing(catalogueMutationValidator),
      'catalogue.update',
      'projects'
    );
  }

  async projectArchive(ctx: HttpContext) {
    return this.execute(
      ctx,
      () => ctx.request.validateUsing(catalogueMutationValidator),
      'catalogue.archive',
      'projects'
    );
  }

  async projectUnarchive(ctx: HttpContext) {
    return this.execute(
      ctx,
      () => ctx.request.validateUsing(catalogueMutationValidator),
      'catalogue.unarchive',
      'projects'
    );
  }

  async activityCreate(ctx: HttpContext) {
    return this.execute(
      ctx,
      () => ctx.request.validateUsing(catalogueMutationValidator),
      'catalogue.create',
      'activities'
    );
  }

  async activityUpdate(ctx: HttpContext) {
    return this.execute(
      ctx,
      () => ctx.request.validateUsing(catalogueMutationValidator),
      'catalogue.update',
      'activities'
    );
  }

  async activityArchive(ctx: HttpContext) {
    return this.execute(
      ctx,
      () => ctx.request.validateUsing(catalogueMutationValidator),
      'catalogue.archive',
      'activities'
    );
  }

  async activityUnarchive(ctx: HttpContext) {
    return this.execute(
      ctx,
      () => ctx.request.validateUsing(catalogueMutationValidator),
      'catalogue.unarchive',
      'activities'
    );
  }

  async phaseCreate(ctx: HttpContext) {
    return this.execute(
      ctx,
      () => ctx.request.validateUsing(catalogueMutationValidator),
      'catalogue.create',
      'phases'
    );
  }

  async phaseUpdate(ctx: HttpContext) {
    return this.execute(
      ctx,
      () => ctx.request.validateUsing(catalogueMutationValidator),
      'catalogue.update',
      'phases'
    );
  }

  async phaseDelete(ctx: HttpContext) {
    return this.execute(
      ctx,
      () => ctx.request.validateUsing(catalogueMutationValidator),
      'catalogue.delete',
      'phases'
    );
  }

  async disciplineCreate(ctx: HttpContext) {
    return this.execute(
      ctx,
      () => ctx.request.validateUsing(catalogueMutationValidator),
      'catalogue.create',
      'disciplines'
    );
  }

  async disciplineUpdate(ctx: HttpContext) {
    return this.execute(
      ctx,
      () => ctx.request.validateUsing(catalogueMutationValidator),
      'catalogue.update',
      'disciplines'
    );
  }

  async disciplineDelete(ctx: HttpContext) {
    return this.execute(
      ctx,
      () => ctx.request.validateUsing(catalogueMutationValidator),
      'catalogue.delete',
      'disciplines'
    );
  }

  async resourceArchive(ctx: HttpContext) {
    return this.execute(
      ctx,
      () => ctx.request.validateUsing(resourceMutationValidator),
      'resource.archive'
    );
  }

  async resourceUnarchive(ctx: HttpContext) {
    return this.execute(
      ctx,
      () => ctx.request.validateUsing(resourceMutationValidator),
      'resource.unarchive'
    );
  }
}
