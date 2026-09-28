import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { authTransactionGateFor, type GateSlot } from "./authTransactionGate";

const openSlot = (): GateSlot => ({ held: false, closed: false });
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

describe("authentication transaction gate", () => {
  it("runs a library transaction only after in-flight requests finish, and holds new ones behind it", async () => {
    const gate = authTransactionGateFor(new DatabaseSync(":memory:"));
    const events: string[] = [];
    const inFlight = openSlot();
    await gate.enter(inFlight);

    const libraryDone = deferred();
    const library = gate.runExclusive(async () => {
      events.push("library start");
      await libraryDone.promise;
      events.push("library end");
    });
    const arriving = openSlot();
    const arrival = gate.enter(arriving).then(() => events.push("new request"));

    await turn();
    expect(events).toEqual([]);
    gate.release(inFlight);
    await turn();
    expect(events).toEqual(["library start"]);
    libraryDone.resolve();
    await Promise.all([library, arrival]);
    expect(events).toEqual(["library start", "library end", "new request"]);
    gate.release(arriving);
  });

  it("lets a request that reaches the library yield its own slot and take it back", async () => {
    const gate = authTransactionGateFor(new DatabaseSync(":memory:"));
    const slot = openSlot();
    await gate.enter(slot);

    await gate.runInSlot(slot, () => gate.runExclusive(async () => expect(slot.held).toBe(false)));
    expect(slot.held).toBe(true);
    gate.release(slot);
    await expect(gate.runExclusive(async () => "alone")).resolves.toBe("alone");
  });
});

describe("authentication transaction gate slots", () => {
  it("returns a slot granted after its request already closed", async () => {
    const gate = authTransactionGateFor(new DatabaseSync(":memory:"));
    const libraryDone = deferred();
    const library = gate.runExclusive(() => libraryDone.promise);
    const abandoned = openSlot();
    const waiting = gate.enter(abandoned);
    gate.release(abandoned);
    libraryDone.resolve();
    await Promise.all([library, waiting]);

    expect(abandoned.held).toBe(false);
    await expect(gate.runExclusive(async () => "not blocked")).resolves.toBe("not blocked");
  });

  it("holds background writers behind a library transaction", async () => {
    const gate = authTransactionGateFor(new DatabaseSync(":memory:"));
    const events: string[] = [];
    const libraryDone = deferred();
    const library = gate.runExclusive(async () => {
      await libraryDone.promise;
      events.push("library");
    });
    const background = gate.runShared(() => events.push("background"));
    await turn();
    expect(events).toEqual([]);
    libraryDone.resolve();
    await Promise.all([library, background]);
    expect(events).toEqual(["library", "background"]);
  });
});

describe("authentication transaction gate exclusivity", () => {
  it("never runs two queued library transactions at once", async () => {
    const gate = authTransactionGateFor(new DatabaseSync(":memory:"));
    const inFlight = openSlot();
    await gate.enter(inFlight);
    let running = 0;
    let maxRunning = 0;
    const transaction = async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await turn();
      running--;
    };
    const queued = [gate.runExclusive(transaction), gate.runExclusive(transaction), gate.runExclusive(transaction)];
    await turn();
    gate.release(inFlight);
    await Promise.all(queued);
    expect(maxRunning).toBe(1);
  });
});
