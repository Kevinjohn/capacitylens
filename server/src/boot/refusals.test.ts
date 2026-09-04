import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../db";
import { closeDbSafely, parseAuditMaxMb, parsePort, refuseToStart, tryOrRefuse } from "./refusals";

afterEach(() => vi.restoreAllMocks());

function interceptExit() {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const exit = vi.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("exit intercepted");
  });
  return { error, exit };
}

describe("boot refusal helpers", () => {
  it("prints the refusal and exits unsuccessfully", () => {
    const { error, exit } = interceptExit();
    expect(() => refuseToStart("invalid configuration")).toThrow("exit intercepted");
    expect(error).toHaveBeenCalledWith("capacitylens-server: refusing to start — invalid configuration");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("returns resolved options and frames Error and non-Error failures", () => {
    expect(tryOrRefuse(() => 42)).toBe(42);
    const { error } = interceptExit();
    for (const failure of [new Error("bad option"), "bad option"]) {
      expect(() =>
        tryOrRefuse(() => {
          throw failure;
        }),
      ).toThrow("exit intercepted");
      expect(error).toHaveBeenLastCalledWith("capacitylens-server: refusing to start — bad option");
    }
  });

  it("closes an available database and surfaces secondary close failures", () => {
    closeDbSafely(undefined);
    const close = vi.fn();
    closeDbSafely({ close } as unknown as Db);
    expect(close).toHaveBeenCalledOnce();
    const failure = new Error("close failed");
    close.mockImplementation(() => {
      throw failure;
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => closeDbSafely({ close } as unknown as Db)).not.toThrow();
    expect(error).toHaveBeenCalledWith(
      "capacitylens-server: database close also failed during startup refusal",
      failure,
    );
  });

  it("defaults the port and accepts its inclusive bounds", () => {
    expect(parsePort(undefined)).toBe(8787);
    expect(parsePort("1")).toBe(1);
    expect(parsePort("65535")).toBe(65535);
  });

  it.each(["", "abc", "0", "65536", "1.5"])("refuses invalid port %j", (raw) => {
    const { error, exit } = interceptExit();
    expect(() => parsePort(raw)).toThrow("exit intercepted");
    expect(error).toHaveBeenCalledWith(
      `capacitylens-server: refusing to start — PORT must be an integer 1..65535, got ${JSON.stringify(raw)}.`,
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("bounds audit sizes while falling back on missing or invalid values", () => {
    expect(parseAuditMaxMb("1")).toBe(1);
    expect(parseAuditMaxMb("1048576")).toBe(1048576);
    for (const raw of [undefined, "", "abc", "0", "1.5", "1048577", "Infinity"]) {
      expect(parseAuditMaxMb(raw)).toBe(64);
    }
  });
});
