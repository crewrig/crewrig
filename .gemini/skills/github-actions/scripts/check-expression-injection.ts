// check-expression-injection.ts — flag attacker-controlled event data interpolated into a shell step.
// Usage: node scripts/check-expression-injection.ts <workflow-file-or-directory>... [--json]   (or - for stdin)
// Exit codes: 0 no error finding (warnings are listed), 1 error finding, 2 usage error or a
// directory with no workflow file, 3 unreadable input. Writes nothing, makes no network call.
// Contract: docs/skill-authoring-standard.md (the script contract). Self-contained on purpose: no
// import, built-ins through process.getBuiltinModule, and its own small YAML-subset reader.

process.removeAllListeners("warning");

void (() => {
  const fs = process.getBuiltinModule("node:fs");
  const NAME = "check-expression-injection.ts";
  const USAGE = `Usage: node scripts/${NAME} <workflow-file-or-directory>... [--json]
       node scripts/${NAME} - [--json]            (one workflow on standard input)

Reports expression-injection: a ${{}} expression inside a run: value, or the script: input of
actions/github-script, that reads an attacker-controllable field (issue, pull request, comment,
review and commit titles, bodies, messages, labels, branch names, author and committer names and
emails, github.head_ref). Bind the value under env: and read "$VAR" instead. Trusted fields
(github.sha, github.repository, secrets.*, github.event.repository.name) pass. The warning
expression-injection-input marks an inputs.* expression in a run: value, because a single file
cannot know who calls it. A directory means every *.yml and *.yaml file directly under it. A YAML
construct the reader cannot interpret (anchor, alias, merge key, a step written as a flow mapping)
is the warning unparsed, never a silent pass.

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
    body: { n: number; s: string }[];
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
      const ln: Ln = { n: i + 1, ind, t, body: [] };
      out.push(ln);
      if (/(?:^|:\s+|-\s+)[|>][0-9+-]*$/.test(t)) {
        const pre = /^(?:-\s+)*/.exec(t)?.[0].length ?? 0;
        const eff = /^(?:-\s+)*[|>]/.test(t) ? ind : ind + pre;
        while (i + 1 < raw.length) {
          const nx = raw[i + 1] as string;
          if (nx.trim() !== "" && nx.length - nx.trimStart().length <= eff) break;
          i++;
          ln.body.push({ n: i + 1, s: nx });
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
  const EXACT = new Set([
    "github.event.issue.title",
    "github.event.issue.body",
    "github.event.pull_request.title",
    "github.event.pull_request.body",
    "github.event.pull_request.head.ref",
    "github.event.pull_request.head.label",
    "github.event.comment.body",
    "github.event.review.body",
    "github.event.head_commit.message",
    "github.event.commits[*].message",
    "github.event.commits[*].author.name",
    "github.event.commits[*].author.email",
    "github.event.head_commit.author.name",
    "github.event.head_commit.author.email",
    "github.head_ref",
  ]);
  const hostile = (path: string): boolean =>
    EXACT.has(path) ||
    (path.startsWith("github.event.") &&
      (/\.(?:body|title|message|label)$/.test(path) ||
        /\.(?:author|committer)\.(?:name|email)$/.test(path)));

  const check = (path: string, text: string): Finding[] => {
    const found: Finding[] = [];
    const add = (rule: string, n: number, message: string, severity: "error" | "warning"): void => {
      found.push({ rule, message, path, line: n, severity });
    };
    const unparsed = (n: number, what: string): void =>
      add(
        "unparsed",
        n,
        `line ${n} uses ${what} that this check cannot read, so the shell steps are not verified on it: write the plain block form or review by hand`,
        "warning",
      );
    const lines = scan(text);
    lines.forEach((l, i) => {
      if (ANCHOR.test(l.t) || MERGE.test(l.t)) unparsed(l.n, "a YAML anchor, alias or merge key");
      else if (/^-\s+\{/.test(l.t)) unparsed(l.n, "a step written as a flow mapping");

      const k = kv(l.t);
      if (k === undefined || (k.key !== "run" && k.key !== "script")) return;
      if (k.key === "script") {
        // Only the script: input of actions/github-script is code; find the step that holds it.
        let s = i;
        while (s > 0 && !((lines[s] as Ln).ind < l.ind && (lines[s] as Ln).t.startsWith("- "))) s--;
        const dash = (lines[s] as Ln).ind;
        let e = s + 1;
        while (e < lines.length && (lines[e] as Ln).ind > dash) e++;
        const isScript = lines
          .slice(s, e)
          .some((x) => /^(?:-\s+)?uses:\s*["']?actions\/github-script@/.test(x.t));
        if (!isScript) return;
      }
      const values: { n: number; s: string }[] =
        l.body.length > 0 ? l.body : [{ n: l.n, s: k.value }];
      const seen = new Set<string>();
      for (const v of values) {
        for (const m of v.s.matchAll(/\$\{\{([\s\S]*?)\}\}/g)) {
          const expr = m[1] as string;
          const paths = expr.match(/(?<![\w.])github(?:\.[A-Za-z0-9_-]+|\[[^\]]*\])+/g) ?? [];
          for (const raw of paths) {
            const p = raw.replace(/\[[^\]]*\]/g, "[*]");
            if (!hostile(p) || seen.has(`${v.n}:${p}`)) continue;
            seen.add(`${v.n}:${p}`);
            add(
              "expression-injection",
              v.n,
              `\${{ ${raw} }} is attacker-controlled and is pasted into the ${k.key} code before it runs: bind it under env: (for example PR_TITLE: \${{ ${raw} }}) and read "$PR_TITLE" instead, which passes this check`,
              "error",
            );
          }
          for (const ip of expr.match(/(?<![\w.])inputs\.[A-Za-z0-9_-]+/g) ?? []) {
            if (seen.has(`${v.n}:${ip}`)) continue;
            seen.add(`${v.n}:${ip}`);
            add(
              "expression-injection-input",
              v.n,
              `\${{ ${ip} }} is pasted into the ${k.key} code and one file cannot know who calls this workflow: bind it under env: and read "$VAR" instead`,
              "warning",
            );
          }
        }
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
      ? `[OK] ${files.length} workflow file(s) checked, no expression injection${warnings > 0 ? ` (${warnings} warning(s))` : ""}`
      : `${errors} error(s) and ${warnings} warning(s) in ${files.length} workflow file(s)`;
  emit(errors === 0 ? 0 : 1, { files, errors, warnings }, findings, summary);
})();
