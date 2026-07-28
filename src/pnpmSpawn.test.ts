import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnPnpm } from "../scripts/pnpm-spawn.mjs";

const processMocks = vi.hoisted(() => ({
  child: { pid: 1234 },
  spawn: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  default: { spawn: processMocks.spawn },
  spawn: processMocks.spawn,
}));

describe("spawnPnpm", () => {
  beforeEach(() => {
    processMocks.spawn.mockReset();
    processMocks.spawn.mockReturnValue(processMocks.child);
  });

  it("uses shell resolution for the Windows pnpm.cmd shim and preserves launcher options", () => {
    const child = spawnPnpm(["run", "start"], {
      detached: true,
      env: { PATH: "test-path" },
      shell: false,
    });

    expect(child).toBe(processMocks.child);
    expect(processMocks.spawn).toHaveBeenCalledWith("pnpm", ["run", "start"], {
      detached: true,
      env: { PATH: "test-path" },
      shell: true,
    });
  });
});
