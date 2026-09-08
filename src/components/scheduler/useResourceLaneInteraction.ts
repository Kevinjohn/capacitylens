import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import type { ID, ISODate } from "@capacitylens/shared/types/entities";
import type { ColumnGeometry } from "./columnGeometry";
import type { DayState } from "./schedulerModel";

const DRAW_THRESHOLD_PX = 4;
type DrawSpan = { a: number; b: number };
interface LaneInput {
  resourceId: ID;
  days: ISODate[];
  dayStates: DayState[];
  geometry: ColumnGeometry;
  onDraw?: (resourceId: ID, startDate: ISODate, endDate: ISODate) => void;
}
interface GestureInput extends LaneInput {
  event: ReactPointerEvent;
  indexAt: (x: number) => number;
  setDraw: (value: DrawSpan | null | ((previous: DrawSpan | null) => DrawSpan | null)) => void;
  teardownRef: RefObject<(() => void) | null>;
}

function finishGesture(input: GestureInput, start: { index: number; clientX: number }, event: PointerEvent) {
  if (!input.onDraw) return;
  if (Math.abs(event.clientX - start.clientX) < DRAW_THRESHOLD_PX) {
    const day = input.days[start.index];
    if (day) input.onDraw(input.resourceId, day, day);
    return;
  }
  const end = input.indexAt(event.clientX);
  const startDay = input.days[Math.min(start.index, end)];
  const endDay = input.days[Math.max(start.index, end)];
  if (startDay && endDay) input.onDraw(input.resourceId, startDay, endDay);
}

function beginGesture(input: GestureInput) {
  const { event, indexAt, setDraw, teardownRef } = input;
  if (!input.onDraw || event.button !== 0 || teardownRef.current) return;
  const isOtherPointer = (next: PointerEvent) => Number.isFinite(next.pointerId) && next.pointerId !== event.pointerId;
  const startX = event.clientX;
  const start = indexAt(startX);
  if (input.dayStates[start]?.creationBlocked) return;
  setDraw({ a: start, b: start });
  const onMove = (next: PointerEvent) => {
    if (isOtherPointer(next)) return;
    const end = indexAt(next.clientX);
    setDraw((previous) => (previous?.b === end ? previous : { a: start, b: end }));
  };
  const detach = () => {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onCancel);
    document.removeEventListener("keydown", onKeyDown);
    teardownRef.current = null;
  };
  const cancel = () => {
    detach();
    setDraw(null);
  };
  const onUp = (next: PointerEvent) => {
    if (isOtherPointer(next)) return;
    cancel();
    finishGesture(input, { index: start, clientX: startX }, next);
  };
  const onCancel = (next: PointerEvent) => {
    if (!isOtherPointer(next)) cancel();
  };
  const onKeyDown = (next: KeyboardEvent) => {
    if (next.key === "Escape") cancel();
  };
  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
  document.addEventListener("pointercancel", onCancel);
  document.addEventListener("keydown", onKeyDown);
  teardownRef.current = detach;
}

export function useResourceLaneInteraction(input: LaneInput) {
  const laneRef = useRef<HTMLDivElement>(null);
  const [draw, setDraw] = useState<DrawSpan | null>(null);
  const [hoverDay, setHoverDay] = useState<number | null>(null);
  const teardownRef = useRef<(() => void) | null>(null);
  useEffect(() => () => teardownRef.current?.(), []);
  const indexAt = useCallback(
    (clientX: number) => {
      const rect = laneRef.current?.getBoundingClientRect();
      return rect ? input.geometry.indexAt(clientX - rect.left) : 0;
    },
    [input.geometry],
  );
  const onPointerDown = (event: ReactPointerEvent) => beginGesture({ ...input, event, indexAt, setDraw, teardownRef });
  const onPointerMove = (event: ReactPointerEvent) => {
    if (!input.onDraw || event.pointerType !== "mouse" || event.buttons !== 0) return;
    const index = indexAt(event.clientX);
    if (input.dayStates[index]?.creationBlocked) {
      setHoverDay(null);
      return;
    }
    setHoverDay((previous) => (previous === index ? previous : index));
  };
  const onPointerUpCapture = (event: ReactPointerEvent) => {
    if (input.onDraw && event.pointerType === "mouse") setHoverDay(null);
  };
  return { laneRef, draw, hoverDay, indexAt, onPointerDown, onPointerMove, onPointerUpCapture, setHoverDay };
}
