import type { Role } from '@capacitylens/shared/account/types';

/** What the current member may do and see during one planning operation. */
export interface PlanningCapabilities {
  role: Role;
  canWrite: boolean;
  canSeePrivateNames: boolean;
  canSeeTimeOffNote: boolean;
}
