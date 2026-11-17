// lint-verdict.ts — checks the seat line, the finding tags and the finding identifiers of a
// review verdict before it is posted.
//
// Usage: node lint-verdict.ts --surface <review|specs|plan> [--ordinal <N>]
//          [--prior-ids <id,id,...>] [--transport <review|comment|plan>] [--json] <file|->
//
// Checks:
//   - a `seat: <surface>/<ticket>[#<generation>]` line exists and names --surface;
//   - every finding header carries exactly one `class:` line (tech, arch or spec) in its block;
//   - every finding identifier matches the surface (`i<N>-F<M>` on review, `s<N>-F<M>` on
//     specs, `v<N>-F<M>` on plan, each optionally followed by lowercase letters for a
//     sub-finding such as `v1-F2a`), none is repeated, and with --ordinal <N> its <N> matches;
//   - with --prior-ids, each prior identifier is mentioned in the body, as itself or through
//     one of its sub-findings (the prior-finding audit);
//   - with --transport, the seat line is where the seat contract puts it: the first non-empty
//     line for a formal review, the line right after `## Verdict: …` for a plain comment, the
//     line right after `### Verdict: …` for plan.
// Text inside code fences is ignored. A body with no finding passes.
//
// A finding header is a line that carries an identifier in bold (`**i1-F2**`) or in
// parentheses after the word Finding (`**Finding 2 (i1-F2)**`, `### Finding 2 (v1-F2)`).
//
// Exit: 0 ok, 1 at least one finding, 2 usage error, 3 the input is unreadable. With --json it
// prints one {ok, data, findings} object on stdout and the human text on stderr.
// Self-contained on purpose: no import, built-ins through process.getBuiltinModule.

// The body runs inside a function so that these top-level names stay local to the file.
void (() => {
  const fs = process.getBuiltinModule("node:fs");

  const USAGE =
    "Usage: node lint-verdict.ts --surface <review|specs|plan> [--ordinal <N>] [--prior-ids <ids>]\n" +
    "         [--transport <review|comment|plan>] [--json] <file|->\n" +
    "  Checks the seat line, the class: tags and the finding identifiers of a verdict body.\n" +
    "  Exit 0 ok, 1 findings, 2 usage error, 3 unreadable input.\n";

  const PREFIX: Record<string, string> = { review: "i", specs: "s", plan: "v" };

  interface Finding {
    rule: string;
    message: string;
  }

  interface Options {
    surface: string;
    ordinal: number | undefined;
    priorIds: string[];
    transport: string | undefined;
    json: boolean;
    help: boolean;
    input: string | undefined;
    error: string | undefined;
  }

  function parseArgs(argv: string[]): Options {
    const o: Options = {
      surface: "",
      ordinal: undefined,
      priorIds: [],
      transport: undefined,
      json: false,
      help: false,
      input: undefined,
      error: undefined,
    };
    const value = (name: string, i: number, inline: string | undefined): string | undefined => {
      if (inline !== undefined) return inline;
      const next = argv[i + 1];
      if (next === undefined) o.error ??= `${name} needs a value`;
      return next;
    };
    for (let i = 0; i < argv.length; i++) {
      const raw = argv[i] as string;
      const eq = raw.startsWith("--") ? raw.indexOf("=") : -1;
      const name = eq === -1 ? raw : raw.slice(0, eq);
      const inline = eq === -1 ? undefined : raw.slice(eq + 1);
      if (name === "--json") o.json = true;
      else if (name === "--help" || name === "-h") o.help = true;
      else if (
        name === "--surface" ||
        name === "--ordinal" ||
        name === "--prior-ids" ||
        name === "--transport"
      ) {
        const v = value(name, i, inline);
        if (inline === undefined) i++;
        if (v === undefined) continue;
        if (name === "--surface") o.surface = v;
        else if (name === "--transport") o.transport = v;
        else if (name === "--prior-ids")
          o.priorIds = v
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s !== "");
        else if (/^[1-9][0-9]*$/.test(v)) o.ordinal = Number(v);
        else o.error ??= "--ordinal needs a positive integer";
      } else if (raw.length > 1 && raw.startsWith("-")) o.error ??= `unknown option ${raw}`;
      else if (o.input === undefined) o.input = raw;
      else o.error ??= "only one input is accepted";
    }
    if (o.error === undefined && !o.help && !(o.surface in PREFIX))
      o.error = "--surface must be review, specs or plan";
    if (o.error === undefined && !o.help && o.input === undefined)
      o.error = "an input file or - is required";
    if (
      o.error === undefined &&
      o.transport !== undefined &&
      !["review", "comment", "plan"].includes(o.transport)
    )
      o.error = "--transport must be review, comment or plan";
    return o;
  }

  /** The lines of the body with the lines inside code fences blanked, so they are never parsed. */
  function visibleLines(text: string): string[] {
    let fence: string | undefined;
    return text.split(/\r?\n/).map((line) => {
      const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (fence === undefined && m !== null) {
        fence = (m[1] as string).charAt(0);
        return "";
      }
      if (fence !== undefined) {
        if (m !== null && (m[1] as string).charAt(0) === fence) fence = undefined;
        return "";
      }
      return line;
    });
  }

  const ID = "[isv][0-9]+-F[0-9]+[a-z]*";
  const HEADER_BOLD = new RegExp(`^\\s*(?:[-*]\\s+)?(?:#{1,6}\\s+)?\\*\\*(${ID})\\b`);
  const HEADER_FINDING = new RegExp(
    `^\\s*(?:[-*]\\s+)?(?:#{1,6}\\s+)?\\*{0,2}Finding\\b[^(\\n]*\\((${ID})\\)`,
  );
  const CLASS_LINE = /^\s*(?:[-*]\s+)?class:\s*(\S*)/i;
  const SEAT_LINE = /^seat:\s*(\S+)\s*$/;

  function lint(text: string, o: Options): Finding[] {
    const out: Finding[] = [];
    const lines = visibleLines(text);
    const prefix = PREFIX[o.surface] as string;
    const shape = new RegExp(`^${prefix}([0-9]+)-F[0-9]+[a-z]*$`);

    // seat line
    const seatAt = lines.findIndex((l) => SEAT_LINE.test(l));
    if (seatAt === -1)
      out.push({ rule: "seat-line", message: "no `seat: <surface>/<ticket>` line found" });
    else {
      const key = (SEAT_LINE.exec(lines[seatAt] as string) as RegExpExecArray)[1] as string;
      const m = /^(review|specs|plan)\/([0-9]+)(?:#([0-9]+))?$/.exec(key);
      if (m === null)
        out.push({
          rule: "seat-line",
          message: `seat line \`${key}\` is not of the form <surface>/<ticket>[#<generation>]`,
        });
      else if (m[1] !== o.surface)
        out.push({
          rule: "seat-surface",
          message: `seat line names the ${m[1]} surface, expected ${o.surface}`,
        });
      if (o.transport !== undefined) {
        const first = lines.findIndex((l) => l.trim() !== "");
        const verdictAt = lines.findIndex((l) => /^#{2,3}\s*Verdict:/i.test(l));
        const expected =
          o.transport === "review"
            ? first
            : verdictAt === -1
              ? -1
              : lines.findIndex((l, i) => i > verdictAt && l.trim() !== "");
        if (expected === -1 || expected !== seatAt)
          out.push({
            rule: "seat-placement",
            message:
              o.transport === "review"
                ? "the seat line must be the first non-empty line of a formal review body"
                : "the seat line must come right after the verdict line",
          });
      }
    }

    // findings: header lines and their blocks
    const headers: { id: string; at: number }[] = [];
    lines.forEach((l, i) => {
      const m = HEADER_BOLD.exec(l) ?? HEADER_FINDING.exec(l);
      if (m !== null) headers.push({ id: m[1] as string, at: i });
    });
    const seen = new Set<string>();
    headers.forEach((h, n) => {
      const end = n + 1 < headers.length ? (headers[n + 1] as { at: number }).at : lines.length;
      const classes = lines
        .slice(h.at, end)
        .map((l) => CLASS_LINE.exec(l))
        .filter((m): m is RegExpExecArray => m !== null);
      if (classes.length === 0)
        out.push({ rule: "class-missing", message: `finding ${h.id} has no \`class:\` line` });
      else if (classes.length > 1)
        out.push({
          rule: "class-duplicate",
          message: `finding ${h.id} has ${classes.length} \`class:\` lines, expected exactly one`,
        });
      else if (!["tech", "arch", "spec"].includes((classes[0] as RegExpExecArray)[1] as string))
        out.push({
          rule: "class-value",
          message: `finding ${h.id} has class \`${(classes[0] as RegExpExecArray)[1]}\`, expected tech, arch or spec`,
        });
      const sm = shape.exec(h.id);
      if (sm === null)
        out.push({
          rule: "id-format",
          message: `finding ${h.id} does not match the ${o.surface} format ${prefix}<N>-F<M>`,
        });
      else if (o.ordinal !== undefined && Number(sm[1]) !== o.ordinal)
        out.push({
          rule: "id-ordinal",
          message: `finding ${h.id} carries ordinal ${sm[1]}, expected ${o.ordinal}`,
        });
      if (seen.has(h.id))
        out.push({
          rule: "id-duplicate",
          message: `finding identifier ${h.id} is used more than once`,
        });
      seen.add(h.id);
    });

    // prior-finding audit: each prior id mentioned as itself or through a sub-finding
    const body = lines.join("\n");
    for (const prior of o.priorIds) {
      const re = new RegExp(
        `(?:^|[^A-Za-z0-9-])${prior.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[a-z]*(?![0-9A-Za-z-])`,
      );
      if (!re.test(body))
        out.push({
          rule: "prior-audit",
          message: `prior finding ${prior} is not mentioned in the audit`,
        });
    }
    return out;
  }

  function main(argv: string[]): number {
    const o = parseArgs(argv);
    const human = (s: string): void => {
      (o.json ? process.stderr : process.stdout).write(`${s}\n`);
    };
    const done = (code: number, data: object | null, findings: Finding[]): number => {
      if (o.json) process.stdout.write(`${JSON.stringify({ ok: code === 0, data, findings })}\n`);
      return code;
    };
    if (o.help) {
      process.stdout.write(USAGE);
      return 0;
    }
    if (o.error !== undefined) {
      process.stderr.write(`lint-verdict.ts: ${o.error}\n${USAGE}`);
      return done(2, null, [{ rule: "usage", message: o.error }]);
    }
    let text: string;
    try {
      text = (o.input === "-" ? fs.readFileSync(0) : fs.readFileSync(o.input as string)).toString(
        "utf8",
      );
    } catch (err) {
      const message = `${o.input === "-" ? "stdin" : o.input}: ${(err as NodeJS.ErrnoException).code ?? "unreadable"}`;
      process.stderr.write(`lint-verdict.ts: ${message}\n`);
      return done(3, null, [{ rule: "precondition", message }]);
    }
    const findings = lint(text, o);
    for (const f of findings) human(`lint-verdict: ${f.rule}: ${f.message}`);
    if (findings.length === 0) human("lint-verdict: ok");
    return done(findings.length > 0 ? 1 : 0, { surface: o.surface }, findings);
  }

  process.exitCode = main(process.argv.slice(2));
})();
