import router from '@adonisjs/core/services/router';
import { asPlanningMember } from '#start/route_guards';
import { sensitive } from '@kevinjohn/adonisjs-masquerade/http';
const PlanningController = () => import('#controllers/planning_controller');

// Every planning route runs as the viewed-as member; the archive read is refused in view-as.
router
  .group(() => {
    router
      .get('/api/companies/:companyId/planning', [PlanningController, 'show'])
      .as('api.planning.show');
    router
      .get('/api/companies/:companyId/planning/archive', [PlanningController, 'archive'])
      .as('api.planning.archive')
      .use(sensitive());
    router
      .post('/api/companies/:companyId/allocations', [PlanningController, 'allocationCreate'])
      .as('api.planning.allocation.create');
    router
      .patch('/api/companies/:companyId/allocations/:id', [PlanningController, 'allocationUpdate'])
      .as('api.planning.allocation.update');
    router
      .post('/api/companies/:companyId/allocations/create-group', [
        PlanningController,
        'allocationCreateGroup',
      ])
      .as('api.planning.allocation.createGroup');
    router
      .post('/api/companies/:companyId/allocations/:id/delete', [
        PlanningController,
        'allocationDelete',
      ])
      .as('api.planning.allocation.delete');
    router
      .post('/api/companies/:companyId/allocations/delete-group', [
        PlanningController,
        'allocationDeleteGroup',
      ])
      .as('api.planning.allocation.deleteGroup');
    router
      .post('/api/companies/:companyId/planning/restore-group', [
        PlanningController,
        'restoreGroup',
      ])
      .as('api.planning.restoreGroup');
    router
      .post('/api/companies/:companyId/planning/undo', [PlanningController, 'undo'])
      .as('api.planning.undo');
    router
      .post('/api/companies/:companyId/planning/redo', [PlanningController, 'redo'])
      .as('api.planning.redo');
    router
      .post('/api/companies/:companyId/resources', [PlanningController, 'resourceCreate'])
      .as('api.planning.resource.create');
    router
      .patch('/api/companies/:companyId/resources/:id', [PlanningController, 'resourceUpdate'])
      .as('api.planning.resource.update');
    router
      .post('/api/companies/:companyId/time-off', [PlanningController, 'timeOffCreate'])
      .as('api.planning.timeOff.create');
    router
      .patch('/api/companies/:companyId/time-off/:id', [PlanningController, 'timeOffUpdate'])
      .as('api.planning.timeOff.update');
    router
      .post('/api/companies/:companyId/time-off/:id/delete', [PlanningController, 'timeOffDelete'])
      .as('api.planning.timeOff.delete');
    router
      .post('/api/companies/:companyId/time-off/delete-group', [
        PlanningController,
        'timeOffDeleteGroup',
      ])
      .as('api.planning.timeOff.deleteGroup');
    router
      .post('/api/companies/:companyId/closures', [PlanningController, 'closureCreate'])
      .as('api.planning.closure.create');
    router
      .patch('/api/companies/:companyId/closures/:id', [PlanningController, 'closureUpdate'])
      .as('api.planning.closure.update');
    router
      .post('/api/companies/:companyId/closures/:id/delete', [PlanningController, 'closureDelete'])
      .as('api.planning.closure.delete');
    router
      .post('/api/companies/:companyId/clients', [PlanningController, 'clientCreate'])
      .as('api.planning.client.create');
    router
      .patch('/api/companies/:companyId/clients/:id', [PlanningController, 'clientUpdate'])
      .as('api.planning.client.update');
    router
      .post('/api/companies/:companyId/clients/:id/archive', [PlanningController, 'clientArchive'])
      .as('api.planning.client.archive');
    router
      .post('/api/companies/:companyId/clients/:id/unarchive', [
        PlanningController,
        'clientUnarchive',
      ])
      .as('api.planning.client.unarchive');
    router
      .post('/api/companies/:companyId/projects', [PlanningController, 'projectCreate'])
      .as('api.planning.project.create');
    router
      .patch('/api/companies/:companyId/projects/:id', [PlanningController, 'projectUpdate'])
      .as('api.planning.project.update');
    router
      .post('/api/companies/:companyId/projects/:id/archive', [
        PlanningController,
        'projectArchive',
      ])
      .as('api.planning.project.archive');
    router
      .post('/api/companies/:companyId/projects/:id/unarchive', [
        PlanningController,
        'projectUnarchive',
      ])
      .as('api.planning.project.unarchive');
    router
      .post('/api/companies/:companyId/activities', [PlanningController, 'activityCreate'])
      .as('api.planning.activity.create');
    router
      .patch('/api/companies/:companyId/activities/:id', [PlanningController, 'activityUpdate'])
      .as('api.planning.activity.update');
    router
      .post('/api/companies/:companyId/activities/:id/archive', [
        PlanningController,
        'activityArchive',
      ])
      .as('api.planning.activity.archive');
    router
      .post('/api/companies/:companyId/activities/:id/unarchive', [
        PlanningController,
        'activityUnarchive',
      ])
      .as('api.planning.activity.unarchive');
    router
      .post('/api/companies/:companyId/phases', [PlanningController, 'phaseCreate'])
      .as('api.planning.phase.create');
    router
      .patch('/api/companies/:companyId/phases/:id', [PlanningController, 'phaseUpdate'])
      .as('api.planning.phase.update');
    router
      .post('/api/companies/:companyId/phases/:id/delete', [PlanningController, 'phaseDelete'])
      .as('api.planning.phase.delete');
    router
      .post('/api/companies/:companyId/disciplines', [PlanningController, 'disciplineCreate'])
      .as('api.planning.discipline.create');
    router
      .patch('/api/companies/:companyId/disciplines/:id', [PlanningController, 'disciplineUpdate'])
      .as('api.planning.discipline.update');
    router
      .post('/api/companies/:companyId/disciplines/:id/delete', [
        PlanningController,
        'disciplineDelete',
      ])
      .as('api.planning.discipline.delete');
    router
      .post('/api/companies/:companyId/resources/:id/archive', [
        PlanningController,
        'resourceArchive',
      ])
      .as('api.planning.resource.archive');
    router
      .post('/api/companies/:companyId/resources/:id/unarchive', [
        PlanningController,
        'resourceUnarchive',
      ])
      .as('api.planning.resource.unarchive');
    router
      .post('/api/companies/:companyId/allocations/:id/duplicate', [
        PlanningController,
        'allocationDuplicate',
      ])
      .as('api.planning.allocation.duplicate');
    router
      .post('/api/companies/:companyId/time-off/repeat', [PlanningController, 'timeOffRepeat'])
      .as('api.planning.timeOff.repeat');
    router
      .patch('/api/companies/:companyId/settings', [PlanningController, 'settingsUpdate'])
      .as('api.planning.settings.update');
  })
  .use(asPlanningMember());
