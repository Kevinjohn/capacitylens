/* eslint-disable max-lines-per-function, complexity, react-hooks/set-state-in-effect, no-nested-ternary */
import { useCallback, useEffect, useRef, useState } from "react";
import { m } from "@/i18n";
import { resolveErrorMessage } from "../../lib/errorMessage";
import { resolveRejectionMessage, teamAccessClient, type TeamAccessResult } from "../../account/teamAccessClient";
import { invalidateResourceAvatars } from "../../account/useResourceAvatars";
import { createMemberResourceCommandController } from "../../account/memberResourceCommandController";
import { useStore } from "../../store/useStore";

export interface MemberResourceLinkMutationInput {
  principalId: string;
  resourceId: string;
  expectedRevision: string | null;
  replacePrincipalId?: string;
  replaceExpectedRevision?: string;
}

interface MemberResourceLinkMutationOptions {
  workspaceId: string | null;
  contextKey: string;
  reload(): void | Promise<void>;
  reconcile?(): void | Promise<boolean | void>;
  onForbidden?(message: string): void;
  onSuccess?(): void;
  commandKey?: string;
}

interface MutationResult {
  kind: "ok" | "rejected" | "unknown" | "invalid" | "stale";
}

/**
 * The single member/resource command lifecycle shared by Team and Resources.
 * It owns the synchronous lock, context generation, reconciliation and projection refresh so a
 * surface cannot accidentally create a second version of the CAS/unknown-response state machine.
 */
export function useMemberResourceLinkMutation(options: MemberResourceLinkMutationOptions) {
  const [controller] = useState(createMemberResourceCommandController);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contextRef = useRef(options.contextKey);

  useEffect(() => {
    contextRef.current = options.contextKey;
    controller.invalidate();
    setPending(false);
    setError(null);
    return () => {
      controller.invalidate();
    };
  }, [controller, options.contextKey]);

  const execute = useCallback(
    async (key: string, request: () => Promise<TeamAccessResult<unknown>>): Promise<MutationResult> => {
      if (!options.workspaceId) return { kind: "stale" };
      const command = controller.begin(options.commandKey ?? key);
      if (!command) return { kind: "stale" };
      const contextKey = options.contextKey;
      if (contextRef.current !== contextKey) {
        command.release();
        return { kind: "stale" };
      }
      setPending(true);
      setError(null);
      let outcome: MutationResult = { kind: "stale" };
      let reconciled = false;
      const reconcileOnce = async (): Promise<void> => {
        if (reconciled) return;
        reconciled = true;
        await (options.reconcile ?? options.reload)();
      };
      try {
        const result = await request();
        if (!command.isCurrent() || contextRef.current !== contextKey) return outcome;
        outcome = { kind: result.kind };
        if (result.kind === "ok") {
          invalidateResourceAvatars();
          useStore.getState().invalidateMemberships();
          await options.reload();
          if (command.isCurrent() && contextRef.current === contextKey) options.onSuccess?.();
          return outcome;
        }
        const message =
          result.kind === "unknown" || result.kind === "invalid"
            ? m.settings_resource_member_unknown()
            : resolveRejectionMessage(result, m.settings_member_resource_error());
        setError(message);
        if (result.kind === "rejected" && result.status === 403) {
          const forbiddenMessage = m.settings_members_err_access_changed();
          useStore.getState().invalidateMemberships();
          useStore.getState().setNotice(forbiddenMessage, "error");
          options.onForbidden?.(forbiddenMessage);
          return outcome;
        }
        if (command.isCurrent() && contextRef.current === contextKey) {
          await reconcileOnce();
        }
        if (command.isCurrent() && contextRef.current === contextKey) useStore.getState().setNotice(message, "error");
        return outcome;
      } catch (cause: unknown) {
        if (!command.isCurrent() || contextRef.current !== contextKey) return outcome;
        outcome = { kind: "unknown" };
        setError(`${m.settings_member_resource_error()} ${resolveErrorMessage(cause)}`);
        if (command.isCurrent() && contextRef.current === contextKey) {
          await reconcileOnce();
        }
        if (command.isCurrent() && contextRef.current === contextKey)
          useStore.getState().setNotice(m.settings_member_resource_error(), "error");
        return outcome;
      } finally {
        if (command.isCurrent() && contextRef.current === contextKey) setPending(false);
        command.release();
      }
    },
    [controller, options],
  );

  const mutate = useCallback(
    (input: MemberResourceLinkMutationInput) => {
      const workspaceId = options.workspaceId;
      if (!workspaceId) return Promise.resolve({ kind: "stale" } as const);
      const expectedRevision = input.expectedRevision;
      const request = input.resourceId
        ? () => teamAccessClient.setMemberResourceLink({ workspaceId, ...input })
        : expectedRevision === null
          ? () => Promise.resolve({ kind: "ok", status: 204, value: true } satisfies TeamAccessResult<true>)
          : () => teamAccessClient.clearMemberResourceLink(workspaceId, input.principalId, expectedRevision);
      return execute(`link:${workspaceId}:${input.principalId}:${input.resourceId}`, request);
    },
    [execute, options],
  );
  const dismiss = useCallback(
    (principalId: string) => {
      const workspaceId = options.workspaceId;
      if (!workspaceId) return Promise.resolve({ kind: "stale" } as const);
      return execute(`dismiss:${workspaceId}:${principalId}`, () =>
        teamAccessClient.dismissMemberResourceLinkException(workspaceId, principalId),
      );
    },
    [execute, options],
  );

  return { pending, error, setError, mutate, dismiss, invalidate: controller.invalidate };
}
