import type { WorkQueueOptions } from "./workQueue";
import { describe, expect, it, vi } from "vitest";
import { BoundedWorkQueue, WorkQueueFullError } from "./workQueue";

function assertDeferredResolver<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error("Expected a deferred resolver to be registered");
  }
  return value;
}

function registerConstructorTests(registerTest: typeof it): void {
  interface WorkQueueBoundsInput {
    active: number;
    queued: number;
    options: WorkQueueOptions;
    message: RegExp;
  }

  registerTest.each([
    { active: 0, queued: 0, options: {}, message: /maxActive/ },
    { active: 1, queued: -1, options: {}, message: /maxQueued/ },
    { active: 1, queued: 0, options: { maxWaitMs: 0 }, message: /maxWaitMs/ },
  ] satisfies WorkQueueBoundsInput[])(
    "rejects invalid constructor bounds",
    ({ active, queued, options, message }: WorkQueueBoundsInput) => {
      expect(
        () => new BoundedWorkQueue({ maxActive: active, maxQueued: queued, fullMessage: "busy", options }),
      ).toThrow(message);
    },
  );
}

function registerFifoTest(registerTest: typeof it): void {
  registerTest("supports a zero-depth queue and preserves FIFO order after queued failure", async () => {
    const zeroDepth = new BoundedWorkQueue({ maxActive: 1, maxQueued: 0, fullMessage: "busy" });
    let release: (() => void) | undefined;
    const active = zeroDepth.run(() => new Promise<void>((resolve) => (release = resolve)));
    await expect(zeroDepth.run(async () => undefined)).rejects.toMatchObject({ reason: "full" });
    assertDeferredResolver(release)();
    await active;

    const queue = new BoundedWorkQueue({ maxActive: 1, maxQueued: 2, fullMessage: "busy" });
    const order: string[] = [];
    let firstRelease: (() => void) | undefined;
    const first = queue.run(() => new Promise<void>((resolve) => (firstRelease = resolve)));
    const failed = queue.run(async () => {
      order.push("failed");
      throw new Error("queued failure");
    });
    const last = queue.run(async () => order.push("last"));
    assertDeferredResolver(firstRelease)();
    await first;
    await expect(failed).rejects.toThrow("queued failure");
    await last;
    expect(order).toEqual(["failed", "last"]);
  });
}

function registerBoundsTest(registerTest: typeof it): void {
  registerTest("bounds active work, preserves the queue and refuses overflow", async () => {
    const queue = new BoundedWorkQueue({ maxActive: 2, maxQueued: 1, fullMessage: "busy" });
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

    assertDeferredResolver(releases.shift())();
    await expect(first).resolves.toBe(1);
    await Promise.resolve();
    expect(active).toBe(2);
    assertDeferredResolver(releases.shift())();
    assertDeferredResolver(releases.shift())();
    await expect(Promise.all([second, queued])).resolves.toEqual([2, 3]);
    expect(peak).toBe(2);
  });
}

function registerFailedWorkTest(registerTest: typeof it): void {
  registerTest("releases a slot after failed work", async () => {
    const queue = new BoundedWorkQueue({ maxActive: 1, maxQueued: 1, fullMessage: "busy" });
    await expect(
      queue.run(async () => {
        throw new Error("failed");
      }),
    ).rejects.toThrow("failed");
    await expect(queue.run(async () => "recovered")).resolves.toBe("recovered");
  });
}

function registerAbortWithdrawalTest(registerTest: typeof it): void {
  registerTest("withdraws aborted waiting work without running it or blocking a later caller", async () => {
    const queue = new BoundedWorkQueue({ maxActive: 1, maxQueued: 2, fullMessage: "busy" });
    let release: (() => void) | undefined;
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
    assertDeferredResolver(release)();

    await expect(Promise.all([active, useful])).resolves.toEqual(["active", "useful"]);
    expect(abandonedWork).not.toHaveBeenCalled();
    expect(usefulWork).toHaveBeenCalledOnce();
  });
}

function registerWaitTimeoutTest(registerTest: typeof it): void {
  registerTest("expires queued work and reports saturation exactly once", async () => {
    vi.useFakeTimers();
    try {
      const onSaturated = vi.fn();
      const queue = new BoundedWorkQueue({
        maxActive: 1,
        maxQueued: 1,
        fullMessage: "busy",
        options: {
          maxWaitMs: 100,
          onSaturated,
        },
      });
      let release: (() => void) | undefined;
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

      assertDeferredResolver(release)();
      await expect(active).resolves.toBe("active");
      await expect(queue.run(async () => "next")).resolves.toBe("next");
    } finally {
      vi.useRealTimers();
    }
  });
}

function registerAbortAfterDequeueTest(registerTest: typeof it): void {
  registerTest("ignores an abort that fires after its work already left the queue via dequeue", async () => {
    // Regression for the shared removeFromWaiting withdrawal: the dequeue-on-settle path (execute()'s
    // finally) already shifted this item out of `waiting` and removed its abort listener before we
    // call abort() below, so the abort handler must not fire at all — no reject, no double-settle, and
    // the now-running work must complete normally.
    const queue = new BoundedWorkQueue({ maxActive: 1, maxQueued: 1, fullMessage: "busy" });
    let releaseActive: (() => void) | undefined;
    const active = queue.run(() => new Promise<string>((resolve) => (releaseActive = () => resolve("active"))));
    const controller = new AbortController();
    let releaseQueued: (() => void) | undefined;
    const queuedWork = vi.fn(() => new Promise<string>((resolve) => (releaseQueued = () => resolve("queued"))));
    const queued = queue.run(queuedWork, controller.signal);

    assertDeferredResolver(releaseActive)();
    await active;
    expect(queuedWork).toHaveBeenCalledOnce();

    controller.abort(new Error("too late — already dequeued"));
    assertDeferredResolver(releaseQueued)();
    await expect(queued).resolves.toBe("queued");
  });
}

function registerTimerAfterDequeueTest(registerTest: typeof it): void {
  registerTest("ignores a wait timer that fires after its work already left the queue via dequeue", async () => {
    // Regression for the shared removeFromWaiting withdrawal: dequeue-on-settle clears the queued
    // item's wait timer as part of removing it (before this item ever gets a chance to time out), so
    // advancing fake timers past maxWaitMs afterward must not reject the now-running work.
    vi.useFakeTimers();
    try {
      const onSaturated = vi.fn();
      const queue = new BoundedWorkQueue({
        maxActive: 1,
        maxQueued: 1,
        fullMessage: "busy",
        options: { maxWaitMs: 100, onSaturated },
      });
      let releaseActive: (() => void) | undefined;
      const active = queue.run(() => new Promise<string>((resolve) => (releaseActive = () => resolve("active"))));
      let releaseQueued: (() => void) | undefined;
      const queuedWork = vi.fn(() => new Promise<string>((resolve) => (releaseQueued = () => resolve("queued"))));
      const queued = queue.run(queuedWork);

      assertDeferredResolver(releaseActive)();
      await active;
      expect(queuedWork).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(200);
      expect(onSaturated).not.toHaveBeenCalled();

      assertDeferredResolver(releaseQueued)();
      await expect(queued).resolves.toBe("queued");
    } finally {
      vi.useRealTimers();
    }
  });
}

function registerOverflowCancellationTest(registerTest: typeof it): void {
  registerTest("reports immediate overflow without double-reporting cancellation", async () => {
    const onSaturated = vi.fn();
    const queue = new BoundedWorkQueue({ maxActive: 1, maxQueued: 1, fullMessage: "busy", options: { onSaturated } });
    let release: (() => void) | undefined;
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
    assertDeferredResolver(release)();
    await active;
  });
}

describe("BoundedWorkQueue", () => {
  registerConstructorTests(it);
  registerFifoTest(it);
  registerBoundsTest(it);
  registerFailedWorkTest(it);
  registerAbortWithdrawalTest(it);
  registerWaitTimeoutTest(it);
  registerAbortAfterDequeueTest(it);
  registerTimerAfterDequeueTest(it);
  registerOverflowCancellationTest(it);
});
