// security-finding.ts — check that a security review report has the shape the security skill asks
// for, and that every `Where:` location resolves to a real file and line.
// Usage and exit codes: see USAGE below or run with --help. Contract: docs/skill-authoring-standard.md.
// Self-contained: no import, built-ins through process.getBuiltinModule. Reads only; no network.

process.removeAllListeners("warning");

void (() => {
  const fs = process.getBuiltinModule("node:fs");
  const path = process.getBuiltinModule("node:path");

  const NAME = "security-finding.ts";
  const USAGE = `Usage: node scripts/${NAME} [--root <dir>] [--json] <report-file | ->

Checks one security review report (a file, or - for standard input) against the output format of
the security skill: numbered findings, each "N. [SEV] <summary>" followed by the fields Where:,
Threat:, Evidence: and Fix: (a value may continue on indented lines). It reads the report and the
files named by Where:; it writes nothing and makes no network call. It does not check that the
Evidence occurs at the cited line.

Rules (each finding carries the finding number and a message that states the fix):
  severity-missing, severity-unknown (BLOCKER, HIGH, MED, LOW or INFO), field-missing,
  placeholder (a value that is still template text in angle brackets), where-format
  (<file>:<line> or <file>:<first>-<last>), where-file-missing, where-line-out-of-range,
  where-outside-root, numbering (1 to N in order), field-duplicate (a label given twice),
  fence-unclosed (a code fence never closed), no-findings-block (no numbered finding and no line
  "No findings."), precondition (unreadable report, root that is not a directory). A prose line
  closes the open finding; the next header with a bracketed severity opens another.

Options:
  --root <dir>  directory that Where: paths resolve against (default: the working directory)
  --json        print one JSON object {ok, data, findings} on stdout, text on stderr
  --help        print this text
data: {checked, severities: {BLOCKER, HIGH, MED, LOW, INFO}}.
Exit codes: 0 no finding, 1 at least one error, 2 usage error, 3 unreadable report or bad root.
`;
  type Finding = { rule: string; message: string; finding?: number; line?: number };
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const SEVS = ["BLOCKER", "HIGH", "MED", "LOW", "INFO"];
  const findings: Finding[] = [];
  const emit = (code: number, data: unknown): void => {
    const lines = findings.map(
      (f) =>
        `${f.finding === undefined ? "report" : `finding ${f.finding}`}: ${f.rule}: ${f.message}`,
    );
    const text = `${lines.length > 0 ? lines.join("\n") : "security-finding: the report is well formed"}\n`;
    if (json) {
      process.stdout.write(`${JSON.stringify({ ok: code === 0, data, findings })}\n`);
      process.stderr.write(text);
    } else (code >= 2 ? process.stderr : process.stdout).write(text);
    process.exitCode = code;
  };
  const stop = (code: number, rule: string, message: string): void => {
    findings.push({ rule, message });
    emit(code, null);
  };
  if (argv.includes("--help")) {
    process.stdout.write(USAGE);
    return;
  }

  let rootArg = ".";
  const inputs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i] ?? "";
    if (raw === "--json") continue;
    if (raw === "--root" || raw.startsWith("--root=")) {
      const value = raw === "--root" ? argv[++i] : raw.slice("--root=".length);
      if (value === undefined) return stop(2, "usage", "--root needs a directory");
      rootArg = value;
    } else if (raw.startsWith("-") && raw !== "-") return stop(2, "usage", `unknown option ${raw}`);
    else inputs.push(raw);
  }
  if (inputs.length !== 1)
    return stop(2, "usage", "give exactly one report file, or - for standard input");
  const root = path.resolve(rootArg);
  if (fs.statSync(root, { throwIfNoEntry: false })?.isDirectory() !== true)
    return stop(3, "precondition", `--root is not a directory: ${root}`);
  let text: string;
  try {
    text = fs.readFileSync(inputs[0] === "-" ? 0 : (inputs[0] ?? ""), "utf8");
  } catch (e) {
    return stop(3, "precondition", `cannot read the report ${inputs[0]}: ${(e as Error).message}`);
  }

  // Split the report into numbered findings. A fenced block and its fence lines belong to the open
  // field and a blank line does not close it. A prose line closes the open finding, and only a
  // header with a bracketed severity opens one again, so that no finding is dropped silently.
  type Block = {
    n: number;
    line: number;
    head: string;
    fields: Map<string, string>;
    dups: string[];
  };
  const blocks: Block[] = [];
  let fenced = false;
  let ended = false;
  let field: string | undefined;
  let noFindings = false;
  text.split(/\r?\n/).forEach((line, i) => {
    const inside = fenced || /^\s*```/.test(line);
    if (/^\s*```/.test(line)) fenced = !fenced;
    const h = inside
      ? null
      : (/^(\d+)\.\s+(.*)$/.exec(line) ?? /^\s{1,3}(\d+)\.\s+(\[.*)$/.exec(line));
    const head = h !== null && (!ended || /^\[/.test(h[2] ?? "")) ? h : null;
    const label = inside ? null : /^\s*(Where|Threat|Evidence|Fix):\s*(.*)$/.exec(line);
    const last = blocks[blocks.length - 1];
    if (head !== null) {
      blocks.push({
        n: Number(head[1]),
        line: i + 1,
        head: head[2] ?? "",
        fields: new Map(),
        dups: [],
      });
      field = undefined;
      ended = false;
    } else if (label !== null && last !== undefined && !ended) {
      field = label[1] ?? "";
      if (last.fields.has(field)) last.dups.push(field);
      last.fields.set(field, (label[2] ?? "").trim());
    } else if ((inside || /^\s+\S/.test(line)) && last !== undefined && field !== undefined)
      last.fields.set(field, `${last.fields.get(field) ?? ""} ${line.trim()}`.trim());
    else if (line.trim() === "No findings.") noFindings = true;
    else if (line.trim() !== "" && !/^\s/.test(line)) {
      field = undefined;
      ended = last !== undefined;
    }
  });

  const counts: Record<string, number> = Object.fromEntries(SEVS.map((s) => [s, 0]));
  const lineCount = new Map<string, number>();
  const bad = (b: Block, rule: string, message: string): void => {
    findings.push({ rule, message, finding: b.n, line: b.line });
  };
  const holes = /^<[^<>]+>$/;
  blocks.forEach((b, i) => {
    if (b.n !== i + 1 && !findings.some((f) => f.rule === "numbering"))
      bad(
        b,
        "numbering",
        `finding ${b.n} stands at position ${i + 1}: number the findings 1 to N in order`,
      );
    const sev = /^\[([^\]]*)\]\s*(.*)$/.exec(b.head);
    if (sev === null)
      bad(b, "severity-missing", `start the header with a bracketed severity: [${SEVS.join("|")}]`);
    else if (!SEVS.includes(sev[1] ?? ""))
      bad(b, "severity-unknown", `[${sev[1]}] is not a severity: use one of ${SEVS.join(", ")}`);
    else counts[sev[1] ?? ""] = (counts[sev[1] ?? ""] ?? 0) + 1;
    const summary = sev === null ? b.head : (sev[2] ?? "");
    for (const d of b.dups) bad(b, "field-duplicate", `${d}: appears twice: keep one ${d}: line`);
    if (summary.trim() === "") bad(b, "field-missing", "add a one-line summary after the severity");
    else if (holes.test(summary.trim()))
      bad(b, "placeholder", "replace the summary placeholder with a one-line summary");
    for (const name of ["Where", "Threat", "Evidence", "Fix"]) {
      const value = b.fields.get(name);
      if (value === undefined || value === "")
        bad(b, "field-missing", `add the ${name}: field with a value`);
      else if (holes.test(value))
        bad(
          b,
          "placeholder",
          `${name}: still holds template text; replace ${value} with the real content`,
        );
    }
    const where = b.fields.get("Where") ?? "";
    if (where === "") return;
    const m = /^(.+):(\d+)(?:-(\d+))?$/.exec(where);
    if (m === null)
      return bad(
        b,
        "where-format",
        `Where: must be <file>:<line> or <file>:<first>-<last>, got ${where}`,
      );
    const file = path.resolve(root, m[1] ?? "");
    const inside = (p: string, base = root): boolean => {
      const rel = path.relative(base, p);
      return rel.split(path.sep)[0] !== ".." && !path.isAbsolute(rel);
    };
    if (!inside(file))
      return bad(
        b,
        "where-outside-root",
        `${m[1]} resolves outside --root: cite a file of the reviewed checkout`,
      );
    if (fs.statSync(file, { throwIfNoEntry: false })?.isFile() !== true)
      return bad(
        b,
        "where-file-missing",
        `${m[1]} is not a file under --root ${root}: cite the post-image path of a file that exists in the checkout`,
      );
    if (!inside(fs.realpathSync(file), fs.realpathSync(root)))
      return bad(b, "where-outside-root", `${m[1]} resolves outside --root through a link`);
    if (!lineCount.has(file)) {
      const rows = fs.readFileSync(file, "utf8").split("\n");
      lineCount.set(file, rows[rows.length - 1] === "" ? rows.length - 1 : rows.length);
    }
    const total = lineCount.get(file) ?? 0;
    const first = Number(m[2]);
    const last = m[3] === undefined ? first : Number(m[3]);
    if (first < 1 || last < first || last > total)
      bad(
        b,
        "where-line-out-of-range",
        `${where}: ${m[1]} has ${total} line(s); cite lines from 1 to ${total}, the last not below the first`,
      );
  });
  const open = blocks[blocks.length - 1];
  if (fenced)
    findings.push({
      rule: "fence-unclosed",
      message:
        "a code fence is never closed, so the lines after it are not read: close it with ```",
      ...(open === undefined ? {} : { finding: open.n }),
    });
  if (blocks.length === 0 && !noFindings)
    findings.push({
      rule: "no-findings-block",
      message:
        'the report has no numbered finding and no line "No findings.": write one or the other, so an empty or wrong file cannot pass for a clean review',
    });
  emit(findings.length > 0 ? 1 : 0, { checked: blocks.length, severities: counts });
})();
