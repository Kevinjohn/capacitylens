import { beforeEach, describe, expect, it, vi } from "vitest";
import { nonColourEnvironment, spawnPnpm } from "../scripts/pnpm-spawn.mjs";

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

describe("nonColourEnvironment", () => {
  it.each([{}, { NO_COLOR: "1" }, { FORCE_COLOR: "1" }, { NO_COLOR: "1", FORCE_COLOR: "1" }])(
    "normalizes inherited colour controls for %#",
    (parent) => {
      const env = nonColourEnvironment({ RUN: "yes" }, parent);
      expect(env).not.toHaveProperty("NO_COLOR");
      expect(env).toMatchObject({ FORCE_COLOR: "0", RUN: "yes" });
    },
  );
});
