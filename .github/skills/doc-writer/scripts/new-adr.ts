// new-adr.ts — mint the next ADR number and write the ADR skeleton from the bundled template.
// Usage: node scripts/new-adr.ts --title <text> [--dir <path>] [--status <value>]
//          [--template <file>] [--dry-run] [--json]
// Exit codes: 0 done, 1 a finding (empty title or slug, unknown status, existing target, no free
// number), 2 usage error, 3 precondition failed (unreadable directory or template).
// Contract: docs/skill-authoring-standard.md (the script contract). Self-contained on purpose: no
// import, built-ins through process.getBuiltinModule.

process.removeAllListeners("warning");

void (() => {
  const fs = process.getBuiltinModule("node:fs");
  const path = process.getBuiltinModule("node:path");

  const NAME = "new-adr.ts";
  const USAGE = `Usage: node scripts/${NAME} --title <text> [--dir <path>] [--status <value>] [options]

Writes <dir>/<NNNN>-<slug>.md, where NNNN is one more than the highest four-digit prefix of the
files in <dir> (0001 for an empty or missing directory), from the ADR template.

Options:
  --title <text>      the decision, as the ADR title (required)
  --dir <path>        the ADR directory (default: docs/adr)
  --status <value>    Proposed (default), Accepted, Deprecated or "Superseded by ADR-NNNN"
  --template <file>   a template with {{NUMBER}}, {{TITLE}} and {{STATUS}} (default: the
                      adr.template.md asset next to scripts/)
  --dry-run           write nothing; print the path and the content
  --json              print one JSON object {ok, data, findings} on stdout
  --help              print this text

The number comes from the local directory only: it cannot see a number reserved on another branch
or in an open pull request. Check open pull requests for the same number before keeping it.

data: {path, number, slug, status, dry_run, written}

Exit codes: 0 done, 1 finding, 2 usage error, 3 precondition failed.
`;

  interface Finding {
    rule: string;
    message: string;
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
  const precondition = (message: string): void =>
    emit(3, null, [{ rule: "precondition", message }], `${NAME}: ${message}`);
  const refuse = (rule: string, message: string): void =>
    emit(1, null, [{ rule, message }], `${NAME}: ${message}`);

  const opts: Record<string, string> = {};
  let dryRun = false;
  const VALUE = new Set(["--title", "--dir", "--status", "--template"]);
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i] as string;
    const eq = raw.startsWith("--") ? raw.indexOf("=") : -1;
    const key = eq !== -1 ? raw.slice(0, eq) : raw;
    if (key === "--json") continue;
    if (key === "--dry-run" && eq === -1) dryRun = true;
    else if (VALUE.has(key)) {
      const v = eq !== -1 ? raw.slice(eq + 1) : argv[++i];
      if (v === undefined || (eq === -1 && v.startsWith("--")))
        return usageError(`${key} needs a value`);
      opts[key] = v;
    } else if (raw.startsWith("-")) return usageError(`unknown option ${raw}`);
    else return usageError(`unexpected argument ${raw}`);
  }
  if (opts["--title"] === undefined) return usageError("--title is required");
  const title = opts["--title"].trim().replace(/\s+/g, " ");
  const status = (opts["--status"] ?? "Proposed").trim();
  const dir = opts["--dir"] ?? "docs/adr";

  if (title === "") return refuse("title", "the title is empty; state the decision in a few words");
  if (!/^(Proposed|Accepted|Deprecated|Superseded by ADR-[0-9]{4})$/.test(status))
    return refuse(
      "status",
      `status "${status}" is not Proposed, Accepted, Deprecated or "Superseded by ADR-NNNN"`,
    );
  // Accents are removed, not dropped: "Décision" becomes "decision".
  const slug = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
  if (slug === "")
    return refuse("slug", `the title "${title}" leaves no ASCII letter or digit for a file name`);

  let names: string[] = [];
  if (fs.existsSync(dir)) {
    try {
      names = fs.readdirSync(dir) as string[];
    } catch (e) {
      return precondition(`cannot read ${dir}: ${(e as Error).message}`);
    }
  }
  const highest = names.reduce((n, f) => {
    const m = /^([0-9]{4})-/.exec(f);
    return m === null ? n : Math.max(n, Number(m[1]));
  }, 0);
  if (highest >= 9999) return refuse("number", "no four-digit ADR number is left");
  const number = String(highest + 1).padStart(4, "0");

  let templateFile = opts["--template"];
  if (templateFile === undefined) {
    let here = "";
    try {
      here = path.dirname(fs.realpathSync(process.argv[1] ?? ""));
    } catch {
      // no script directory to resolve from
    }
    templateFile = path.join(here, "..", "assets", "adr.template.md");
  }
  let template: string;
  try {
    template = fs.readFileSync(templateFile, "utf8") as string;
  } catch (e) {
    return precondition(`cannot read the template ${templateFile}: ${(e as Error).message}`);
  }
  const content = template
    .replaceAll("{{NUMBER}}", number)
    .replaceAll("{{STATUS}}", status)
    .replaceAll("{{TITLE}}", title);

  const target = path.join(dir, `${number}-${slug}.md`);
  const rel = target.split(path.sep).join("/");
  const base = { path: rel, number, slug, status, dry_run: dryRun, written: false };
  if (fs.existsSync(target))
    return emit(
      1,
      base,
      [{ rule: "target-exists", message: `${rel} already exists; choose another title` }],
      `${NAME}: ${rel} already exists; nothing written`,
    );
  if (dryRun)
    return emit(
      0,
      base,
      [],
      `${NAME}: dry run, nothing written. Target: ${rel}\n--- content ---\n${content}`,
    );
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(target, content);
  } catch (e) {
    return precondition(`cannot write ${rel}: ${(e as Error).message}`);
  }
  emit(0, { ...base, written: true }, [], `${NAME}: wrote ${rel}`);
})();
