import {
  BatchCommitUncertainError,
  BatchConflictError,
  BatchTooLargeError,
  BatchValidationError,
  KeepaliveNotDispatchedError,
} from "./ServerSyncAdapter";
import { domainErrorMessage } from "../lib/errorMessage";
import { m } from "@/i18n";

/** Return the sticky, actionable notice for a typed persistence failure, if it needs one. */
export function persistenceErrorNotice(error: unknown): string | null {
  if (error instanceof BatchConflictError) return m.notice_sync_conflict();
  if (error instanceof BatchCommitUncertainError)
    return m.notice_sync_receipt_uncertain();
  if (error instanceof BatchValidationError && error.code)
    return domainErrorMessage(error.code);
  if (error instanceof BatchTooLargeError) return m.notice_sync_too_large();
  if (error instanceof KeepaliveNotDispatchedError)
    return m.notice_sync_keepalive_not_dispatched();
  return null;
}
