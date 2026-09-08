import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const fsMocks = vi.hoisted(() => ({ chmodSync: vi.fn() }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  fsMocks.chmodSync.mockImplementation(actual.chmodSync);
  return { ...actual, chmodSync: fsMocks.chmodSync };
});

import { openDb } from "./db";

const artifacts: string[] = [];

const isPermissionFailure = (error: unknown, path: string): boolean =>
  error instanceof Error &&
  error.message.includes(`Could not restrict SQLite file permissions at "${path}".`) &&
  error.cause instanceof Error &&
  error.cause.message === "simulated chmod refusal";

afterEach(() => {
  fsMocks.chmodSync.mockReset();
  for (const path of artifacts.splice(0)) {
    if (existsSync(path)) unlinkSync(path);
  }
});

describe("openDb failure causality", () => {
  it("preserves a late permission error while cleaning up the caller-owned handle", () => {
    const path = join(tmpdir(), `capacitylens-permission-${process.pid}-${Date.now()}.db`);
    artifacts.push(path, `${path}-wal`, `${path}-shm`);
    let calls = 0;
    fsMocks.chmodSync.mockImplementation(() => {
      calls += 1;
      if (calls > 1) throw new Error("simulated chmod refusal");
    });

    expect(() => openDb(path)).toThrowError(expect.toSatisfy((error: unknown) => isPermissionFailure(error, path)));
  });
});
