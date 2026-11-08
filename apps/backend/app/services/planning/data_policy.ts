/** What the current member may do and see while one planning batch is applied. */
export interface BatchCapabilities {
  role: 'owner' | 'admin' | 'editor' | 'viewer';
  canWrite: boolean;
  canAnonymise: boolean;
  canSeePrivateNames: boolean;
  canSeeTimeOffNote: boolean;
}
