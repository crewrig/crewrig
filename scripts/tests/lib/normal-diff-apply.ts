// normal-diff-apply.ts — applies a normal-format `diff OLD NEW` script to the old text,
// so a test can assert "old + printed hunks == new" without depending on which edit
// script (hunk layout) a given `diff` implementation chose.

const HUNK = /^(\d+)(?:,(\d+))?([acd])(\d+)(?:,(\d+))?$/;
const NO_EOL = "\\ No newline at end of file";

function toLines(text: string): { lines: string[]; noEol: boolean } {
  if (text === "") return { lines: [], noEol: false };
  const noEol = !text.endsWith("\n");
  const lines = text.split("\n");
  if (!noEol) lines.pop();
  return { lines, noEol };
}

/** Apply `script` (normal-format diff text) to `oldText`; throws on any inconsistency. */
export function applyNormalDiff(oldText: string, script: string): string {
  const old = toLines(oldText);
  const out: string[] = [];
  let ptr = 0; // old lines consumed so far
  let touchesEnd = false;
  let newNoEol = false;
  const rows = script.split("\n");
  if (rows.at(-1) === "") rows.pop();
  let i = 0;
  while (i < rows.length) {
    const m = HUNK.exec(rows[i]!);
    if (!m) throw new Error(`not a normal-diff hunk header: ${JSON.stringify(rows[i])}`);
    i += 1;
    const cmd = m[3]!;
    const oStart = Number(m[1]);
    const oEnd = m[2] === undefined ? oStart : Number(m[2]);
    // `a` names the old line after which text is added; `d`/`c` name the old range.
    const keep = cmd === "a" ? oStart : oStart - 1;
    if (keep < ptr || keep > old.lines.length) throw new Error(`hunk out of order: ${m[0]}`);
    out.push(...old.lines.slice(ptr, keep));
    const removed: string[] = [];
    const added: string[] = [];
    let side: "<" | ">" = "<";
    while (i < rows.length && !HUNK.test(rows[i]!)) {
      const row = rows[i]!;
      i += 1;
      if (row === "---") side = ">";
      else if (row === NO_EOL) {
        if (side === ">") newNoEol = true;
      } else if (row.startsWith("< ") || row === "<") removed.push(row.slice(2));
      else if (row.startsWith("> ") || row === ">") added.push(row.slice(2));
      else throw new Error(`unexpected diff row: ${JSON.stringify(row)}`);
    }
    const count = cmd === "a" ? 0 : oEnd - oStart + 1;
    if (removed.length !== count) throw new Error(`hunk ${m[0]} removes ${removed.length}`);
    for (let k = 0; k < count; k += 1) {
      if (old.lines[keep + k] !== removed[k]) {
        throw new Error(`hunk ${m[0]}: old line ${keep + k + 1} does not match`);
      }
    }
    out.push(...added);
    ptr = keep + count;
    if (ptr >= old.lines.length) touchesEnd = true;
  }
  out.push(...old.lines.slice(ptr));
  if (out.length === 0) return "";
  const noEol = touchesEnd ? newNoEol : old.noEol;
  return out.join("\n") + (noEol ? "" : "\n");
}
