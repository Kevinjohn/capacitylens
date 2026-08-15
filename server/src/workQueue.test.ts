import { describe, expect, it, vi } from "vitest";
import { BoundedWorkQueue, WorkQueueFullError } from "./workQueue";

describe("BoundedWorkQueue", () => {
  it.each([
    [0, 0, {}, /maxActive/],
    [1, -1, {}, /maxQueued/],
    [1, 0, { maxWaitMs: 0 }, /maxWaitMs/],
  ] as const)("rejects invalid constructor bounds", (active, queued, options, message) => {
    expect(() => new BoundedWorkQueue(active, queued, "busy", options)).toThrow(message);
  });

  it("supports a zero-depth queue and preserves FIFO order after queued failure", async () => {
    const zeroDepth = new BoundedWorkQueue(1, 0, "busy");
    let release!: () => void;
    const active = zeroDepth.run(() => new Promise<void>((resolve) => (release = resolve)));
    await expect(zeroDepth.run(async () => undefined)).rejects.toMatchObject({ reason: "full" });
    release();
    await active;

    const queue = new BoundedWorkQueue(1, 2, "busy");
    const order: string[] = [];
    let firstRelease!: () => void;
    const first = queue.run(() => new Promise<void>((resolve) => (firstRelease = resolve)));
    const failed = queue.run(async () => {
      order.push("failed");
      throw new Error("queued failure");
    });
    const last = queue.run(async () => order.push("last"));
    firstRelease();
    await first;
    await expect(failed).rejects.toThrow("queued failure");
    await last;
    expect(order).toEqual(["failed", "last"]);
  });
  it("bounds active work, preserves the queue and refuses overflow", async () => {
    const queue = new BoundedWorkQueue(2, 1, "busy");
    const releases: (() => void)[] = [];
    let active = 0;
    let peak = 0;
    const work = (value: number) =>
      queue.run(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        active -= 1;
        return value;
      });

    const first = work(1);
    const second = work(2);
    const queued = work(3);
    await expect(work(4)).rejects.toBeInstanceOf(WorkQueueFullError);
    expect(active).toBe(2);
    expect(peak).toBe(2);

    releases.shift()!();
    await expect(first).resolves.toBe(1);
    await Promise.resolve();
    expect(active).toBe(2);
    releases.shift()!();
    releases.shift()!();
    await expect(Promise.all([second, queued])).resolves.toEqual([2, 3]);
    expect(peak).toBe(2);
  });

  it("releases a slot after failed work", async () => {
    const queue = new BoundedWorkQueue(1, 1, "busy");
    await expect(
      queue.run(async () => {
        throw new Error("failed");
      }),
    ).rejects.toThrow("failed");
    await expect(queue.run(async () => "recovered")).resolves.toBe("recovered");
  });

  it("withdraws aborted waiting work without running it or blocking a later caller", async () => {
    const queue = new BoundedWorkQueue(1, 2, "busy");
    let release!: () => void;
    const active = queue.run(
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve("active");
        }),
    );
    const controller = new AbortController();
    const abandonedWork = vi.fn(async () => "abandoned");
    const abandoned = queue.run(abandonedWork, controller.signal);
    const usefulWork = vi.fn(async () => "useful");
    const useful = queue.run(usefulWork);

    controller.abort(new Error("request gone"));
    await expect(abandoned).rejects.toThrow("request gone");
    release();

    await expect(Promise.all([active, useful])).resolves.toEqual(["active", "useful"]);
    expect(abandonedWork).not.toHaveBeenCalled();
    expect(usefulWork).toHaveBeenCalledOnce();
  });

  it("expires queued work and reports saturation exactly once", async () => {
    vi.useFakeTimers();
    try {
      const onSaturated = vi.fn();
      const queue = new BoundedWorkQueue(1, 1, "busy", {
        maxWaitMs: 100,
        onSaturated,
      });
      let release!: () => void;
      const active = queue.run(
        () =>
          new Promise<string>((resolve) => {
            release = () => resolve("active");
          }),
      );
      const waitingWork = vi.fn(async () => "late");
      const waiting = queue.run(waitingWork);
      const rejection = expect(waiting).rejects.toMatchObject({
        name: "WorkQueueFullError",
        reason: "wait_timeout",
      });

      await vi.advanceTimersByTimeAsync(100);
      await rejection;
      expect(onSaturated).toHaveBeenCalledOnce();
      expect(onSaturated).toHaveBeenCalledWith("wait_timeout");
      expect(waitingWork).not.toHaveBeenCalled();

      release();
      await expect(active).resolves.toBe("active");
      await expect(queue.run(async () => "next")).resolves.toBe("next");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores an abort that fires after its work already left the queue via dequeue", async () => {
    // Regression for the shared removeFromWaiting withdrawal: the dequeue-on-settle path (execute()'s
    // finally) already shifted this item out of `waiting` and removed its abort listener before we
    // call abort() below, so the abort handler must not fire at all — no reject, no double-settle,
    // and the now-running work must complete normally.
    const queue = new BoundedWorkQueue(1, 1, "busy");
    let releaseActive!: () => void;
    const active = queue.run(() => new Promise<string>((resolve) => (releaseActive = () => resolve("active"))));
    const controller = new AbortController();
    let releaseQueued!: () => void;
    const queuedWork = vi.fn(() => new Promise<string>((resolve) => (releaseQueued = () => resolve("queued"))));
    const queued = queue.run(queuedWork, controller.signal);

    releaseActive();
    await active;
    expect(queuedWork).toHaveBeenCalledOnce();

    controller.abort(new Error("too late — already dequeued"));
    releaseQueued();
    await expect(queued).resolves.toBe("queued");
  });

  it("ignores a wait timer that fires after its work already left the queue via dequeue", async () => {
    // Regression for the shared removeFromWaiting withdrawal: dequeue-on-settle clears the queued
    // item's wait timer as part of removing it (before this item ever gets a chance to time out), so
    // advancing fake timers past maxWaitMs afterward must not reject the now-running work.
    vi.useFakeTimers();
    try {
      const onSaturated = vi.fn();
      const queue = new BoundedWorkQueue(1, 1, "busy", { maxWaitMs: 100, onSaturated });
      let releaseActive!: () => void;
      const active = queue.run(() => new Promise<string>((resolve) => (releaseActive = () => resolve("active"))));
      let releaseQueued!: () => void;
      const queuedWork = vi.fn(() => new Promise<string>((resolve) => (releaseQueued = () => resolve("queued"))));
      const queued = queue.run(queuedWork);

      releaseActive();
      await active;
      expect(queuedWork).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(200);
      expect(onSaturated).not.toHaveBeenCalled();

      releaseQueued();
      await expect(queued).resolves.toBe("queued");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports immediate overflow without double-reporting cancellation", async () => {
    const onSaturated = vi.fn();
    const queue = new BoundedWorkQueue(1, 1, "busy", { onSaturated });
    let release!: () => void;
    const active = queue.run(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const controller = new AbortController();
    const cancelled = queue.run(async () => undefined, controller.signal);

    await expect(queue.run(async () => undefined)).rejects.toMatchObject({
      reason: "full",
    });
    expect(onSaturated).toHaveBeenCalledOnce();
    expect(onSaturated).toHaveBeenCalledWith("full");

    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    expect(onSaturated).toHaveBeenCalledOnce();
    release();
    await active;
  });
});
