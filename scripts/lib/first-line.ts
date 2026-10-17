// first-line.ts — an `Error: <path>: <reason>` line carries one line (spec 0262 delta-02/05): a
// js-yaml parser message spans several lines (reason, blank line, source snippet), so keep the first.

export function firstLine(message: string): string {
  return message.split("\n")[0] ?? "";
}
