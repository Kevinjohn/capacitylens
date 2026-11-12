/** What the current member may do and see during one planning operation. */
export interface PlanningCapabilities {
  role: 'owner' | 'admin' | 'editor' | 'viewer';
  canWrite: boolean;
  canAnonymise: boolean;
  canSeePrivateNames: boolean;
  canSeeTimeOffNote: boolean;
}
