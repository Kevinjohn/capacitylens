import { describe, expect, it } from "vitest";
import { assertUnambiguousJson, MAX_JSON_DEPTH } from "./strictJson";

describe("assertUnambiguousJson", () => {
  it("accepts the maximum depth and safe integer boundary", () => {
    expect(() =>
      assertUnambiguousJson(`${"[".repeat(MAX_JSON_DEPTH)}9007199254740991${"]".repeat(MAX_JSON_DEPTH)}`),
    ).not.toThrow();
  });

  it("rejects deeper documents, duplicate decoded names, and unsafe numbers", () => {
    expect(() =>
      assertUnambiguousJson(`${"[".repeat(MAX_JSON_DEPTH + 1)}0${"]".repeat(MAX_JSON_DEPTH + 1)}`),
    ).toThrow();
    expect(() => assertUnambiguousJson('{"a":1,"\\u0061":2}')).toThrow(/duplicate/);
    expect(() => assertUnambiguousJson('{"nested":{"a":1},"a":2}')).not.toThrow();
    expect(() => assertUnambiguousJson('{"left":{"a":1},"right":{"a":2}}')).not.toThrow();
    expect(() => assertUnambiguousJson(JSON.stringify({ message: 'escaped "brace" { [ ' }))).not.toThrow();
    expect(() => assertUnambiguousJson('{"scientific":1.25e2,"fractional":0.125}')).not.toThrow();
    expect(() => assertUnambiguousJson('{"a":')).not.toThrow(); // JSON.parse owns syntax errors.
    expect(() => JSON.parse('{"a":')).toThrow();
    expect(() => assertUnambiguousJson('{"n":9007199254740992}')).toThrow(/number/);
    expect(() => assertUnambiguousJson('{"n":1e400}')).toThrow(/number/);
    expect(() => assertUnambiguousJson('{"n":1e-400}')).toThrow(/number/);
    expect(() => assertUnambiguousJson('{"n":-1e-400}')).toThrow(/number/);
    expect(() => assertUnambiguousJson('{"n":0e-400,"minusZero":-0}')).not.toThrow();
    expect(() => assertUnambiguousJson('{"n":5e-324}')).not.toThrow();
  });
});
