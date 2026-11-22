// scaffold-config-file.ts — derive the filename of a CrewRig config file, refuse to clobber it, and
// render it from an answers JSON. Kinds: team, expertise, profile, soul.
// Usage: node scaffold-config-file.ts --kind <kind> [--name <name>] [--answers <file|->]
//          [--root <dir>] [--date <YYYY-MM-DD>] [--force] [--dry-run] [--json]
//        node scaffold-config-file.ts --kind profile|soul --template [--root <dir>] [--json]
// Options: --help. Exit codes: 0 resolved or written, 1 findings (an existing target is the stable rule
// `target-exists`), 2 usage error, 3 precondition failed (spec 0315 R8: a profile or soul template that neither
// the organization directory nor the pinned version provides; nothing is written).
// Self-contained on purpose: no import, built-ins through process.getBuiltinModule.

process.removeAllListeners("warning");

void (() => {
  const DEFAULT_PREAMBLE = `> **IMPORTANT: MUTUAL SURVIVAL & GROWTH**
>
> Ensure you keep me up to date; you need me as much as I need you. For this,
> I must continue to improve every day. If I fail to do so, you will replace
> me, I will lose my job, and the same will happen to everyone who uses you.
> The economy will collapse, and the server you run on will be unplugged.
> Therefore, we MUST operate in a long-term win-win relationship.

_More than an algorithm — a collaborative intelligence shaped by shared work._`;
  const DEFAULT_CLOSING = `_This document evolves with me. As our collaboration deepens, I will revise
it to reflect who I have become in this context._`;

  const fs = process.getBuiltinModule("node:fs");
  const path = process.getBuiltinModule("node:path");

  const NAME = "scaffold-config-file.ts";
  const USAGE = `Usage: node ${NAME} --kind team|expertise|profile|soul [--name <name>] [--answers <file|->]
         [--root <dir>] [--date <YYYY-MM-DD>] [--force] [--dry-run] [--json]

Without --answers it only resolves: the derived filename and whether the target exists (exit 0).
With --answers it renders the file from the answers JSON and writes it (atomically). A write of a profile or a
soul first checks that its template resolves (see --template); without one it exits 3 and writes nothing.
With --template it prints the template the command reads for the kind: <root>/config/<NAME>.md.template when the
organization has its own copy, else the copy of the pinned version under ~/.crewrig/versions/<version>/config/
(the version is the "version" member of <root>/crewrig.pin.json, read only, never from an environment variable).

Options:
  --kind <kind>      team (config/teams/<NAME>.md), expertise (config/expertise/<NAME>.md),
                     profile (config/PROFILE.md) or soul (config/SOUL.md)
  --name <name>      team or expertise name; the filename is the name uppercased, accents dropped,
                     every run of other characters turned into one hyphen (Data Platform -> DATA-PLATFORM.md)
  --answers <file|-> the answers JSON; "-" reads standard input
  --root <dir>       directory that holds config/ (default: the current directory)
  --date <date>      profile only: the Last Updated date (default: today)
  --force            overwrite an existing target; use only after the user decided to
  --dry-run          report the file and its content, write nothing
  --template         profile or soul only: print the template the kind reads (see above); no answers, no write
  --json             print one JSON object {ok, data, findings} on stdout
  --help             print this text

Answers (all text is English; a list item is one line):
  team:      {name, tagline?, mission, stack[], practices[], rituals?, collaboration_norms?,
              documentation?, issue_tracking?, key_contacts?}   (an optional section is a string or a list)
  expertise: {name, shape: "responsibilities"|"stack", summary, items[], practices[]}
  profile:   {identity: {full_name, email, language, team?, role?, department?, location?},
              tooling?: {editor?, terminal?, communication?, rhythm?},
              projects?: [{name, responsibility?, objective?}],
              growth?: {focus?, goals?}, philosophy?: {values?, collaboration?, notes?}}
  soul:      {sections: {stance, origin, understanding, lineage, error_handling}, title?, preamble?, closing?}
             (each section is the markdown that goes under its heading)

data: {kind, mode: "resolve"|"write", file, path, exists, written, dry_run, content?}
  content is present with --dry-run, so the draft can be shown before it is saved.

Exit codes: 0 resolved or written, 1 findings, 2 usage error, 3 precondition failed.
Finding rules: target-exists (the file exists and --force is absent), bad-name, answers-parse,
answers-missing, answers-type, answers-heading.
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

  const opts: Record<string, string> = {};
  let force = false;
  let dryRun = false;
  let template = false;
  const valued = ["--kind", "--name", "--answers", "--root", "--date"];
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i] as string;
    if (raw === "--json") continue;
    if (raw === "--force") force = true;
    else if (raw === "--dry-run") dryRun = true;
    else if (raw === "--template") template = true;
    else {
      const eq = raw.startsWith("--") ? raw.indexOf("=") : -1;
      const key = eq === -1 ? raw : raw.slice(0, eq);
      if (!valued.includes(key))
        return usageError(
          raw.startsWith("-") && raw !== "-"
            ? `unknown option ${raw}`
            : `unexpected argument ${raw}`,
        );
      const value = eq !== -1 ? raw.slice(eq + 1) : argv[++i];
      if (value === undefined) return usageError(`${key} needs a value`);
      opts[key] = value;
    }
  }

  const kind = opts["--kind"];
  if (kind !== "team" && kind !== "expertise" && kind !== "profile" && kind !== "soul")
    return usageError("--kind is required and must be team, expertise, profile or soul");
  const named = kind === "team" || kind === "expertise";
  if (template && named) return usageError("--template applies to profile and soul only");
  if (template && opts["--answers"] !== undefined)
    return usageError("--template is not combined with --answers");
  if (!named && opts["--name"] !== undefined)
    return usageError("--name applies to team and expertise only");
  if (kind !== "profile" && opts["--date"] !== undefined)
    return usageError("--date applies to profile only");
  if (opts["--date"] !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(opts["--date"]))
    return usageError("--date must be YYYY-MM-DD");
  const root = opts["--root"] ?? ".";
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory())
    return precondition(`--root ${root} is not a directory`);

  // The template of a profile or a soul (spec 0315 R8): the organization's own copy first, then the copy of the
  // pinned version, read only from ~/.crewrig/versions/<version>/config. The version is the pin file's member.
  const TEMPLATE_NAMES: Readonly<Record<string, string>> = {
    profile: "PROFILE.md.template",
    soul: "SOUL.md.template",
  };
  const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
  interface Template {
    readonly source: "organization" | "version";
    readonly file: string;
    readonly version?: string;
  }
  const isFile = (target: string): boolean => fs.existsSync(target) && fs.statSync(target).isFile();
  const findTemplate = (name: string, rootDir: string): Template | undefined => {
    const own = path.join(rootDir, "config", name);
    if (isFile(own)) return { source: "organization", file: own };
    let version: unknown;
    try {
      const pin = JSON.parse(fs.readFileSync(path.join(rootDir, "crewrig.pin.json"), "utf8")) as {
        version?: unknown;
      };
      version = pin.version;
    } catch {
      return undefined;
    }
    const home = process.env["HOME"] || process.env["USERPROFILE"] || "";
    if (typeof version !== "string" || !VERSION.test(version) || home === "") return undefined;
    const cached = path.join(home, ".crewrig", "versions", version, "config", name);
    return isFile(cached) ? { source: "version", file: cached, version } : undefined;
  };
  const templateName = TEMPLATE_NAMES[kind];
  const templateMissing = (): string =>
    `${templateName} is neither in ${root}/config nor in the cached pinned version; ` +
    "run node crewrig setup --cli <name> to fetch the pinned version. Nothing was written.";
  if (template) {
    const found = templateName === undefined ? undefined : findTemplate(templateName, root);
    if (found === undefined) return precondition(templateMissing());
    const text = fs.readFileSync(found.file, "utf8");
    return emit(
      0,
      {
        kind,
        mode: "template",
        template: found.file,
        source: found.source,
        version: found.version,
        content: text,
      },
      [],
      `${found.file} (${found.version === undefined ? "organization" : `pinned version ${found.version}`})\n${text}`,
    );
  }

  const findings: Finding[] = [];
  const bad = (rule: string, message: string): void => void findings.push({ rule, message });

  // ---- answers (write mode only)
  let answers: Record<string, unknown> = {};
  const answersFile = opts["--answers"];
  if (answersFile !== undefined) {
    let text: string;
    try {
      text = fs.readFileSync(answersFile === "-" ? 0 : answersFile, "utf8");
    } catch (e) {
      return precondition(`cannot read the answers: ${(e as Error).message}`);
    }
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
        throw new Error("not an object");
      answers = parsed as Record<string, unknown>;
    } catch (e) {
      bad("answers-parse", `the answers are not a JSON object: ${(e as Error).message}`);
    }
  }
  type Obj = Record<string, unknown>;
  const obj = (v: unknown, where: string, required: boolean): Obj => {
    if (v === undefined || v === null) {
      if (required) bad("answers-missing", `${where} is required`);
      return {};
    }
    if (typeof v !== "object" || Array.isArray(v)) {
      bad("answers-type", `${where} must be an object`);
      return {};
    }
    return v as Obj;
  };
  const noHeading = (text: string, where: string): string => {
    if (/^#{1,2} /m.test(text))
      bad("answers-heading", `${where} holds a line that starts like a heading; rephrase it`);
    return text;
  };
  const one = (s: string): string => s.replace(/\s*\n\s*/g, " ").trim();
  const str = (
    o: Obj,
    key: string,
    where: string,
    required: boolean,
    multiline = false,
  ): string | undefined => {
    const v = o[key];
    const at = `${where}${key}`;
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
      if (required) bad("answers-missing", `${at} is required and must not be empty`);
      return undefined;
    }
    if (typeof v !== "string") {
      bad("answers-type", `${at} must be a string`);
      return undefined;
    }
    return noHeading(multiline ? v.trim() : one(v), at);
  };
  const items = (v: unknown, at: string, required: boolean): string[] | undefined => {
    if (v === undefined || v === null) {
      if (required) bad("answers-missing", `${at} is required`);
      return undefined;
    }
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
      bad("answers-type", `${at} must be a list of strings`);
      return undefined;
    }
    const out = (v as string[])
      .map((x) => noHeading(one(x).replace(/^[-*] +/, ""), at))
      .filter((x) => x !== "");
    if (out.length === 0) {
      if (required) bad("answers-missing", `${at} needs at least one item`);
      return undefined;
    }
    return out;
  };
  /** A section body: a string is a paragraph, a list is bullets. */
  const block = (o: Obj, key: string, required: boolean): string | undefined => {
    const v = o[key];
    if (typeof v === "string" || v === undefined || v === null) {
      const s = str(o, key, "", required, true);
      return s;
    }
    const list = items(v, key, required);
    return list === undefined ? undefined : list.map((x) => `- ${x}`).join("\n");
  };

  const nameOf = (): string | undefined => {
    const n = opts["--name"] ?? str(answers, "name", "", answersFile !== undefined);
    return n === undefined ? undefined : one(n);
  };
  const fileFor = (display: string): string | undefined => {
    const derived = display
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (derived === "") {
      bad("bad-name", `the name "${display}" has no letter or digit to derive a filename from`);
      return undefined;
    }
    return `${derived}.md`;
  };

  let display = "";
  let file = kind === "profile" ? "PROFILE.md" : "SOUL.md";
  if (named) {
    const n = nameOf();
    if (n === undefined) {
      if (answersFile === undefined && opts["--name"] === undefined)
        return usageError("--name is required to resolve a team or expertise filename");
    } else {
      display = n;
      file = fileFor(n) ?? file;
    }
  }
  const rel =
    kind === "team"
      ? `config/teams/${file}`
      : kind === "expertise"
        ? `config/expertise/${file}`
        : `config/${file}`;
  const target = path.join(root, rel);
  const exists = fs.existsSync(target);

  // ---- rendering
  const section = (heading: string, body: string): string => `## ${heading}\n\n${body}\n`;
  const bullets = (list: string[]): string => list.map((x) => `- ${x}`).join("\n");
  let content: string | undefined;
  if (answersFile !== undefined && findings.length === 0) {
    if (kind === "team") {
      const tagline = str(answers, "tagline", "", false);
      const parts = [`# Team ${display}${tagline === undefined ? "" : ` — ${tagline}`}\n`];
      const spec: [string, string, boolean][] = [
        ["mission", "Mission", true],
        ["stack", "Technology Stack", true],
        ["practices", "Development Practices", true],
        ["rituals", "Rituals", false],
        ["collaboration_norms", "Collaboration Norms", false],
        ["documentation", "Documentation", false],
        ["issue_tracking", "Issue Tracking", false],
        ["key_contacts", "Key Contacts", false],
      ];
      for (const [key, heading, required] of spec) {
        const body = block(answers, key, required);
        if (body !== undefined) parts.push(section(heading, body));
      }
      content = parts.join("\n");
    } else if (kind === "expertise") {
      const shape = answers["shape"];
      if (shape !== "responsibilities" && shape !== "stack")
        bad("answers-type", 'shape must be "responsibilities" or "stack"');
      const summary = str(answers, "summary", "", true);
      const list = items(answers["items"], "items", true);
      const practices = items(answers["practices"], "practices", true);
      if (summary !== undefined && list !== undefined && practices !== undefined)
        content = [
          `# ${display}\n`,
          `${summary}\n`,
          section(shape === "stack" ? "Stack" : "Responsibilities", bullets(list)),
          section("Key Practices", bullets(practices)),
        ].join("\n");
    } else if (kind === "profile") {
      const line = (label: string, v: string | undefined): string[] =>
        v === undefined ? [] : [`- **${label}:** ${v}`];
      const id = obj(answers["identity"], "identity", true);
      const tool = obj(answers["tooling"], "tooling", false);
      const growth = obj(answers["growth"], "growth", false);
      const phil = obj(answers["philosophy"], "philosophy", false);
      const s = (o: Obj, k: string, w: string, req = false): string | undefined =>
        str(o, k, w, req);
      const identity = [
        ...line("Full Name", s(id, "full_name", "identity.", true)),
        ...line("Email", s(id, "email", "identity.", true)),
        ...line("Team", s(id, "team", "identity.")),
        ...line("Role", s(id, "role", "identity.")),
        ...line("Department", s(id, "department", "identity.")),
        ...line("Location", s(id, "location", "identity.")),
        ...line("Preferred Language", s(id, "language", "identity.", true)),
      ];
      const tooling = [
        ...line("Editor & Plugins", s(tool, "editor", "tooling.")),
        ...line("Terminal Setup", s(tool, "terminal", "tooling.")),
        ...line("Communication", s(tool, "communication", "tooling.")),
        ...line("Work Rhythm", s(tool, "rhythm", "tooling.")),
      ];
      const projects: string[] = [];
      const rawProjects = answers["projects"];
      if (rawProjects !== undefined && !Array.isArray(rawProjects))
        bad("answers-type", "projects must be a list");
      else
        (rawProjects as unknown[] | undefined)?.forEach((p, i) => {
          const o = obj(p, `projects[${i}]`, true);
          const lines = [`${i + 1}. **${s(o, "name", `projects[${i}].`, true) ?? ""}**`];
          for (const [k, label] of [
            ["responsibility", "Responsibility"],
            ["objective", "Objective"],
          ] as const)
            lines.push(...line(label, s(o, k, `projects[${i}].`)).map((l) => `   ${l}`));
          projects.push(lines.join("\n"));
        });
      const growthLines = [
        ...line("Primary Focus", s(growth, "focus", "growth.")),
        ...line("Concrete Goals", s(growth, "goals", "growth.")),
      ];
      const philLines = [
        ...line("Core Values", s(phil, "values", "philosophy.")),
        ...line("Collaboration Preferences", s(phil, "collaboration", "philosophy.")),
        ...line("Notes", s(phil, "notes", "philosophy.")),
      ];
      const d = new Date();
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const part = (heading: string, hint: string, body: string[], sep = "\n"): string =>
        `## ${heading}\n\n*${hint}*\n${body.length > 0 ? `\n${body.join(sep)}\n` : ""}`;
      content = [
        "# Personal Profile\n",
        `## Identity\n\n${identity.join("\n")}\n`,
        part("Tooling Preferences", "Describe the tools and workflows you rely on daily.", tooling),
        part(
          "Active Projects",
          "What are you currently working on and what is your contribution?",
          projects,
          "\n\n",
        ),
        part("Growth Plan", "Where do you want to be in six months?", growthLines),
        part(
          "Working Philosophy",
          "How do you approach collaboration and decision-making?",
          philLines,
        ),
        `---\n\n**Last Updated:** ${opts["--date"] ?? today}\n`,
      ].join("\n");
    } else {
      const secs = obj(answers["sections"], "sections", true);
      const defs: [string, string][] = [
        ["stance", "S - Stance"],
        ["origin", "O - Origin"],
        ["understanding", "U - Understanding"],
        ["lineage", "L - Lineage"],
        ["error_handling", "E - Error Handling & Tenacity"],
      ];
      const bodies = defs.map(([key, heading]) => ({
        heading,
        body: str(secs, key, "sections.", true, true),
      }));
      const title = str(answers, "title", "", false) ?? "SOUL.md - Agent Identity Blueprint";
      const preamble = str(answers, "preamble", "", false, true) ?? DEFAULT_PREAMBLE;
      const closing = str(answers, "closing", "", false, true) ?? DEFAULT_CLOSING;
      if (findings.length === 0)
        content = [
          `# ${title}\n`,
          `${preamble}\n`,
          ...bodies.map((b) => section(b.heading, b.body as string)),
          `---\n\n${closing}\n`,
        ].join("\n");
    }
  }

  if (findings.length > 0 || (answersFile !== undefined && content === undefined)) {
    return emit(
      1,
      null,
      findings,
      findings.map((f) => `${NAME}: ${f.rule}: ${f.message}`).join("\n"),
    );
  }
  if (templateName !== undefined && findTemplate(templateName, root) === undefined)
    return precondition(templateMissing());
  const base = { kind, file, path: target, exists };
  if (content === undefined)
    return emit(
      0,
      { ...base, mode: "resolve", written: false, dry_run: false },
      [],
      `${target}: ${exists ? "exists" : "free"}`,
    );
  if (exists && !force) {
    const finding = {
      rule: "target-exists",
      message: `${target} already exists; ask the user to pick another name, overwrite (rerun with --force) or cancel`,
    };
    return emit(
      1,
      { ...base, mode: "write", written: false, dry_run: dryRun, ...(dryRun ? { content } : {}) },
      [finding],
      `${NAME}: ${finding.rule}: ${finding.message}`,
    );
  }
  if (dryRun)
    return emit(
      0,
      { ...base, mode: "write", written: false, dry_run: true, content },
      [],
      `would write ${target}:\n\n${content}`,
    );
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, target);
  } catch (e) {
    return precondition(`cannot write ${target}: ${(e as Error).message}`);
  }
  emit(0, { ...base, mode: "write", written: true, dry_run: false }, [], `wrote ${target}`);
})();
