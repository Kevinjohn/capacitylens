import type { ActorContext, CommandIdentity, JoiningPolicySettings, WorkspaceId } from "./types";

/** Company-specific admission settings exposed through the account administration port. */
export interface JoiningPolicyAdminPort {
  readJoiningPolicy(input: { actor: ActorContext; workspaceId: WorkspaceId }): Promise<JoiningPolicySettings>;
  setJoiningPolicy(input: {
    actor: ActorContext;
    workspaceId: WorkspaceId;
    settings: JoiningPolicySettings;
    command: CommandIdentity;
  }): Promise<JoiningPolicySettings>;
}
