/* eslint-disable complexity, max-depth -- this bounded lexical scan keeps JSON.parse responsible for syntax. */
/** Bounds and ambiguity checks for untrusted JSON before the platform parser handles syntax. */
export const MAX_JSON_DEPTH = 64;
const WHITESPACE = /[\t\n\r ]/;
const NUMBER_CHAR = /[0-9eE+.-]/;

type Frame = { keys: Set<string> | null };

/** Reject excessive nesting, duplicate decoded object keys, and non-finite or unsafe-integer numbers. */
export function assertUnambiguousJson(source: string): void {
  const frames: Frame[] = [];
  for (let i = 0; i < source.length;) {
    const char = source[i];
    if (char === '"') {
      const start = i++;
      let closed = false;
      while (i < source.length) {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i++] === '"') {
          closed = true;
          break;
        }
      }
      if (!closed) return; // JSON.parse reports malformed syntax.
      const top = frames[frames.length - 1];
      if (top?.keys) {
        let next = i;
        while (WHITESPACE.test(source[next] ?? "")) next++;
        if (source[next] === ":") {
          const key = JSON.parse(source.slice(start, i)) as string;
          if (top.keys.has(key)) throw new Error("JSON contains a duplicate object key.");
          top.keys.add(key);
        }
      }
      continue;
    }
    if (char === "{" || char === "[") {
      frames.push({ keys: char === "{" ? new Set() : null });
      if (frames.length > MAX_JSON_DEPTH) throw new Error(`JSON nesting exceeds ${MAX_JSON_DEPTH} levels.`);
      i++;
      continue;
    }
    if (char === "}" || char === "]") {
      frames.pop();
      i++;
      continue;
    }
    if (char !== undefined && /[-0-9]/.test(char)) {
      const start = i++;
      while (NUMBER_CHAR.test(source[i] ?? "")) i++;
      const token = source.slice(start, i);
      const number = Number(token);
      const mantissa = token.split(/[eE]/, 1)[0] ?? token;
      if (
        !Number.isFinite(number) ||
        (number === 0 && /[1-9]/.test(mantissa)) ||
        (Number.isInteger(number) && !Number.isSafeInteger(number))
      ) {
        throw new Error("JSON contains a number outside the supported range.");
      }
      continue;
    }
    i++;
  }
}
