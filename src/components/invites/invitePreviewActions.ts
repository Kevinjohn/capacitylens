import type { Dispatch, SetStateAction, RefObject } from "react";
import type { InviteAcceptState, InvitePreview } from "./InviteAcceptView";
import { m } from "@/i18n";
import type { AuthUser } from "../../auth/authContext";
import { accountClient } from "../../account/accountClient";
import { isServerConfigured } from "../../data/apiConfig";
import { readApiError } from "../../lib/readApiError";
import { resolveMessageForStatus, parsePreview } from "./inviteResponses";

interface Dependencies {
  token: string | undefined;
  previewed: RefObject<string | null>;
  currentUser: RefObject<AuthUser | null>;
  returnedWithExternalError: boolean;
  setPreview: Dispatch<SetStateAction<InvitePreview | null>>;
  setState: Dispatch<SetStateAction<InviteAcceptState>>;
}

function isPreviewCancelled(requestState: { cancelled: boolean }): boolean {
  return requestState.cancelled;
}

export function createInvitePreviewAction({
  token,
  previewed,
  currentUser,
  returnedWithExternalError,
  setPreview,
  setState,
}: Dependencies) {
  return () => {
    if (!isServerConfigured() || !token) return; // demo build / no token: nothing to preview
    const requestState = { cancelled: false };

    void (async () => {
      try {
        const previewResponse = await accountClient.previewInvitation(token);
        if (isPreviewCancelled(requestState)) return;
        if (!previewResponse.ok) {
          setState({
            kind: "error",
            message: resolveMessageForStatus(previewResponse.status, await readApiError(previewResponse)),
          });
          return;
        }
        const parsedPreview = parsePreview(await previewResponse.json().catch(() => null));
        if (isPreviewCancelled(requestState)) return;
        if (!parsedPreview) {
          setState({ kind: "error", message: m.invite_err_preview_invalid() });
          return;
        }
        previewed.current = token;
        setPreview(parsedPreview);
        setState(
          currentUser.current
            ? { kind: "ready" }
            : {
                kind: "auth",
                ...(returnedWithExternalError ? { message: m.login_sso_failed() } : {}),
              },
        );
      } catch (err) {
        if (isPreviewCancelled(requestState)) return;
        // Preview is read-only, so a transport failure cannot have consumed the invite. Keep this
        // distinct from an accept failure, whose outcome may genuinely be unknown.
        console.error("InviteAccept: preview request failed", err);
        setState({
          kind: "error",
          message: m.invite_err_network(),
          retryPreview: true,
        });
      }
    })();
    return () => {
      requestState.cancelled = true;
    };
  };
}
