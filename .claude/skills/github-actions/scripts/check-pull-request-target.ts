// check-pull-request-target.ts — flag a pull_request_target workflow that checks out the pull request head.
// Usage: node scripts/check-pull-request-target.ts <workflow-file-or-directory>... [--json]   (or - for stdin)
// Exit codes: 0 no error finding (warnings are listed), 1 error finding, 2 usage error or a
// directory with no workflow file, 3 unreadable input. Writes nothing, makes no network call.
// Contract: docs/skill-authoring-standard.md (the script contract). Self-contained on purpose: no
// import, built-ins through process.getBuiltinModule, and its own small YAML-subset reader.

process.removeAllListeners("warning");

void (() => {
  const fs = process.getBuiltinModule("node:fs");
  const NAME = "check-pull-request-target.ts";
  const USAGE = `Usage: node scripts/${NAME} <workflow-file-or-directory>... [--json]
       node scripts/${NAME} - [--json]            (one workflow on standard input)

Reports, per workflow triggered by pull_request_target (a string, a list item or a mapping key):
prt-head-checkout, an actions/checkout step whose ref: resolves to the pull request head
(github.event.pull_request.head.sha or .head.ref, github.head_ref, refs/pull/*/merge or
refs/pull/*/head) or whose repository: is github.event.pull_request.head.repo.full_name. Any other
workflow passes. A YAML construct the reader cannot interpret (anchor, alias, merge key, multi-line
flow mapping, a with: written as a flow mapping) is the warning unparsed, never a silent pass.
A directory means every *.yml and *.yaml file directly under it.

Options: --json (one object {ok, data, findings} on stdout), --help (this text).
data: {files, errors, warnings}; a finding carries rule, message, path, line, severity.
Exit codes: 0 no error finding, 1 error finding, 2 usage error or no workflow file in a directory,
3 unreadable input.
`;

  interface Finding {
    rule: string;
    message: string;
    path?: string;
    line?: number;
    severity?: "error" | "warning";
  }
  const argv = process.argv.slice(2);
  let json = false;
  const emit = (code: number, data: unknown, findings: Finding[], summary: string): void => {
    if (json) {
      process.stdout.write(`${JSON.stringify({ ok: code === 0, data, findings })}\n`);
      process.stderr.write(`${summary}\n`);
    } else {
      if (code < 2)
        for (const f of findings)
          process.stdout.write(
            `${f.severity === "warning" ? "[WARN]" : "[FAIL]"} ${f.path ?? ""}:${f.line ?? 0}: ${f.rule}: ${f.message}\n`,
          );
      (code >= 2 ? process.stderr : process.stdout).write(`${summary}\n`);
    }
    process.exitCode = code;
  };
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    return;
  }
  json = argv.includes("--json");
  const fail = (code: number, rule: string, message: string, summary: string): void =>
    emit(code, null, [{ rule, message }], summary);
  const usageError = (message: string): void =>
    fail(2, "usage", message, `${NAME}: ${message}\n${USAGE.split("\n")[0]}`);

  const inputs: string[] = [];
  for (const a of argv) {
    if (a === "--json") continue;
    if (a.startsWith("-") && a !== "-") return usageError(`unknown option ${a}`);
    inputs.push(a);
  }
  if (inputs.length === 0) return usageError("a workflow file or directory is required");
  if (inputs.includes("-") && inputs.length > 1)
    return usageError("- (standard input) cannot be combined with other inputs");

  // Target validity: an empty directory is a usage-level refusal, an unreadable path is exit 3.
  const stat = (p: string): import("node:fs").Stats | undefined => {
    try {
      return fs.statSync(p);
    } catch {
      return undefined;
    }
  };
  const targets: string[] = [];
  for (const input of inputs) {
    if (input === "-") {
      targets.push("-");
      continue;
    }
    const st = stat(input);
    if (st?.isFile() === true) targets.push(input);
    else if (st?.isDirectory() === true) {
      let names: string[];
      try {
        names = fs.readdirSync(input);
      } catch {
        return fail(3, "precondition", `cannot read ${input}`, `[FAIL] not readable: ${input}`);
      }
      const dir = input.endsWith("/") ? input : `${input}/`;
      const found = names
        .filter((n) => /\.ya?ml$/.test(n) && stat(dir + n)?.isFile() === true)
        .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
        .map((n) => dir + n);
      if (found.length === 0)
        return fail(
          2,
          "usage",
          `no workflow file under ${input}`,
          `[FAIL] no workflow files found under: ${input}`,
        );
      targets.push(...found);
    } else
      return fail(
        3,
        "precondition",
        `${input} is not a readable file or directory`,
        `[FAIL] not a file or directory: ${input}`,
      );
  }
  const texts: { path: string; text: string }[] = [];
  for (const t of targets) {
    try {
      texts.push({
        path: t === "-" ? "<stdin>" : t,
        text: fs.readFileSync(t === "-" ? 0 : t, "utf8"),
      });
    } catch {
      return fail(3, "precondition", `cannot read ${t}`, `[FAIL] not readable: ${t}`);
    }
  }

  // --- YAML-subset reader: logical lines (comments and block-scalar bodies removed) -------------
  interface Ln {
    n: number;
    ind: number;
    t: string;
  }
  const stripComment = (s: string): string => {
    let q = "";
    for (let i = 0; i < s.length; i++) {
      const c = s[i] as string;
      if (q !== "") {
        if (c === q) q = "";
      } else if (c === '"' || c === "'") q = c;
      else if (c === "#" && (i === 0 || /\s/.test(s[i - 1] as string))) return s.slice(0, i);
    }
    return s;
  };
  const scan = (text: string): Ln[] => {
    const raw = text.split(/\r?\n/);
    const out: Ln[] = [];
    for (let i = 0; i < raw.length; i++) {
      const r = raw[i] as string;
      if (/^\s*(#.*)?$/.test(r) || /^(---|\.\.\.)\s*$/.test(r)) continue;
      const ind = r.length - r.trimStart().length;
      const t = stripComment(r).trim();
      out.push({ n: i + 1, ind, t });
      if (/(?:^|:\s+|-\s+)[|>][0-9+-]*$/.test(t)) {
        const pre = /^(?:-\s+)*/.exec(t)?.[0].length ?? 0;
        const eff = /^(?:-\s+)*[|>]/.test(t) ? ind : ind + pre;
        while (i + 1 < raw.length) {
          const nx = raw[i + 1] as string;
          if (nx.trim() !== "" && nx.length - nx.trimStart().length <= eff) break;
          i++;
        }
      }
    }
    return out;
  };
  const kv = (t: string): { key: string; value: string } | undefined => {
    const m = /^(?:-\s+)*("[^"]*"|'[^']*'|[^\s:#[{][^:]*?)\s*:(?:\s+(.*))?$/.exec(t);
    if (m === null) return undefined;
    return { key: (m[1] as string).replace(/^["']|["']$/g, ""), value: (m[2] ?? "").trim() };
  };
  const ANCHOR = /^(?:-\s+)*(?:(?:"[^"]*"|'[^']*'|[^\s:#][^:]*?):\s+)?[&*][A-Za-z0-9_-]+(?:\s|$)/;
  const MERGE = /^(?:-\s+)*<<:/;

  // --- the rules ---------------------------------------------------------------------------------
  const ROUTE =
    "check out the base ref instead, or split the untrusted build into a pull_request workflow and hand its result to a workflow_run workflow";
  const HEAD_REF =
    /github\.event\.pull_request\.head\.(?:sha|ref)\b|github\.head_ref\b|refs\/pull\/.+?\/(?:merge|head)\b/;
  const HEAD_REPO = /github\.event\.pull_request\.head\.repo\.full_name\b/;
  const unbalanced = (v: string): boolean =>
    /^[[{]/.test(v) && !/^(?:\[[^[\]{}]*\]|\{[^[\]{}]*\})$/.test(v);

  const check = (path: string, text: string): Finding[] => {
    const found: Finding[] = [];
    const add = (rule: string, n: number, message: string, severity: "error" | "warning"): void => {
      found.push({ rule, message, path, line: n, severity });
    };
    const unparsed = (n: number, what: string): void =>
      add(
        "unparsed",
        n,
        `line ${n} uses ${what} that this check cannot read, so the workflow is not verified on it: write the plain block form or review by hand`,
        "warning",
      );
    const lines = scan(text);
    for (const l of lines) {
      if (ANCHOR.test(l.t) || MERGE.test(l.t)) unparsed(l.n, "a YAML anchor, alias or merge key");
    }

    // Triggers: the on: key at column 0, its inline value, or the shallowest lines of its block.
    const onAt = lines.findIndex((l) => l.ind === 0 && kv(l.t)?.key === "on");
    if (onAt < 0) return found;
    const on = lines[onAt] as Ln;
    const inline = kv(on.t)?.value ?? "";
    let prt = false;
    if (inline !== "") {
      if (unbalanced(inline)) unparsed(on.n, "a multi-line flow value for on:");
      prt = new RegExp("(?:^|[\\s\\[{,\"'])pull_request_target(?:$|[\\s\\]},:\"'])").test(inline);
    } else {
      const block: Ln[] = [];
      for (let i = onAt + 1; i < lines.length; i++) {
        const l = lines[i] as Ln;
        if (l.ind === 0 && !l.t.startsWith("- ")) break;
        block.push(l);
      }
      const min = Math.min(...block.map((l) => l.ind));
      prt = block.some(
        (l) => l.ind === min && /^(?:-\s+)?["']?pull_request_target["']?\s*(?::|$)/.test(l.t),
      );
    }
    if (!prt) return found;

    // Checkout steps: a uses: line, then the ref: and repository: keys of the step's with: block.
    lines.forEach((l, i) => {
      const k = kv(l.t);
      if (k?.key !== "uses" || !/^["']?actions\/checkout(?:@|["']?$)/.test(k.value)) return;
      const keyInd = l.t.startsWith("- ") ? l.ind + 2 : l.ind;
      let start = i;
      if (!l.t.startsWith("- "))
        while (
          start > 0 &&
          !((lines[start] as Ln).ind === keyInd - 2 && (lines[start] as Ln).t.startsWith("- "))
        )
          start--;
      const dash = (lines[start] as Ln).ind;
      let end = start + 1;
      while (end < lines.length && (lines[end] as Ln).ind > dash) end++;
      const step = lines.slice(start, end);
      const withAt = step.findIndex((s) => s.ind === keyInd && kv(s.t)?.key === "with");
      if (withAt < 0) return;
      const w = step[withAt] as Ln;
      if ((kv(w.t)?.value ?? "") !== "") {
        unparsed(w.n, "a with: value written as a flow mapping");
        return;
      }
      for (const s of step.slice(withAt + 1)) {
        if (s.ind <= keyInd) break;
        const p = kv(s.t);
        if (p?.key === "ref" && HEAD_REF.test(p.value))
          add(
            "prt-head-checkout",
            s.n,
            `actions/checkout takes ref: ${p.value} under pull_request_target, which runs untrusted pull request code with the base repository secrets: ${ROUTE}`,
            "error",
          );
        if (p?.key === "repository" && HEAD_REPO.test(p.value))
          add(
            "prt-head-checkout",
            s.n,
            `actions/checkout takes the head repository under pull_request_target, which runs untrusted pull request code with the base repository secrets: ${ROUTE}`,
            "error",
          );
      }
    });
    return found.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  };

  const findings = texts.flatMap((f) => check(f.path, f.text));
  const errors = findings.filter((f) => f.severity !== "warning").length;
  const warnings = findings.length - errors;
  const files = texts.map((f) => f.path);
  const summary =
    errors === 0
      ? `[OK] ${files.length} workflow file(s) checked, no head checkout under pull_request_target${warnings > 0 ? ` (${warnings} warning(s))` : ""}`
      : `${errors} error(s) and ${warnings} warning(s) in ${files.length} workflow file(s)`;
  emit(errors === 0 ? 0 : 1, { files, errors, warnings }, findings, summary);
})();
