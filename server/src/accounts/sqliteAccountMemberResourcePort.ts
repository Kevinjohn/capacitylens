import type { AccountMemberResourcePort } from "@capacitylens/shared/account/ports";
import type { ActorContext, CommandIdentity } from "@capacitylens/shared/account/types";
import type { Db } from "../db";
import { enqueueAudit } from "../auditOutbox";
import { beginCommand, completeCommand, markAccountCommandReplay } from "./commands";
import { assertAccountAuthority } from "./adminPort/authority";
import { tx, type SynchronousCallback } from "../txn";
import {
  clearAccountMemberResourceLink,
  listAccountMemberResourceLinks,
  listResourceAvatarProjection,
  reconcileAccountMemberResources,
  removeAccountMemberResourceForResource,
  setAccountMemberResourceLinkWithResult,
} from "../controlTables/accountMemberResources";
import {
  listMemberResourceLinkExceptions,
  removeMemberResourceLinkException,
} from "../controlTables/invitationPersonProposals";
import type { AuditRecord } from "../audit";

interface PortOptions {
  applicationId?: string;
}

function associationAudit(input: {
  action: "memberResourceLink" | "memberResourceChange" | "memberResourceUnlink";
  db: Db;
  accountId: string;
  actor: ActorContext;
  principalId: string;
  resourceId: string;
  revision: string;
  previousRevision?: string | undefined;
  command: CommandIdentity;
}): void {
  const record: AuditRecord = {
    ts: new Date().toISOString(),
    userId: input.actor.principalId,
    accountId: input.accountId,
    action: input.action,
    entity: "account_member_resources",
    id: `${input.accountId}:${input.principalId}:${input.resourceId}`,
    changedFields: ["resourceId", "principalId", "revision", ...(input.previousRevision ? ["previousRevision"] : [])],
    association: {
      principalId: input.principalId,
      resourceId: input.resourceId,
      revision: input.revision,
      ...(input.previousRevision ? { previousRevision: input.previousRevision } : {}),
    },
  };
  enqueueAudit(input.db, record, `${input.command.commandId}:${input.action}:${record.id}`);
}

function runCommand<T>(input: {
  db: Db;
  applicationId: string;
  accountId: string;
  principalId: string;
  actor: ActorContext;
  command: CommandIdentity;
  payload: unknown;
  action: () => T;
  audit?: (result: T) => void;
}): T {
  const transaction = (() => {
    assertAccountAuthority({
      db: input.db,
      actor: input.actor,
      workspaceId: input.accountId,
      action: "manage-members",
    });
    const begun = beginCommand({
      db: input.db,
      scope: {
        applicationId: input.applicationId,
        operation: "member-resource-association",
        actorPrincipalId: input.actor.principalId,
        targetPrincipalId: input.principalId,
        workspaceId: input.accountId,
      },
      command: input.command,
      canonicalPayload: input.payload,
    });
    if (begun.kind === "replay") return markAccountCommandReplay(begun.result as T);
    const result = input.action();
    completeCommand({
      db: input.db,
      scope: { applicationId: input.applicationId, operation: "member-resource-association" },
      command: input.command,
      result,
    });
    input.audit?.(result);
    return result;
  }) as SynchronousCallback<() => T>;
  return tx(input.db, transaction, "immediate");
}

/** Own the SQLite representation behind the shared account member/resource contract. */
// eslint-disable-next-line max-lines-per-function
export function createSqliteAccountMemberResourcePort(db: Db, options: PortOptions = {}): AccountMemberResourcePort {
  const applicationId = options.applicationId ?? "capacitylens";
  return {
    async listLinks(workspaceId) {
      return new Map(
        listAccountMemberResourceLinks(db, workspaceId).map(
          ({ userId, resourceId, revision, resourceName, resourceStatus }) => {
            const link = { resourceId, revision } as {
              resourceId: string;
              revision: string;
              resourceName?: string | null;
              resourceStatus?: "active" | "disabled" | "archived" | null;
            };
            if (resourceName !== undefined) link.resourceName = resourceName;
            if (resourceStatus !== undefined) link.resourceStatus = resourceStatus;
            return [userId, link] as const;
          },
        ),
      );
    },
    async listCandidates(workspaceId) {
      return db
        .prepare(
          `SELECT r.id AS resourceId, COALESCE(r.name, r.role) AS label
             FROM resources r
            WHERE r.accountId = ? AND r.kind = 'person' AND r.archivedAt IS NULL AND r.deletedAt IS NULL
            ORDER BY label, r.id`,
        )
        .all(workspaceId) as unknown as { resourceId: string; label: string }[];
    },
    async listExceptions(workspaceId) {
      return new Map(
        listMemberResourceLinkExceptions(db, workspaceId).map((exception) => [
          exception.userId,
          {
            proposedResourceId: exception.proposedResourceId,
            reason: exception.reason,
          },
        ]),
      );
    },
    async listAvatarProjection(workspaceId) {
      return listResourceAvatarProjection(db, workspaceId);
    },
    // eslint-disable-next-line max-lines-per-function
    async setLink({
      workspaceId,
      principalId,
      resourceId,
      expectedRevision,
      replacePrincipalId,
      replaceExpectedRevision,
      now,
      actor,
      command,
    }) {
      const save = () => {
        const mutation = setAccountMemberResourceLinkWithResult({
          db,
          accountId: workspaceId,
          userId: principalId,
          resourceId,
          expectedRevision,
          ...(replacePrincipalId ? { replacePrincipalId } : {}),
          ...(replaceExpectedRevision ? { replaceExpectedRevision } : {}),
          now,
        });
        return mutation;
      };
      const result = runCommand({
        db,
        applicationId,
        accountId: workspaceId,
        principalId,
        actor,
        command,
        payload: {
          operation: "link",
          workspaceId,
          principalId,
          resourceId,
          expectedRevision,
          replacePrincipalId: replacePrincipalId ?? null,
          replaceExpectedRevision: replaceExpectedRevision ?? null,
        },
        action: save,
        audit: (mutation) => {
          if (!mutation.changed) return;
          if (mutation.removed) {
            associationAudit({
              db,
              accountId: workspaceId,
              actor,
              principalId: mutation.removed.principalId,
              resourceId: mutation.removed.resourceId,
              revision: mutation.removed.revision,
              command,
              action: "memberResourceUnlink",
            });
          }
          associationAudit({
            db,
            accountId: workspaceId,
            actor,
            principalId,
            resourceId,
            revision: mutation.link.revision,
            ...((expectedRevision ?? mutation.removed?.revision)
              ? { previousRevision: expectedRevision ?? mutation.removed?.revision }
              : {}),
            command,
            action: expectedRevision === null ? "memberResourceLink" : "memberResourceChange",
          });
        },
      });
      const link = result.link;
      return { resourceId: link.resourceId, revision: link.revision };
    },
    async clearLink({ workspaceId, principalId, expectedRevision, actor, command }) {
      const clear = () => {
        const current = listAccountMemberResourceLinks(db, workspaceId).find((row) => row.userId === principalId);
        clearAccountMemberResourceLink({ db, accountId: workspaceId, userId: principalId, expectedRevision });
        return current?.resourceId ?? "unknown";
      };
      runCommand({
        db,
        applicationId,
        accountId: workspaceId,
        principalId,
        actor,
        command,
        payload: { operation: "unlink", workspaceId, principalId, expectedRevision },
        action: clear,
        audit: (resourceId) =>
          associationAudit({
            db,
            accountId: workspaceId,
            actor,
            principalId,
            resourceId,
            revision: expectedRevision,
            command,
            action: "memberResourceUnlink",
          }),
      });
    },
    async dismissException({ workspaceId, principalId, actor, command }) {
      runCommand({
        db,
        applicationId,
        accountId: workspaceId,
        principalId,
        actor,
        command,
        payload: { operation: "dismiss-exception", workspaceId, principalId },
        action: () => {
          removeMemberResourceLinkException(db, workspaceId, principalId);
        },
      });
    },
    reconcileImportedLinks({ workspaceId, resourceIdMap, updatedAt }) {
      reconcileAccountMemberResources({ db, accountId: workspaceId, resourceIdMap, updatedAt });
    },
    removeResourceLink(workspaceId, resourceId) {
      removeAccountMemberResourceForResource(db, workspaceId, resourceId);
    },
  };
}
