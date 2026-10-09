// escape-control.ts: show a path or a name read from a source without acting on it
// (spec 0250 R35 and its delta-01).
//
// A name or a path that comes from a contributor can hold a control character; written
// raw to a terminal or a CI log it can forge a line (a GitHub Actions workflow command
// such as `::error::` starts a line). `escapeControl` writes each control character as
// `\xNN` (two lower-case hex digits) so the printed line carries none. Standard library
// only, shared by the build modules and by `component-resolve.ts`, neither of which
// should depend on the other.

/** True for U+0000 to U+001F and U+007F. */
export function isControlCode(code: number): boolean {
  return code < 0x20 || code === 0x7f;
}

/** `text` with every control character written as `\xNN` (lower-case hex). */
export function escapeControl(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    out += isControlCode(code) ? `\\x${code.toString(16).padStart(2, "0")}` : char;
  }
  return out;
}

/**
 * Like `escapeControl`, but a TAB (U+0009) is kept: the diagnostic records of spec 0198 are
 * tab-separated by design, and a tab cannot start a workflow command. Used for the lines
 * that carry a value read from a source (diagnostic records, the `--resolve` lines).
 */
export function escapeControlKeepTab(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    out += isControlCode(code) && code !== 0x09 ? `\\x${code.toString(16).padStart(2, "0")}` : char;
  }
  return out;
}
