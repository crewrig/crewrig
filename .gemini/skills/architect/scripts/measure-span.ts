// measure-span.ts — measures the exact bytes of line ranges of a file, so that a plan that claims
// to bring something under a size budget cites measured figures instead of estimates.
//
// Usage: node measure-span.ts <file> <first>-<last>... [--current <bytes> --budget <bytes>]
//          [--margin <bytes>] [--json]
//
// Each range is an inclusive pair of 1-based line numbers. Its size is the UTF-8 byte count of
// those lines as they are in the file: a line ending in a newline counts the newline, a CRLF
// counts both bytes, and a last line without a trailing newline counts the bytes it has. Ranges
// that overlap or repeat count each line once in `total`, while each range keeps the count of its
// own lines. With --current and --budget (they go together) the script also reports the projected
// size (current minus total) and the margin (budget minus projected); it reports a finding when
// the projected size is over the budget and, with --margin <bytes> (default 0), when the margin is
// smaller than that threshold, so a plan that lands 3 bytes under budget does not read as safe.
//
// `data` is {ranges: [{first, last, bytes}], total, projected, margin}; the last two are null
// without --current and --budget.
// Exit: 0 no finding, 1 a finding, 2 usage error (a malformed or reversed range, a missing option
// value, --current without --budget or the reverse, an unknown option), 3 the file is unreadable or
// a range reaches beyond its last line. With --json it prints one {ok, data, findings} object on
// stdout and the human text on stderr. It writes nothing and makes no network call.
// Self-contained on purpose: no import, built-ins through process.getBuiltinModule.

void (() => {
  const fs = process.getBuiltinModule("node:fs");

  const USAGE =
    "Usage: node measure-span.ts <file> <first>-<last>... [--current <bytes> --budget <bytes>]\n" +
    "         [--margin <bytes>] [--json]\n" +
    "  Measures the exact bytes of inclusive line ranges. Exit 0 no finding, 1 a finding,\n" +
    "  2 usage error, 3 unreadable file or a range past the last line.\n";

  interface Finding {
    rule: string;
    message: string;
  }

  const argv = process.argv.slice(2);
  let json = false;
  let help = false;
  let error: string | undefined;
  let current: number | undefined;
  let budget: number | undefined;
  let threshold = 0;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i] as string;
    const eq = raw.startsWith("--") ? raw.indexOf("=") : -1;
    const name = eq === -1 ? raw : raw.slice(0, eq);
    const inline = eq === -1 ? undefined : raw.slice(eq + 1);
    const take = (): string | undefined => {
      if (inline !== undefined) return inline;
      i++;
      const v = argv[i];
      if (v === undefined) error ??= `${name} needs a value`;
      return v;
    };
    if (name === "--json") json = true;
    else if (name === "--help" || name === "-h") help = true;
    else if (name === "--current" || name === "--budget" || name === "--margin") {
      const v = take();
      if (v === undefined) continue;
      if (!/^[0-9]+$/.test(v)) {
        error ??= `${name} needs a non-negative integer`;
        continue;
      }
      if (name === "--current") current = Number(v);
      else if (name === "--budget") budget = Number(v);
      else threshold = Number(v);
    } else if (raw.length > 1 && raw.startsWith("-")) error ??= `unknown option ${raw}`;
    else positional.push(raw);
  }

  const human = (s: string): void => {
    (json ? process.stderr : process.stdout).write(`${s}\n`);
  };
  const done = (code: number, data: object | null, findings: Finding[]): void => {
    if (json) process.stdout.write(`${JSON.stringify({ ok: code === 0, data, findings })}\n`);
    process.exitCode = code;
  };

  if (help) {
    process.stdout.write(USAGE);
    return;
  }
  const file = positional[0];
  const rangeArgs = positional.slice(1);
  const ranges: { first: number; last: number }[] = [];
  if (error === undefined && file === undefined) error = "a file is required";
  if (error === undefined && rangeArgs.length === 0)
    error = "at least one <first>-<last> range is required";
  if (error === undefined && (current === undefined) !== (budget === undefined))
    error = "--current and --budget go together";
  for (const r of rangeArgs) {
    if (error !== undefined) break;
    const m = /^([1-9][0-9]*)-([1-9][0-9]*)$/.exec(r);
    if (m === null)
      error = `range \`${r}\` is not of the form <first>-<last> with 1-based line numbers`;
    else if (Number(m[1]) > Number(m[2])) error = `range \`${r}\` is reversed`;
    else ranges.push({ first: Number(m[1]), last: Number(m[2]) });
  }
  if (error !== undefined) {
    process.stderr.write(`measure-span.ts: ${error}\n${USAGE}`);
    done(2, null, [{ rule: "usage", message: error }]);
    return;
  }

  const fail = (message: string): void => {
    human(`measure-span: ${message}`);
    done(3, null, [{ rule: "precondition", message }]);
  };
  let content: Buffer;
  try {
    content = fs.readFileSync(file as string);
  } catch (err) {
    fail(`${file}: ${(err as NodeJS.ErrnoException).code ?? "unreadable"}`);
    return;
  }

  // byte length of each line, newline included
  const lengths: number[] = [];
  let start = 0;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === 0x0a) {
      lengths.push(i + 1 - start);
      start = i + 1;
    }
  }
  if (start < content.length) lengths.push(content.length - start);

  const measured: { first: number; last: number; bytes: number }[] = [];
  const counted = new Set<number>();
  for (const r of ranges) {
    if (r.last > lengths.length) {
      fail(
        `range ${r.first}-${r.last} reaches beyond the last line (${lengths.length}) of ${file}`,
      );
      return;
    }
    let bytes = 0;
    for (let n = r.first; n <= r.last; n++) {
      bytes += lengths[n - 1] as number;
      counted.add(n);
    }
    measured.push({ first: r.first, last: r.last, bytes });
  }
  let total = 0;
  for (const n of counted) total += lengths[n - 1] as number;

  const findings: Finding[] = [];
  let projected: number | null = null;
  let margin: number | null = null;
  for (const m of measured) human(`measure-span: lines ${m.first}-${m.last}: ${m.bytes} bytes`);
  human(`measure-span: total ${total} bytes`);
  if (current !== undefined && budget !== undefined) {
    projected = current - total;
    margin = budget - projected;
    human(`measure-span: projected ${projected} bytes, budget ${budget}, margin ${margin}`);
    if (projected > budget)
      findings.push({
        rule: "over-budget",
        message: `the projected size ${projected} is ${projected - budget} bytes over the budget ${budget}; move or trim more`,
      });
    else if (margin < threshold)
      findings.push({
        rule: "thin-margin",
        message: `the margin ${margin} is smaller than the threshold ${threshold}; add headroom or flag the risk in the plan`,
      });
    for (const f of findings) human(`measure-span: ${f.message}`);
  }
  done(findings.length > 0 ? 1 : 0, { ranges: measured, total, projected, margin }, findings);
})();
