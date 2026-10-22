import router from '@adonisjs/core/services/router'
const PlanningController = () => import('#controllers/planning_controller')

router
  .get('/api/accounts/:accountId/planning', [PlanningController, 'show'])
  .as('api.planning.show')
router
  .get('/api/accounts/:accountId/planning/mutations/:mutationId', [PlanningController, 'lookup'])
  .as('api.planning.lookup')
router
  .post('/api/accounts/:accountId/allocations', [PlanningController, 'allocationCreate'])
  .as('api.planning.allocation.create')
router
  .patch('/api/accounts/:accountId/allocations/:id', [PlanningController, 'allocationUpdate'])
  .as('api.planning.allocation.update')
router
  .post('/api/accounts/:accountId/allocations/create-group', [
    PlanningController,
    'allocationCreateGroup',
  ])
  .as('api.planning.allocation.createGroup')
router
  .post('/api/accounts/:accountId/allocations/:id/delete', [PlanningController, 'allocationDelete'])
  .as('api.planning.allocation.delete')
router
  .post('/api/accounts/:accountId/allocations/delete-group', [
    PlanningController,
    'allocationDeleteGroup',
  ])
  .as('api.planning.allocation.deleteGroup')
router
  .post('/api/accounts/:accountId/planning/restore-group', [PlanningController, 'restoreGroup'])
  .as('api.planning.restoreGroup')
router
  .post('/api/accounts/:accountId/resources', [PlanningController, 'resourceCreate'])
  .as('api.planning.resource.create')
router
  .patch('/api/accounts/:accountId/resources/:id', [PlanningController, 'resourceUpdate'])
  .as('api.planning.resource.update')
router
  .post('/api/accounts/:accountId/time-off', [PlanningController, 'timeOffCreate'])
  .as('api.planning.timeOff.create')
router
  .patch('/api/accounts/:accountId/time-off/:id', [PlanningController, 'timeOffUpdate'])
  .as('api.planning.timeOff.update')
router
  .post('/api/accounts/:accountId/time-off/:id/delete', [PlanningController, 'timeOffDelete'])
  .as('api.planning.timeOff.delete')
router
  .post('/api/accounts/:accountId/time-off/delete-group', [
    PlanningController,
    'timeOffDeleteGroup',
  ])
  .as('api.planning.timeOff.deleteGroup')
router
  .post('/api/accounts/:accountId/closures', [PlanningController, 'closureCreate'])
  .as('api.planning.closure.create')
router
  .patch('/api/accounts/:accountId/closures/:id', [PlanningController, 'closureUpdate'])
  .as('api.planning.closure.update')
router
  .post('/api/accounts/:accountId/closures/:id/delete', [PlanningController, 'closureDelete'])
  .as('api.planning.closure.delete')
router
  .post('/api/accounts/:accountId/clients', [PlanningController, 'clientCreate'])
  .as('api.planning.client.create')
router
  .patch('/api/accounts/:accountId/clients/:id', [PlanningController, 'clientUpdate'])
  .as('api.planning.client.update')
router
  .post('/api/accounts/:accountId/clients/:id/archive', [PlanningController, 'clientArchive'])
  .as('api.planning.client.archive')
router
  .post('/api/accounts/:accountId/clients/:id/unarchive', [PlanningController, 'clientUnarchive'])
  .as('api.planning.client.unarchive')
router
  .post('/api/accounts/:accountId/projects', [PlanningController, 'projectCreate'])
  .as('api.planning.project.create')
router
  .patch('/api/accounts/:accountId/projects/:id', [PlanningController, 'projectUpdate'])
  .as('api.planning.project.update')
router
  .post('/api/accounts/:accountId/projects/:id/archive', [PlanningController, 'projectArchive'])
  .as('api.planning.project.archive')
router
  .post('/api/accounts/:accountId/projects/:id/unarchive', [PlanningController, 'projectUnarchive'])
  .as('api.planning.project.unarchive')
router
  .post('/api/accounts/:accountId/activities', [PlanningController, 'activityCreate'])
  .as('api.planning.activity.create')
router
  .patch('/api/accounts/:accountId/activities/:id', [PlanningController, 'activityUpdate'])
  .as('api.planning.activity.update')
router
  .post('/api/accounts/:accountId/activities/:id/archive', [PlanningController, 'activityArchive'])
  .as('api.planning.activity.archive')
router
  .post('/api/accounts/:accountId/activities/:id/unarchive', [
    PlanningController,
    'activityUnarchive',
  ])
  .as('api.planning.activity.unarchive')
router
  .post('/api/accounts/:accountId/phases', [PlanningController, 'phaseCreate'])
  .as('api.planning.phase.create')
router
  .patch('/api/accounts/:accountId/phases/:id', [PlanningController, 'phaseUpdate'])
  .as('api.planning.phase.update')
router
  .post('/api/accounts/:accountId/phases/:id/delete', [PlanningController, 'phaseDelete'])
  .as('api.planning.phase.delete')
router
  .post('/api/accounts/:accountId/disciplines', [PlanningController, 'disciplineCreate'])
  .as('api.planning.discipline.create')
router
  .patch('/api/accounts/:accountId/disciplines/:id', [PlanningController, 'disciplineUpdate'])
  .as('api.planning.discipline.update')
router
  .post('/api/accounts/:accountId/disciplines/:id/delete', [PlanningController, 'disciplineDelete'])
  .as('api.planning.discipline.delete')
router
  .post('/api/accounts/:accountId/resources/:id/archive', [PlanningController, 'resourceArchive'])
  .as('api.planning.resource.archive')
router
  .post('/api/accounts/:accountId/resources/:id/unarchive', [
    PlanningController,
    'resourceUnarchive',
  ])
  .as('api.planning.resource.unarchive')
router
  .post('/api/accounts/:accountId/allocations/:id/duplicate', [
    PlanningController,
    'allocationDuplicate',
  ])
  .as('api.planning.allocation.duplicate')
router
  .post('/api/accounts/:accountId/allocations/:id/repeat', [PlanningController, 'allocationRepeat'])
  .as('api.planning.allocation.repeat')
router
  .post('/api/accounts/:accountId/time-off/repeat', [PlanningController, 'timeOffRepeat'])
  .as('api.planning.timeOff.repeat')
router
  .patch('/api/accounts/:accountId/settings', [PlanningController, 'settingsUpdate'])
  .as('api.planning.settings.update')
