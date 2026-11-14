// lint-config-file.ts — check that a CrewRig config file has the shape of its kind.
// Usage: node lint-config-file.ts --kind team|expertise|profile|soul <file|-> [--json]
// Contract: references/script-contract.md. Exit codes: 0 no error finding (warnings allowed),
// 1 at least one error finding, 2 usage error, 3 unreadable input.
// Self-contained on purpose: no import, built-ins through process.getBuiltinModule.

process.removeAllListeners("warning");

void (() => {
  const fs = process.getBuiltinModule("node:fs");
  const NAME = "lint-config-file.ts";
  const USAGE = `Usage: node ${NAME} --kind team|expertise|profile|soul <file|-> [--json]

Checks the sections of a config file against the shape of its kind and reports placeholder text,
so an unmodified template cannot pass for content.

Options:
  --kind <kind>  team, expertise, profile or soul
  --json         print one JSON object {ok, data, findings} on stdout
  --help         print this text

Shapes:
  team       H1 "Team <Name>", then Mission, Technology Stack, Development Practices, and optionally
             Rituals, Collaboration Norms, Documentation, Issue Tracking, Key Contacts, in that order
  expertise  H1, a summary paragraph, then Responsibilities or Stack (one of them), then Key Practices
  profile    H1 "Personal Profile", then Identity (Full Name, Email), Tooling Preferences, Active
             Projects, Growth Plan, Working Philosophy, and a valid Last Updated date
  soul       H1 "SOUL.md", then the five SOUL-E sections in order

data: {kind, sections}
Finding rules: title, summary-missing, section-missing, section-order, section-duplicate,
shape-conflict, section-empty, no-bullets, field-missing, last-updated, placeholder,
section-unknown (warning).

Exit codes: 0 no error finding, 1 an error finding, 2 usage error, 3 unreadable input.
`;
  interface Finding {
    rule: string;
    message: string;
    severity?: "warning";
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
  let kind: string | undefined;
  const files: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i] as string;
    if (raw === "--json") continue;
    const eq = raw.startsWith("--") ? raw.indexOf("=") : -1;
    const key = eq === -1 ? raw : raw.slice(0, eq);
    if (key === "--kind") {
      const value = eq !== -1 ? raw.slice(eq + 1) : argv[++i];
      if (value === undefined) return usageError("--kind needs a value");
      kind = value;
    } else if (raw.startsWith("-") && raw !== "-") return usageError(`unknown option ${raw}`);
    else files.push(raw);
  }
  if (kind !== "team" && kind !== "expertise" && kind !== "profile" && kind !== "soul")
    return usageError("--kind is required and must be team, expertise, profile or soul");
  if (files.length !== 1)
    return usageError("exactly one file is required (or - for standard input)");
  const file = files[0] as string;
  let text: string;
  try {
    text = fs.readFileSync(file === "-" ? 0 : file, "utf8");
  } catch (e) {
    return emit(
      3,
      null,
      [{ rule: "precondition", message: `cannot read ${file}: ${(e as Error).message}` }],
      `${NAME}: cannot read ${file}`,
    );
  }

  const findings: Finding[] = [];
  const err = (rule: string, message: string): void => void findings.push({ rule, message });
  const warn = (rule: string, message: string): void =>
    void findings.push({ rule, message, severity: "warning" });

  // Split outside fenced code into the H1 list and the H2 sections with their body lines.
  const h1: string[] = [];
  const secs: { name: string; body: string[] }[] = [];
  const intro: string[] = [];
  let fence = false;
  for (const line of text.replace(/\r/g, "").split("\n")) {
    if (/^ {0,3}(```|~~~)/.test(line)) fence = !fence;
    const h = fence ? null : /^(#{1,2}) +(.*?) *$/.exec(line);
    if (h !== null && h[1] === "#") h1.push(h[2] as string);
    else if (h !== null) secs.push({ name: h[2] as string, body: [] });
    else (secs.length > 0 ? (secs[secs.length - 1] as { body: string[] }).body : intro).push(line);
  }
  const content = (lines: string[]): string[] =>
    lines.filter((l) => l.trim() !== "" && l.trim() !== "---");
  const names = secs.map((s) => s.name);

  const title = (re: RegExp, shape: string): void => {
    if (h1.length !== 1 || !re.test(h1[0] as string))
      err("title", `expected exactly one H1 shaped ${shape}`);
  };
  const required = (list: string[]): void => {
    for (const r of list)
      if (!names.includes(r)) err("section-missing", `missing section "## ${r}"`);
  };
  const order = (canonical: string[]): void => {
    const seen = new Set<string>();
    let last = -1;
    for (const n of names) {
      if (seen.has(n)) err("section-duplicate", `section "## ${n}" appears more than once`);
      seen.add(n);
      const at = canonical.indexOf(n);
      if (at === -1) warn("section-unknown", `section "## ${n}" is not part of the ${kind} shape`);
      else if (at < last)
        err("section-order", `section "## ${n}" is out of order; expected ${canonical.join(", ")}`);
      else last = at;
    }
  };
  const nonEmpty = (): void => {
    for (const s of secs)
      if (content(s.body).length === 0)
        err("section-empty", `section "## ${s.name}" has no content`);
  };
  const body = (name: string): string[] => content(secs.find((s) => s.name === name)?.body ?? []);

  if (kind === "team") {
    title(/^Team \S/, '"Team <Name>"');
    const core = ["Mission", "Technology Stack", "Development Practices"];
    const optional = [
      "Rituals",
      "Collaboration Norms",
      "Documentation",
      "Issue Tracking",
      "Key Contacts",
    ];
    required(core);
    order([...core, ...optional]);
    nonEmpty();
  } else if (kind === "expertise") {
    title(/\S/, "a role name");
    if (content(intro).length === 0)
      err("summary-missing", "a one-line summary must follow the H1");
    const shapes = names.filter((n) => n === "Responsibilities" || n === "Stack");
    if (shapes.length === 0)
      err("section-missing", 'missing section "## Responsibilities" or "## Stack"');
    if (shapes.length > 1)
      err("shape-conflict", 'use either "## Responsibilities" or "## Stack", not both');
    required(["Key Practices"]);
    order([...(names.includes("Stack") ? ["Stack"] : ["Responsibilities"]), "Key Practices"]);
    nonEmpty();
    for (const n of [...shapes, "Key Practices"])
      if (names.includes(n) && !body(n).some((l) => /^[-*] /.test(l)))
        err("no-bullets", `section "## ${n}" needs at least one bullet`);
  } else if (kind === "profile") {
    title(/^Personal Profile$/, '"Personal Profile"');
    const all = [
      "Identity",
      "Tooling Preferences",
      "Active Projects",
      "Growth Plan",
      "Working Philosophy",
    ];
    required(all);
    order(all);
    for (const f of ["Full Name", "Email"])
      if (!body("Identity").some((l) => new RegExp(`^- \\*\\*${f}:\\*\\* *\\S`).test(l)))
        err("field-missing", `Identity needs a "- **${f}:** <value>" line`);
    const stamp = /\*\*Last Updated:\*\* *(\d{4}-\d{2}-\d{2})\s*$/m.exec(text);
    if (stamp === null || Number.isNaN(Date.parse(stamp[1] as string)))
      err(
        "last-updated",
        'the file must end with "**Last Updated:** YYYY-MM-DD" holding a real date',
      );
    if (/\(e\.g\.,/.test(text) || /\*\*Project Name\*\*/.test(text))
      err("placeholder", "example text from the template is still present; replace or remove it");
  } else {
    title(/^SOUL\.md\b/, '"SOUL.md ..."');
    const all = [
      "S - Stance",
      "O - Origin",
      "U - Understanding",
      "L - Lineage",
      "E - Error Handling & Tenacity",
    ];
    required(all);
    order(all);
    nonEmpty();
  }
  const ph = /\$\{[A-Z_]+\}|\b(TODO|TBD|FIXME)\b|^\s*[-*] *(…|\.\.\.) *$/m.exec(text);
  if (ph !== null)
    err(
      "placeholder",
      `placeholder text "${ph[0].trim()}" is still present; replace it with content`,
    );

  const errors = findings.filter((f) => f.severity !== "warning");
  const lines = findings.map(
    (f) => `${f.severity === "warning" ? "WARN" : "ERROR"} ${file} [${f.rule}] ${f.message}`,
  );
  emit(
    errors.length > 0 ? 1 : 0,
    { kind, sections: names },
    findings,
    lines.length > 0 ? lines.join("\n") : `${file}: ok`,
  );
})();
