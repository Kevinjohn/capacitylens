import { useCallback, useEffect, useRef, useState } from "react";
import { parseResourceAvatarUrl } from "@capacitylens/shared/domain/resourceAvatarUrl";
import { accountClient } from "./accountClient";
import { isServerConfigured } from "../data/apiConfig";
import { useStore } from "../store/useStore";
import { useOfflineState } from "../data/useOfflineState";
import { useAuth } from "../auth/authContext";

const EMPTY_AVATARS = new Map<string, string>();
/** Page-local event emitted when the authoritative member/resource association may have changed. */
export const RESOURCE_AVATARS_INVALIDATED = "capacitylens:resource-avatars-invalidated";

/** Notify mounted scheduler projections that a link or identity image may have changed. */
export function invalidateResourceAvatars(): void {
  window.dispatchEvent(new Event(RESOURCE_AVATARS_INVALIDATED));
}

function parseProjection(body: unknown): ReadonlyMap<string, string> {
  if (!body || typeof body !== "object" || !Array.isArray((body as { avatars?: unknown }).avatars))
    throw new Error("Resource avatars returned an invalid response.");
  const next = new Map<string, string>();
  for (const row of (body as { avatars: unknown[] }).avatars) {
    if (!row || typeof row !== "object") throw new Error("Resource avatars returned an invalid row.");
    const { resourceId, imageUrl } = row as Record<string, unknown>;
    const parsed = parseResourceAvatarUrl(imageUrl);
    if (typeof resourceId !== "string" || !resourceId || !parsed.ok || !parsed.value)
      throw new Error("Resource avatars returned an unsafe row.");
    next.set(resourceId, parsed.value);
  }
  return next;
}

/** Load the narrow identity projection and discard it immediately across account/session/offline boundaries. */
export function useResourceAvatars(accountId: string | null): ReadonlyMap<string, string> {
  const membershipRevision = useStore((state) => state.membershipRevision);
  const accountData = useStore((state) => state.data);
  const offline = useOfflineState();
  const { user } = useAuth();
  const boundary = `${accountId ?? ""}\u0000${membershipRevision}\u0000${user?.id ?? ""}\u0000${user?.image ?? ""}\u0000${offline.readOnly}`;
  const [renderedBoundary, setRenderedBoundary] = useState(boundary);
  const [projection, setProjection] = useState<{ accountId: string; avatars: ReadonlyMap<string, string> } | null>(
    null,
  );
  const requestEpoch = useRef(0);
  if (renderedBoundary !== boundary) {
    setRenderedBoundary(boundary);
    setProjection(null);
  }
  const refresh = useCallback(() => {
    const epoch = ++requestEpoch.current;
    setProjection(null);
    if (!accountId || !isServerConfigured() || offline.readOnly || !navigator.onLine) return;
    void accountClient
      .listResourceAvatars(accountId)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Resource avatars returned ${response.status}.`);
        const avatars = parseProjection(await response.json());
        if (requestEpoch.current === epoch) setProjection({ accountId, avatars });
      })
      .catch((error: unknown) => {
        if (requestEpoch.current === epoch) console.error("Could not load scheduled-person avatars", error);
      });
  }, [accountId, offline.readOnly]);

  useEffect(() => {
    void Promise.resolve().then(refresh);
    const onOffline = () => {
      requestEpoch.current += 1;
      setProjection(null);
    };
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("offline", onOffline);
    window.addEventListener(RESOURCE_AVATARS_INVALIDATED, refresh);
    return () => {
      requestEpoch.current += 1;
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener(RESOURCE_AVATARS_INVALIDATED, refresh);
    };
  }, [refresh, membershipRevision, user, accountData]);
  return renderedBoundary === boundary && projection?.accountId === accountId ? projection.avatars : EMPTY_AVATARS;
}
