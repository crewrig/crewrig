// lint-adr.ts — check that an ADR written with the skill's template has the required shape.
// Usage: node scripts/lint-adr.ts <adr-file>... [--json]     (or - for one ADR on stdin)
// An authoring tool for the ADR being written: it is not meant to run over a whole ADR directory,
// whose older records may use other layouts. Exit codes: 0 no error finding (warnings are listed),
// 1 at least one error finding, 2 usage error, 3 unreadable input.
// Contract: docs/skill-authoring-standard.md (the script contract). Self-contained on purpose: no
// import, built-ins through process.getBuiltinModule.

process.removeAllListeners("warning");

void (() => {
  const fs = process.getBuiltinModule("node:fs");

  const NAME = "lint-adr.ts";
  const USAGE = `Usage: node scripts/${NAME} <adr-file>... [--json]
       node scripts/${NAME} - [--json]            (one ADR on standard input)

Checks, per ADR: the heading "# ADR-NNNN: <title>"; the sections Status, Context, Decision and
Consequences, each once and in that order; a Status of Proposed, Accepted, Deprecated or
"Superseded by ADR-NNNN"; no unfilled template placeholder (so the unmodified template fails);
a Positive, a Negative and a Neutral bullet under Consequences. A Context of more than five
sentences is a warning.

Options:
  --json   print one JSON object {ok, data, findings} on stdout
  --help   print this text

data: {files: [{path, errors, warnings}]}; each finding also carries path and severity.

Exit codes: 0 no error finding, 1 error finding, 2 usage error, 3 unreadable input.
`;

  interface Finding {
    rule: string;
    message: string;
    path?: string;
    severity?: "error" | "warning";
  }
  const argv = process.argv.slice(2);
  let json = false;
  const emit = (code: number, data: unknown, findings: Finding[], summary: string): void => {
    if (json) {
      process.stdout.write(`${JSON.stringify({ ok: code === 0, data, findings })}\n`);
      process.stderr.write(`${summary}\n`);
    } else (code >= 2 ? process.stderr : process.stdout).write(`${summary}\n`);
    process.exitCode = code;
  };
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    return;
  }
  json = argv.includes("--json");
  const usageError = (message: string): void =>
    emit(2, null, [{ rule: "usage", message }], `${NAME}: ${message}\n${USAGE.split("\n")[0]}`);

  const files: string[] = [];
  for (const raw of argv) {
    if (raw === "--json") continue;
    if (raw.startsWith("-") && raw !== "-") return usageError(`unknown option ${raw}`);
    files.push(raw);
  }
  if (files.length === 0) return usageError("an ADR file is required");
  if (files.includes("-") && files.length > 1)
    return usageError("- (standard input) cannot be combined with other files");

  const SECTIONS = ["Status", "Context", "Decision", "Consequences"];
  // A placeholder is angle-bracketed words that start with a letter and contain a space (the
  // template's own style), or a TODO/TBD marker. `a < b and c > d`, `<br>` and `<a href="x">` pass.
  const PLACEHOLDER = /<(?:[A-Za-z][^<>\n=]* [^<>\n=]*|TODO|TBD|FIXME)>/i;
  const STATUS = /^(Proposed|Accepted|Deprecated|Superseded by ADR-[0-9]{4})$/;

  /** Lines outside fenced code, each with inline code spans blanked. */
  const prose = (lines: string[]): { n: number; text: string }[] => {
    const out: { n: number; text: string }[] = [];
    let fence = false;
    lines.forEach((l, i) => {
      if (/^\s*(```|~~~)/.test(l)) fence = !fence;
      else if (!fence) out.push({ n: i + 1, text: l.replace(/`[^`]*`/g, "``") });
    });
    return out;
  };

  const lintOne = (label: string, text: string): Finding[] => {
    const found: Finding[] = [];
    const add = (rule: string, message: string, severity: "error" | "warning" = "error"): void => {
      found.push({ rule, message, path: label, severity });
    };
    const lines = text.split(/\r?\n/);
    const body = prose(lines);

    const first = body.find((l) => l.text.trim() !== "");
    if (first === undefined || !/^# ADR-[0-9]{4}: \S/.test(first.text))
      add(
        "heading",
        'the first line must be "# ADR-NNNN: <title>" with a four-digit number and a title',
      );

    const at = new Map<string, number[]>();
    for (const l of body) {
      const m = /^## (.+?)\s*$/.exec(l.text);
      if (m !== null && SECTIONS.includes(m[1] as string)) {
        const list = at.get(m[1] as string) ?? [];
        list.push(l.n);
        at.set(m[1] as string, list);
      }
    }
    for (const s of SECTIONS) {
      const list = at.get(s) ?? [];
      if (list.length === 0) add("section-missing", `the section "## ${s}" is missing`);
      if (list.length > 1)
        add("section-duplicate", `the section "## ${s}" appears ${list.length} times`);
    }
    const present = SECTIONS.filter((s) => (at.get(s) ?? []).length > 0);
    const firstAt = present.map((s) => (at.get(s) as number[])[0] as number);
    if (firstAt.some((n, i) => i > 0 && n < (firstAt[i - 1] as number)))
      add("section-order", `the sections must come in the order ${SECTIONS.join(", ")}`);

    const sectionLines = (s: string): { n: number; text: string }[] => {
      const start = (at.get(s) ?? [])[0];
      if (start === undefined) return [];
      const next = body.find((l) => l.n > start && /^## /.test(l.text));
      return body.filter((l) => l.n > start && (next === undefined || l.n < next.n));
    };

    const status = sectionLines("Status").find((l) => l.text.trim() !== "");
    if (at.has("Status") && (status === undefined || !STATUS.test(status.text.trim())))
      add(
        "status",
        `the Status must be Proposed, Accepted, Deprecated or "Superseded by ADR-NNNN", not "${status?.text.trim() ?? ""}"`,
      );

    for (const l of body) {
      if (PLACEHOLDER.test(l.text) || /\{\{[A-Z]+\}\}/.test(l.text))
        add(
          "placeholder",
          `line ${l.n} still holds template placeholder text: replace it with content`,
        );
    }

    if (at.has("Consequences")) {
      const cons = sectionLines("Consequences");
      for (const kind of ["Positive", "Negative", "Neutral"]) {
        const re = new RegExp(`^\\s*[-*] ${kind}:\\s*(\\S.*)$`);
        if (!cons.some((l) => re.test(l.text)))
          add(
            "consequence-missing",
            `the Consequences need a "- ${kind}: ..." bullet with content`,
          );
      }
    }

    if (at.has("Context")) {
      const ctx = sectionLines("Context")
        .map((l) => l.text)
        .join(" ");
      const sentences = ctx.split(/[.!?](?:\s+|$)/).filter((s) => s.trim() !== "").length;
      if (sentences > 5)
        add(
          "context-length",
          `the Context has ${sentences} sentences; three to five keep the decision crisp`,
          "warning",
        );
    }
    return found;
  };

  const results: { path: string; errors: number; warnings: number }[] = [];
  const findings: Finding[] = [];
  for (const f of files) {
    let text: string;
    try {
      text = fs.readFileSync(f === "-" ? 0 : f, "utf8") as string;
    } catch (e) {
      const m = `cannot read ${f === "-" ? "standard input" : f}: ${(e as Error).message}`;
      return emit(3, null, [{ rule: "precondition", message: m }], `${NAME}: ${m}`);
    }
    const label = f === "-" ? "<stdin>" : f;
    const found = lintOne(label, text);
    findings.push(...found);
    results.push({
      path: label,
      errors: found.filter((x) => x.severity !== "warning").length,
      warnings: found.filter((x) => x.severity === "warning").length,
    });
  }
  const errors = findings.filter((x) => x.severity !== "warning").length;
  const lines = findings.map((x) => `${x.path}: ${x.severity} ${x.rule}: ${x.message}`);
  const summary =
    lines.length === 0
      ? `${NAME}: ${files.length} file(s) checked, no finding`
      : `${lines.join("\n")}\n${NAME}: ${errors} error(s), ${findings.length - errors} warning(s)`;
  emit(errors > 0 ? 1 : 0, { files: results }, findings, summary);
})();
