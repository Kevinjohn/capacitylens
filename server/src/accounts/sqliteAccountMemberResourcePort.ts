import type { AccountMemberResourcePort } from "@capacitylens/shared/account/ports";
import type { CommandIdentity } from "@capacitylens/shared/account/types";
import type { Db } from "../db";
import { AccountContractError } from "@capacitylens/shared/account/errors";
import { enqueueAudit } from "../auditOutbox";
import { beginCommand, completeCommand, markAccountCommandReplay } from "./commands";
import { tx, type SynchronousCallback } from "../txn";
import {
  clearAccountMemberResourceLink,
  listAccountMemberResourceLinks,
  listResourceAvatarProjection,
  reconcileAccountMemberResources,
  removeAccountMemberResourceForResource,
  setAccountMemberResourceLinkWithResult,
} from "../controlTables/accountMemberResources";
import type { AuditRecord } from "../audit";

interface PortOptions {
  applicationId?: string;
}

function assertAssociationAuthority(input: {
  db: Db;
  accountId: string;
  actorPrincipalId: string;
  command: CommandIdentity;
}) {
  const { db, accountId, actorPrincipalId, command } = input;
  const member = actorPrincipalId
    ? (db
        .prepare(`SELECT role, status FROM account_members WHERE accountId = ? AND userId = ?`)
        .get(accountId, actorPrincipalId) as { role?: unknown; status?: unknown } | undefined)
    : undefined;
  if (member?.status !== "active" || (member.role !== "owner" && member.role !== "admin")) {
    throw new AccountContractError({
      code: "FORBIDDEN",
      message: "Only an active Owner or Admin may manage schedule links.",
      retryable: false,
      commandId: command.commandId,
    });
  }
}

function associationAudit(input: {
  action: "memberResourceLink" | "memberResourceChange" | "memberResourceUnlink";
  db: Db;
  accountId: string;
  actorPrincipalId: string;
  principalId: string;
  resourceId: string;
  command: CommandIdentity;
}): void {
  const record: AuditRecord = {
    ts: new Date().toISOString(),
    userId: input.actorPrincipalId,
    accountId: input.accountId,
    action: input.action,
    entity: "account_member_resources",
    id: `${input.accountId}:${input.principalId}:${input.resourceId}`,
    changedFields: ["resourceId", "principalId"],
  };
  enqueueAudit(input.db, record, `${input.command.commandId}:${input.action}:${record.id}`);
}

function runCommand<T>(input: {
  db: Db;
  applicationId: string;
  accountId: string;
  principalId: string;
  actorPrincipalId: string;
  command: CommandIdentity;
  payload: unknown;
  action: () => T;
  audit?: (result: T) => void;
}): T {
  const transaction = (() => {
    assertAssociationAuthority({
      db: input.db,
      accountId: input.accountId,
      actorPrincipalId: input.actorPrincipalId,
      command: input.command,
    });
    const begun = beginCommand({
      db: input.db,
      scope: {
        applicationId: input.applicationId,
        operation: "member-resource-association",
        actorPrincipalId: input.actorPrincipalId,
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
    async listAvatarProjection(workspaceId) {
      return listResourceAvatarProjection(db, workspaceId);
    },
    async setLink({ workspaceId, principalId, resourceId, expectedRevision, now, actorPrincipalId, command }) {
      const save = () => {
        const mutation = setAccountMemberResourceLinkWithResult({
          db,
          accountId: workspaceId,
          userId: principalId,
          resourceId,
          expectedRevision,
          now,
        });
        return mutation;
      };
      const result = runCommand({
        db,
        applicationId,
        accountId: workspaceId,
        principalId,
        actorPrincipalId,
        command,
        payload: { operation: "link", workspaceId, principalId, resourceId, expectedRevision },
        action: save,
        audit: (mutation) => {
          if (!mutation.changed) return;
          associationAudit({
            db,
            accountId: workspaceId,
            actorPrincipalId,
            principalId,
            resourceId,
            command,
            action: expectedRevision === null ? "memberResourceLink" : "memberResourceChange",
          });
        },
      });
      const link = result.link;
      return { resourceId: link.resourceId, revision: link.revision };
    },
    async clearLink({ workspaceId, principalId, expectedRevision, actorPrincipalId, command }) {
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
        actorPrincipalId,
        command,
        payload: { operation: "unlink", workspaceId, principalId, expectedRevision },
        action: clear,
        audit: (resourceId) =>
          associationAudit({
            db,
            accountId: workspaceId,
            actorPrincipalId,
            principalId,
            resourceId,
            command,
            action: "memberResourceUnlink",
          }),
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
