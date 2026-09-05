/**
 * Count nonblank, non-comment lines within inclusive one-based source line ranges.
 * Comment ranges use the parser's half-open UTF-16 offsets. Preserve line breaks and
 * literal content so multiline strings, heredocs and JSX remain part of the measured body.
 */
export function createCodeLineCounter(source, commentRanges) {
  const characters = source.split("");
  for (const [start, end] of commentRanges) {
    for (let index = start; index < end; index++) {
      if (!/[\r\n\u2028\u2029]/.test(characters[index])) characters[index] = " ";
    }
  }
  const lines = characters.join("").split(/\r\n|[\n\r\u2028\u2029]/);
  const prefix = [0];
  for (const line of lines) prefix.push(prefix.at(-1) + Number(Boolean(line.trim())));
  return (start, end) => prefix[end] - prefix[start - 1];
}
