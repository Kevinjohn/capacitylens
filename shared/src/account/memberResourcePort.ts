import type { ActorContext, CommandIdentity, IsoInstant, PrincipalId, WorkspaceId } from "./types";

/** App-owned association metadata exposed only to the privileged member directory. */
export interface MemberResourceLink {
  resourceId: string;
  revision: string;
  resourceName?: string | null;
  resourceStatus?: "active" | "disabled" | "archived" | null;
}

/** Minimum identity-derived projection required to render a scheduled person's avatar. */
export interface ResourceAvatarEntry {
  resourceId: string;
  imageUrl: string;
}

/** Account-scoped storage seam for association administration and its privacy-preserving read model. */
export interface AccountMemberResourcePort {
  listLinks(workspaceId: WorkspaceId): Promise<ReadonlyMap<PrincipalId, MemberResourceLink>>;
  listCandidates(workspaceId: WorkspaceId): Promise<readonly { resourceId: string; label: string }[]>;
  listExceptions(workspaceId: WorkspaceId): Promise<
    ReadonlyMap<
      PrincipalId,
      {
        proposedResourceId: string | null;
        reason: "resource_unavailable" | "resource_already_linked" | "member_already_linked";
      }
    >
  >;
  listAvatarProjection(workspaceId: WorkspaceId): Promise<readonly ResourceAvatarEntry[]>;
  setLink(input: {
    workspaceId: WorkspaceId;
    principalId: PrincipalId;
    resourceId: string;
    expectedRevision: string | null;
    now: IsoInstant;
    actor: ActorContext;
    command: CommandIdentity;
  }): Promise<MemberResourceLink>;
  clearLink(input: {
    workspaceId: WorkspaceId;
    principalId: PrincipalId;
    expectedRevision: string;
    actor: ActorContext;
    command: CommandIdentity;
  }): Promise<void>;
  dismissException(input: {
    workspaceId: WorkspaceId;
    principalId: PrincipalId;
    actor: ActorContext;
    command: CommandIdentity;
  }): Promise<void>;
  reconcileImportedLinks(input: {
    workspaceId: WorkspaceId;
    resourceIdMap: ReadonlyMap<string, string>;
    updatedAt: IsoInstant;
  }): void;
  removeResourceLink(workspaceId: WorkspaceId, resourceId: string): void;
}
