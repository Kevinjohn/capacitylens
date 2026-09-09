import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { ImportWorkerRequest, ImportWorkerResult } from "./importWorker";

const request: ImportWorkerRequest = {
  current: emptyAppData(),
  accountId: "account-1",
  incoming: emptyAppData(),
  now: "2026-09-09T00:00:00.000Z",
};

const result: ImportWorkerResult = { data: emptyAppData(), imported: 1, skipped: 2 };

function createPort() {
  return {
    once: vi.fn<(event: "message", listener: (request: ImportWorkerRequest) => void) => void>(),
    postMessage: vi.fn(),
  };
}

function readMessageListener(port: ReturnType<typeof createPort>) {
  const registration = port.once.mock.calls[0];
  if (!registration) throw new Error("Expected the import worker to register a listener.");
  return registration[1];
}

function mockWorkerModule(isMainThread: boolean, parentPort: ReturnType<typeof createPort> | null) {
  vi.doMock("node:worker_threads", () => ({ isMainThread, parentPort }));
}

function mockDomain(remapAndValidateImport: ReturnType<typeof vi.fn>) {
  vi.doMock("@capacitylens/shared/domain/mutations", () => ({ remapAndValidateImport }));
}

function expectDomainInvocation(remapAndValidateImport: ReturnType<typeof vi.fn>) {
  expect(remapAndValidateImport).toHaveBeenCalledOnce();
  const importArguments = remapAndValidateImport.mock.calls[0];
  if (!importArguments) throw new Error("Expected the import worker to invoke the domain import.");
  expect(importArguments[0]).toBe(request.current);
  expect(importArguments[1]).toBe(request.accountId);
  expect(importArguments[2]).toBe(request.incoming);
  expect(importArguments[3]).toBe(request.now);
}

afterEach(() => {
  vi.doUnmock("node:worker_threads");
  vi.doUnmock("@capacitylens/shared/domain/mutations");
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("import worker protocol", () => {
  it("installs no listener on the main thread", async () => {
    const port = createPort();
    mockWorkerModule(true, port);
    mockDomain(vi.fn());

    await import("./importWorker");

    expect(port.once).not.toHaveBeenCalled();
  });

  it("refuses to start without a parent port", async () => {
    mockWorkerModule(false, null);
    mockDomain(vi.fn());

    await expect(import("./importWorker")).rejects.toThrow("Import worker started without a parent port.");
  });

  it("registers one listener and forwards successful imports", async () => {
    const port = createPort();
    const remapAndValidateImport = vi.fn(() => result);
    mockWorkerModule(false, port);
    mockDomain(remapAndValidateImport);

    await import("./importWorker");
    const listener = readMessageListener(port);
    listener(request);

    expect(port.once).toHaveBeenCalledOnce();
    expect(port.once).toHaveBeenCalledWith("message", expect.any(Function));
    expectDomainInvocation(remapAndValidateImport);
    expect(port.postMessage).toHaveBeenCalledOnce();
    expect(port.postMessage.mock.calls[0]).toStrictEqual([{ ok: true, result }]);
  });

  it("serializes Error failures", async () => {
    const port = createPort();
    const failure = new TypeError("invalid import");
    const remapAndValidateImport = vi.fn(() => {
      throw failure;
    });
    mockWorkerModule(false, port);
    mockDomain(remapAndValidateImport);

    await import("./importWorker");
    readMessageListener(port)(request);

    expect(port.once).toHaveBeenCalledOnce();
    expectDomainInvocation(remapAndValidateImport);
    expect(port.postMessage).toHaveBeenCalledOnce();
    expect(port.postMessage.mock.calls[0]).toStrictEqual([
      { ok: false, error: { name: "TypeError", message: "invalid import", stack: failure.stack } },
    ]);
  });

  it("serializes non-Error failures", async () => {
    const port = createPort();
    const remapAndValidateImport = vi.fn(() => runInNewContext("throw 42"));
    mockWorkerModule(false, port);
    mockDomain(remapAndValidateImport);

    await import("./importWorker");
    readMessageListener(port)(request);

    expect(port.once).toHaveBeenCalledOnce();
    expectDomainInvocation(remapAndValidateImport);
    expect(port.postMessage).toHaveBeenCalledOnce();
    expect(port.postMessage.mock.calls[0]).toStrictEqual([{ ok: false, error: { message: "42" } }]);
  });
});
