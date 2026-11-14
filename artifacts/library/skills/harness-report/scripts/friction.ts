// friction.ts — build and validate a FRICTION payload, and print the direct-filing command.
// Usage: node friction.ts build --title <t> --room <r> --writer-agent <a> --evidence <e>...
//        node friction.ts validate <file|-> [--room <r>]
//        node friction.ts forge --canonical <url> --payload-file <file|-> [--forge gh|glab|tea]
// Only emits and validates: the MemPalace write stays an MCP call made by the model, and the forge
// command is printed, never run. Exit codes: 0 valid, 1 at least one error finding, 2 usage error,
// 3 unreadable input. Writes nothing, makes no network call. Self-contained on purpose: no import,
// built-ins through process.getBuiltinModule.

process.removeAllListeners("warning");

void (() => {
  const fs = process.getBuiltinModule("node:fs");

  const NAME = "friction.ts";
  const USAGE = `Usage: node ${NAME} build | validate | forge [options] [--json]

Builds and checks the FRICTION payload that is filed in the harness-friction wing.

build      --title <text> --room <room> --writer-agent <name> --evidence <entry> [--evidence ...]
           [--subcategory <anchor>] [--canonical <repo url>] [--severity low|med|high]
           [--suggestion <text>]
           Prints the payload on stdout (with --json, in data.payload) after validating it.
validate   <file|-> [--room <room>]
           Checks a payload written by hand: title line, writer_agent, at least one evidence entry.
forge      --canonical <repo url> --payload-file <file|-> [--forge gh|glab|tea]
           Prints the command that files the payload as an issue labelled harness-feedback, for
           when MemPalace cannot take the write. The host picks the tool: github.com gh; gitlab.com,
           gitlab.* or a host in CREWRIG_GITLAB_HOSTS glab; any other host tea. Never runs it.

Rooms: tool, prompt, format, behavior, process. Severity defaults to med.
Options: --json (one object {ok, data, findings} on stdout), --help.

data: build {wing, room, payload}; validate {room, fields}; forge {forge, argv, command}
Exit codes: 0 valid, 1 an error finding (the message states the fix), 2 usage error,
3 an input file cannot be read.
`;

  interface Finding {
    rule: string;
    message: string;
    severity?: "warning";
  }
  const ROOMS = ["tool", "prompt", "format", "behavior", "process"];
  const SEVERITIES = ["low", "med", "high"];
  const argv = process.argv.slice(2);
  let json = false;
  let human: string[] = [];
  const emit = (code: number, data: unknown, findings: Finding[], lines: string[]): void => {
    const text = lines.length === 0 ? "" : `${lines.join("\n")}\n`;
    const notes = findings.map((f) => `${f.severity ?? "error"}: ${f.rule}: ${f.message}`);
    if (json) {
      process.stdout.write(`${JSON.stringify({ ok: code === 0, data, findings })}\n`);
      process.stderr.write(text + (notes.length === 0 ? "" : `${notes.join("\n")}\n`));
    } else {
      (code >= 2 ? process.stderr : process.stdout).write(text);
      if (notes.length > 0) process.stderr.write(`${notes.join("\n")}\n`);
    }
    process.exitCode = code;
  };
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    return;
  }
  json = argv.includes("--json");
  const usageError = (message: string): void =>
    emit(
      2,
      null,
      [{ rule: "usage", message }],
      [`${NAME}: ${message}`, USAGE.split("\n")[0] as string],
    );

  const SINGLE = [
    "--title",
    "--room",
    "--writer-agent",
    "--subcategory",
    "--canonical",
    "--severity",
    "--suggestion",
    "--payload-file",
    "--forge",
  ];
  const opts: Record<string, string> = {};
  const evidence: string[] = [];
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i] as string;
    if (raw === "--json") continue;
    if (raw.startsWith("-") && raw !== "-") {
      const eq = raw.indexOf("=");
      const key = eq === -1 ? raw : raw.slice(0, eq);
      if (key !== "--evidence" && !SINGLE.includes(key)) return usageError(`unknown option ${raw}`);
      const value = eq !== -1 ? raw.slice(eq + 1) : argv[++i];
      if (value === undefined) return usageError(`${key} needs a value`);
      if (key === "--evidence") evidence.push(value);
      else opts[key] = value;
    } else positional.push(raw);
  }
  const command = positional[0];
  if (command !== "build" && command !== "validate" && command !== "forge")
    return usageError("the first argument must be build, validate or forge");

  const readInput = (src: string): string | null => {
    try {
      return fs.readFileSync(src === "-" ? 0 : src, "utf8");
    } catch {
      return null;
    }
  };
  const unreadable = (src: string): void =>
    emit(
      3,
      null,
      [{ rule: "precondition", message: `cannot read ${src}` }],
      [`${NAME}: cannot read ${src}`],
    );

  interface Fields {
    title: string;
    writer_agent: string;
    subcategory: string;
    canonical: string;
    severity: string;
    suggestion: string;
    evidence: string[];
  }
  const check = (f: Fields, room: string | undefined): Finding[] => {
    const out: Finding[] = [];
    if (f.title.trim() === "" || /[\r\n]/.test(f.title))
      out.push({ rule: "title", message: "the FRICTION title must be one non-empty line" });
    if (f.writer_agent.trim() === "")
      out.push({
        rule: "writer-agent",
        message: "writer_agent is mandatory: put your own identifier, such as claude-code",
      });
    if (f.evidence.length === 0 || f.evidence.some((e) => e.trim() === ""))
      out.push({
        rule: "evidence",
        message:
          "at least one non-empty evidence entry is mandatory: a path and line, ideally with a commit hash",
      });
    else
      for (const e of f.evidence)
        if (!/:\d+/.test(e) && !/^https?:\/\//.test(e))
          out.push({
            rule: "evidence-weak",
            severity: "warning",
            message: `evidence "${e}" has no line number or URL; add path:line so the file can be found`,
          });
    if (!SEVERITIES.includes(f.severity))
      out.push({ rule: "severity", message: `severity must be one of ${SEVERITIES.join(", ")}` });
    if (room !== undefined && !ROOMS.includes(room))
      out.push({ rule: "room", message: `the room must be one of ${ROOMS.join(", ")}` });
    if (f.canonical !== "") {
      if (!/^https?:\/\/[^/\s]+\/\S+/.test(f.canonical))
        out.push({
          rule: "canonical",
          message:
            "canonical must be the repository URL, such as https://github.com/<owner>/<repo>",
        });
      else if (/\/(-\/)?(blob|tree)\//.test(f.canonical))
        out.push({
          rule: "canonical-file-url",
          message:
            "canonical is a file URL; give the repository root and move the file path into evidence",
        });
      if (/harness-report/.test(f.canonical))
        out.push({
          rule: "canonical-is-reporter",
          severity: "warning",
          message:
            "canonical points at the reporting skill; name the offender that led to the action",
        });
    }
    return out;
  };
  const render = (f: Fields): string => {
    const lines = [`FRICTION: ${f.title.trim()}`, "", `writer_agent: ${f.writer_agent.trim()}`];
    if (f.subcategory !== "") lines.push(`subcategory: ${f.subcategory}`);
    if (f.canonical !== "") lines.push(`canonical: ${f.canonical}`);
    lines.push(`severity: ${f.severity}`, "evidence:");
    for (const e of f.evidence) lines.push(`  - ${e.trim()}`);
    if (f.suggestion.trim() !== "") {
      if (f.suggestion.includes("\n"))
        lines.push(
          "suggestion: |",
          ...f.suggestion
            .trimEnd()
            .split("\n")
            .map((l) => `  ${l}`),
        );
      else lines.push(`suggestion: ${f.suggestion.trim()}`);
    }
    return lines.join("\n");
  };
  const hasError = (fs2: Finding[]): boolean => fs2.some((f) => f.severity !== "warning");

  const parse = (text: string): Fields => {
    const f: Fields = {
      title: "",
      writer_agent: "",
      subcategory: "",
      canonical: "",
      severity: "med",
      suggestion: "",
      evidence: [],
    };
    const lines = text.split(/\r?\n/);
    let i = lines.findIndex((l) => l.trim() !== "");
    const m = i === -1 ? null : /^FRICTION:\s*(.+)$/.exec((lines[i] as string).trim());
    if (m === null) return f;
    f.title = (m[1] as string).trim();
    let inEvidence = false;
    for (i += 1; i < lines.length; i++) {
      const line = lines[i] as string;
      if (inEvidence) {
        const li = /^\s*-\s+(.+)$/.exec(line);
        if (li !== null) {
          f.evidence.push((li[1] as string).trim());
          continue;
        }
        inEvidence = false;
      }
      const kv = /^([a-z_][a-z0-9_]*):\s*(.*)$/.exec(line);
      if (kv === null) continue;
      const key = kv[1] as string;
      const val = (kv[2] as string).trim();
      if (key === "evidence") {
        inEvidence = true;
        if (val !== "") f.evidence.push(val);
      } else if (key === "writer_agent") f.writer_agent = val;
      else if (key === "subcategory") f.subcategory = val;
      else if (key === "canonical") f.canonical = val;
      else if (key === "severity") f.severity = val;
      else if (key === "suggestion") f.suggestion = val;
    }
    return f;
  };

  if (command === "build") {
    if (positional.length > 1) return usageError(`unexpected argument ${positional[1] as string}`);
    const room = opts["--room"];
    if (room === undefined) return usageError("--room is required");
    const f: Fields = {
      title: opts["--title"] ?? "",
      writer_agent: opts["--writer-agent"] ?? "",
      subcategory: opts["--subcategory"] ?? "",
      canonical: (opts["--canonical"] ?? "").trim(),
      severity: opts["--severity"] ?? "med",
      suggestion: opts["--suggestion"] ?? "",
      evidence,
    };
    const findings = check(f, room);
    const payload = render(f);
    const bad = hasError(findings);
    emit(
      bad ? 1 : 0,
      bad
        ? { wing: "harness-friction", room, payload: null }
        : { wing: "harness-friction", room, payload },
      findings,
      bad ? [] : [payload],
    );
    return;
  }

  if (command === "validate") {
    if (positional.length !== 2)
      return usageError("validate needs one file, or - for standard input");
    const text = readInput(positional[1] as string);
    if (text === null) return unreadable(positional[1] as string);
    const f = parse(text);
    const findings =
      f.title === ""
        ? [
            {
              rule: "title",
              message: "the first non-blank line must be `FRICTION: <one-line title>`",
            },
          ]
        : check(f, opts["--room"]);
    const bad = hasError(findings);
    emit(
      bad ? 1 : 0,
      { room: opts["--room"] ?? null, fields: f },
      findings,
      bad ? [] : ["payload is valid"],
    );
    return;
  }

  // forge
  if (positional.length > 1) return usageError(`unexpected argument ${positional[1] as string}`);
  const canonical = (opts["--canonical"] ?? "").trim();
  const payloadFile = opts["--payload-file"];
  if (canonical === "")
    return usageError("--canonical is required (the offender's repository URL)");
  if (payloadFile === undefined) return usageError("--payload-file is required");
  const text = readInput(payloadFile);
  if (text === null) return unreadable(payloadFile);
  const f = parse(text);
  const findings =
    f.title === ""
      ? [{ rule: "title", message: "the payload must start with `FRICTION: <one-line title>`" }]
      : check({ ...f, canonical }, undefined);
  if (hasError(findings)) return emit(1, null, findings, []);

  let url: URL;
  try {
    url = new URL(canonical.includes("://") ? canonical : `https://${canonical}`);
  } catch {
    return usageError("--canonical is not a URL");
  }
  const host = url.hostname.toLowerCase();
  const allow = (process.env["CREWRIG_GITLAB_HOSTS"] ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  let forge = opts["--forge"];
  if (forge !== undefined && !["gh", "glab", "tea"].includes(forge))
    return usageError("--forge must be gh, glab or tea");
  if (forge === undefined)
    forge =
      host === "github.com"
        ? "gh"
        : host === "gitlab.com" || host.startsWith("gitlab.") || allow.includes(host)
          ? "glab"
          : "tea";
  const root = `${url.origin}${url.pathname.replace(/\/(-\/)?(blob|tree)\/.*$/, "").replace(/\/+$/, "")}`;
  const segments = root.slice(url.origin.length).split("/").filter(Boolean);
  const ref = forge === "glab" ? root : segments.slice(-2).join("/");
  const title = `FRICTION: ${f.title}`;
  const bodyLines = render(f).split("\n").slice(2);
  const body = bodyLines.join("\n");
  const label = "harness-feedback";
  const argvOut =
    forge === "gh"
      ? ["gh", "issue", "create", "--repo", ref, "--label", label, "--title", title, "--body", body]
      : forge === "glab"
        ? [
            "glab",
            "issue",
            "create",
            "--repo",
            ref,
            "--label",
            label,
            "--title",
            title,
            "--description",
            body,
          ]
        : [
            "tea",
            "issues",
            "create",
            "--repo",
            ref,
            "--labels",
            label,
            "--title",
            title,
            "--description",
            body,
          ];
  const q = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`;
  let tag = "FRICTION_EOF";
  while (body.includes(tag)) tag += "_X";
  const bodyFlag = argvOut[argvOut.length - 2] as string;
  const head = argvOut
    .slice(0, -2)
    .map((a, i) => (i < 3 || a.startsWith("--") ? a : q(a)))
    .join(" ");
  const cmd = `${head} ${bodyFlag} "$(cat <<'${tag}'\n${body}\n${tag}\n)"`;
  human = [cmd];
  emit(0, { forge, argv: argvOut, command: cmd }, findings, human);
})();
