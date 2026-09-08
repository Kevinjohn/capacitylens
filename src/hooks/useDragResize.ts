import { useCallback, useEffect, useRef } from "react";
import { type DragMode } from "../lib/gestureMath";

// Thin DOM wrapper over the pure gestureMath. Mode comes from a `data-handle` on
// the pressed element (resize grips) or defaults to 'move'. During the gesture it
// reports a horizontal day-delta plus a raw vertical pixel-delta (for cross-row
// drag preview); on pointerup it commits once and passes the drop coordinates so
// the caller can resolve a target row. A sub-threshold gesture is a click.
// Listeners are torn down on unmount so an interrupted drag can't commit stale.

export interface Pointer {
  clientX: number;
  clientY: number;
}

export interface DragResizePreviewInput {
  mode: DragMode;
  deltaDays: number;
  deltaY: number;
  pointer: Pointer;
}

export interface UseDragResizeArgs {
  /** Maps a document clientX to a snapped day index (the ColumnGeometry inverse, applied
   *  against the live lane rect — supplied by the lane). The day delta is the difference of
   *  the two endpoints' indices, so each end snaps to a column independently — correct even
   *  when the pointer crosses narrowed weekend columns of unequal width. */
  indexAtClientX: (clientX: number) => number;
  onPreview: (input: DragResizePreviewInput) => void;
  onCommit: (mode: DragMode, deltaDays: number, pointer: Pointer) => void;
  onClick?: () => void;
  /** Pointer was cancelled mid-gesture (e.g. the browser took over for scrolling). */
  onCancel?: () => void;
  threshold?: number;
}

interface GestureState {
  argsRef: { current: UseDragResizeArgs };
  teardownRef: { current: (() => void) | null };
  mode: DragMode;
  startX: number;
  startY: number;
  pointerId: number;
  captureTarget: GestureCaptureTarget;
  threshold: number;
}

type GesturePointerEvent = Omit<PointerEvent, "pointerId"> & { readonly pointerId?: number };
type GestureCaptureTarget = Omit<HTMLElement, "hasPointerCapture" | "setPointerCapture"> & {
  hasPointerCapture?: HTMLElement["hasPointerCapture"];
  setPointerCapture?: HTMLElement["setPointerCapture"];
};

function getDragMode(handle: string | undefined): DragMode {
  if (handle === "start") return "resize-start";
  if (handle === "end") return "resize-end";
  return "move";
}

function createGestureHandlers(state: GestureState) {
  const { argsRef, teardownRef, mode, startX, startY, pointerId, captureTarget, threshold } = state;
  let dragging = false;
  // Synthetic/older events can omit pointerId; treat those as the active pointer.
  const isOtherPointer = (event: GesturePointerEvent) => event.pointerId !== undefined && event.pointerId !== pointerId;

  // NOTE: the day delta is `indexAtClientX(here) - indexAtClientX(start)`. The
  // divide-by-zero / out-of-range guarding lives in the PURE ColumnGeometry.indexAt (it's
  // total and never returns NaN). This hook intentionally stays guard-free — do NOT wrap
  // these pure calls in try/catch (the guard belongs in the geometry layer). The 4px
  // arm-vs-click test below stays a RAW pixel test, independent of the day snapping.
  const onMove = (event: GesturePointerEvent) => {
    if (isOtherPointer(event)) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!dragging && Math.max(Math.abs(dx), Math.abs(dy)) < threshold) return;
    dragging = true;
    const deltaDays = argsRef.current.indexAtClientX(event.clientX) - argsRef.current.indexAtClientX(startX);
    argsRef.current.onPreview({
      mode,
      deltaDays,
      deltaY: dy,
      pointer: { clientX: event.clientX, clientY: event.clientY },
    });
  };
  const detach = () => {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onCancel);
    document.removeEventListener("keydown", onKeyDown);
    captureTarget.removeEventListener("lostpointercapture", onLostPointerCapture);
    if (captureTarget.hasPointerCapture?.(pointerId)) captureTarget.releasePointerCapture(pointerId);
    teardownRef.current = null;
  };
  // THE abandon path, shared by all three ways a gesture can end without committing (pointer
  // cancel, lost capture, Escape). Notify even on a SUB-THRESHOLD abandon: the gesture was armed
  // at pointerdown, so the consumer may have started a side effect (e.g. a document scroll
  // watcher) whose only teardown signal on these paths is onCancel. Skipping it orphans that
  // listener for every twitch-then-browser-scroll, accumulating across gestures.
  const abort = () => {
    detach();
    argsRef.current.onCancel?.();
  };
  const onUp = (event: GesturePointerEvent) => {
    if (isOtherPointer(event)) return;
    // A mouse shares one pointerId across all buttons. Releasing a secondary button while the
    // primary drag remains held must neither commit nor cancel the armed primary gesture.
    if (event.button !== 0) return;
    detach();
    if (!dragging) {
      argsRef.current.onClick?.();
      return;
    }
    const deltaDays = argsRef.current.indexAtClientX(event.clientX) - argsRef.current.indexAtClientX(startX);
    argsRef.current.onCommit(mode, deltaDays, { clientX: event.clientX, clientY: event.clientY });
  };
  const onCancel = (event: GesturePointerEvent) => {
    if (isOtherPointer(event)) return;
    abort();
  };
  const onLostPointerCapture = () => abort();
  // Keyboard escape hatch: a pointer-only gesture has no way to back out once armed (a
  // resize/move drag has no native "cancel" gesture). Escape takes the same abandon path
  // rather than committing whatever the last preview was.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    abort();
  };
  return { onMove, onUp, onCancel, onKeyDown, onLostPointerCapture, detach };
}

export function useDragResize(args: UseDragResizeArgs) {
  const argsRef = useRef(args);
  useEffect(() => {
    argsRef.current = args;
  });

  const teardownRef = useRef<(() => void) | null>(null);
  useEffect(() => () => teardownRef.current?.(), []);

  // Returns true when the gesture was ARMED (listeners attached), false when the
  // pointerdown was ignored (non-left button or re-entrant). The caller uses this to
  // avoid starting side effects (e.g. a scroll watcher) for a gesture that never runs
  // — those have no onCommit/onCancel/onClick to tear them back down.
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>): boolean => {
    if (e.button !== 0) return false;
    e.stopPropagation(); // don't let the lane start a draw-to-create gesture
    // Ignore a re-entrant pointerdown (a second finger / pen) while a gesture is
    // already live — otherwise its document listeners would leak and a single
    // pointerup could commit twice.
    if (teardownRef.current) return false;

    const mode = getDragMode((e.target as HTMLElement).dataset.handle);
    const captureTarget: GestureCaptureTarget = e.currentTarget;
    const pointerId = e.pointerId; // only react to THIS pointer's move/up/cancel
    const handlers = createGestureHandlers({
      argsRef,
      teardownRef,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      pointerId,
      captureTarget,
      threshold: argsRef.current.threshold ?? 4,
    });
    const { onMove, onUp, onCancel, onKeyDown, onLostPointerCapture, detach } = handlers;

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
    document.addEventListener("keydown", onKeyDown);
    captureTarget.addEventListener("lostpointercapture", onLostPointerCapture);
    captureTarget.setPointerCapture?.(pointerId);
    teardownRef.current = detach;
    return true;
  }, []);

  return { onPointerDown };
}
