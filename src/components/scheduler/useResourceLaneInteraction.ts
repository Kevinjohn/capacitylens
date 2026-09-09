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
interface GestureInput {
  event: ReactPointerEvent;
  laneRef: RefObject<HTMLDivElement | null>;
  latestInputRef: RefObject<LaneInput>;
  semanticGenerationRef: RefObject<number>;
  setDraw: (value: DrawSpan | null | ((previous: DrawSpan | null) => DrawSpan | null)) => void;
  teardownRef: RefObject<(() => void) | null>;
}

function resolveCurrentIndex(input: LaneInput, laneRef: RefObject<HTMLDivElement | null>, clientX: number): number {
  const rect = laneRef.current?.getBoundingClientRect();
  return rect ? input.geometry.indexAt(clientX - rect.left) : 0;
}

function finishGesture(
  input: LaneInput,
  gesture: { laneRef: RefObject<HTMLDivElement | null>; startX: number; event: PointerEvent },
) {
  const { laneRef, startX, event } = gesture;
  if (!input.onDraw) return;
  const startIndex = resolveCurrentIndex(input, laneRef, startX);
  if (input.dayStates[startIndex]?.creationBlocked) return;
  if (Math.abs(event.clientX - startX) < DRAW_THRESHOLD_PX) {
    const day = input.days[startIndex];
    if (day) input.onDraw(input.resourceId, day, day);
    return;
  }
  const end = resolveCurrentIndex(input, laneRef, event.clientX);
  const startDay = input.days[Math.min(startIndex, end)];
  const endDay = input.days[Math.max(startIndex, end)];
  if (startDay && endDay) input.onDraw(input.resourceId, startDay, endDay);
}

function beginGesture(input: GestureInput) {
  const { event, laneRef, latestInputRef, semanticGenerationRef, setDraw, teardownRef } = input;
  const laneInput = latestInputRef.current;
  if (!laneInput.onDraw || event.button !== 0 || teardownRef.current) return;
  const isOtherPointer = (next: PointerEvent) => Number.isFinite(next.pointerId) && next.pointerId !== event.pointerId;
  const startX = event.clientX;
  const startGeneration = semanticGenerationRef.current;
  const startIndex = resolveCurrentIndex(laneInput, laneRef, startX);
  if (laneInput.dayStates[startIndex]?.creationBlocked) return;
  setDraw({ a: startIndex, b: startIndex });
  const onMove = (next: PointerEvent) => {
    if (isOtherPointer(next)) return;
    if (semanticGenerationRef.current !== startGeneration) return cancel();
    const end = resolveCurrentIndex(latestInputRef.current, laneRef, next.clientX);
    setDraw((previous) => (previous?.b === end ? previous : { a: startIndex, b: end }));
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
    if (semanticGenerationRef.current !== startGeneration) return;
    finishGesture(latestInputRef.current, { laneRef, startX, event: next });
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
  const latestInputRef = useRef(input);
  const semanticGenerationRef = useRef(0);
  useEffect(() => {
    latestInputRef.current = input;
  }, [input]);
  useEffect(() => {
    semanticGenerationRef.current += 1;
  }, [input.days, input.geometry, input.resourceId]);
  useEffect(() => () => teardownRef.current?.(), []);
  const indexAt = useCallback(
    (clientX: number) => {
      const rect = laneRef.current?.getBoundingClientRect();
      return rect ? input.geometry.indexAt(clientX - rect.left) : 0;
    },
    [input.geometry],
  );
  const onPointerDown = (event: ReactPointerEvent) =>
    beginGesture({ event, laneRef, latestInputRef, semanticGenerationRef, setDraw, teardownRef });
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
