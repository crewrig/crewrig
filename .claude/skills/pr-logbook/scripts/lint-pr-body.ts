// lint-pr-body.ts — lint a pull-request title and body against a body template.
// Usage: node lint-pr-body.ts (--title <text> | --title-file <file>) --body-file <file|-> [options]
// Options: --template <file>      body template (default: ../assets/pr-body.template.md)
//          --title-style gitmoji  also require one leading emoji and no conventional-commit prefix
//          --json                 one JSON object {ok, data, findings} on stdout, text on stderr
//          --help                 this text on stdout, exit 0
// Exit codes: 0 no finding, 1 at least one finding, 2 usage error, 3 unreadable input or template.
// Contract: references/script-contract.md. Self-contained on purpose: no import, built-ins through
// process.getBuiltinModule, so the script runs from a copy of the installed skill directory.

process.removeAllListeners("warning");

void (async () => {
  const fs = process.getBuiltinModule("node:fs");
  const path = process.getBuiltinModule("node:path");

  const NAME = "lint-pr-body.ts";
  const USAGE = `Usage: node ${NAME} (--title <text> | --title-file <file>) --body-file <file|-> [options]

Lints a pull-request title and body. Reports: a title over 70 code points, a title ending
with a period, a required section missing, duplicated or out of order, an empty preamble,
and a literal CI skip directive in the title or in the body outside code.

Options:
  --title <text>          the title
  --title-file <file>     the title, read from the first line of a file
  --body-file <file|->    the body; "-" reads standard input
  --template <file>       body template; its second-level headings are the required sections
                          (default: the pr-body.template.md asset next to scripts/)
  --title-style gitmoji   also require exactly one leading emoji and a space, and no
                          conventional-commit prefix (default: no title-prefix rule)
  --json                  print one JSON object {ok, data, findings} on stdout
  --help                  print this text

Exit codes: 0 no finding, 1 finding, 2 usage error, 3 precondition failed.
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
      if (code === 1) for (const f of findings) process.stderr.write(`  ${f.rule}: ${f.message}\n`);
    } else {
      const out = code >= 2 ? process.stderr : process.stdout;
      out.write(`${summary}\n`);
      if (code === 1) for (const f of findings) out.write(`  ${f.rule}: ${f.message}\n`);
    }
    process.exitCode = code;
  };
  const usageError = (message: string): void =>
    emit(2, null, [{ rule: "usage", message }], `${NAME}: ${message}\n${USAGE.split("\n")[0]}`);
  const precondition = (message: string): void =>
    emit(3, null, [{ rule: "precondition", message }], `${NAME}: ${message}`);

  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    return;
  }
  json = argv.includes("--json");

  // ---- arguments
  let title: string | undefined;
  let titleFile: string | undefined;
  let bodyFile: string | undefined;
  let templateFile: string | undefined;
  let style: string | undefined;
  const takesValue = new Set([
    "--title",
    "--title-file",
    "--body-file",
    "--template",
    "--title-style",
  ]);
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i] as string;
    if (raw === "--json") continue;
    const eq = raw.startsWith("--") ? raw.indexOf("=") : -1;
    const key = eq === -1 ? raw : raw.slice(0, eq);
    if (!takesValue.has(key))
      return usageError(
        raw.startsWith("-") && raw !== "-" ? `unknown option ${raw}` : `unexpected argument ${raw}`,
      );
    let value: string | undefined;
    if (eq !== -1) value = raw.slice(eq + 1);
    else {
      value = argv[++i];
      if (value === undefined) return usageError(`${key} needs a value`);
    }
    if (key === "--title") title = value;
    else if (key === "--title-file") titleFile = value;
    else if (key === "--body-file") bodyFile = value;
    else if (key === "--template") templateFile = value;
    else style = value;
  }
  if (title !== undefined && titleFile !== undefined)
    return usageError("--title and --title-file are mutually exclusive");
  if (title === undefined && titleFile === undefined)
    return usageError("a title is required: --title <text> or --title-file <file>");
  if (bodyFile === undefined) return usageError("a body is required: --body-file <file|->");
  if (style !== undefined && style !== "gitmoji")
    return usageError(`unknown --title-style ${style} (allowed: gitmoji)`);

  // ---- inputs
  const readText = (file: string, what: string): string | undefined => {
    try {
      return fs.readFileSync(file === "-" ? 0 : file, "utf8");
    } catch (e) {
      precondition(
        `cannot read ${what} ${file === "-" ? "(standard input)" : file}: ${(e as Error).message}`,
      );
      return undefined;
    }
  };
  let templateLabel = "bundled";
  if (templateFile === undefined) {
    let here = "";
    try {
      here = path.dirname(fs.realpathSync(process.argv[1] ?? ""));
    } catch {
      // no script directory to resolve from
    }
    templateFile = path.join(here, "..", "assets", "pr-body.template.md");
  } else templateLabel = templateFile;
  const template = readText(templateFile, "the template");
  if (template === undefined) return;
  if (titleFile !== undefined) {
    const t = readText(titleFile, "the title file");
    if (t === undefined) return;
    title = t.split(/\r?\n/)[0] as string;
  }
  const body = readText(bodyFile, "the body");
  if (body === undefined) return;
  const titleText = title as string;

  // ---- markdown helpers
  /** Lines with a flag telling whether each lies in (or delimits) a fenced code block. */
  const fenceFlags = (lines: string[]): boolean[] => {
    const flags: boolean[] = [];
    let open: { ch: string; len: number } | undefined;
    for (const line of lines) {
      const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.replace(/\r$/, ""));
      if (open === undefined) {
        if (m !== null && !(m[1]?.startsWith("`") && (m[2] ?? "").includes("`"))) {
          open = { ch: (m[1] as string)[0] as string, len: (m[1] as string).length };
          flags.push(true);
        } else flags.push(false);
      } else {
        flags.push(true);
        if (
          m !== null &&
          (m[1] as string)[0] === open.ch &&
          (m[1] as string).length >= open.len &&
          (m[2] ?? "").trim() === ""
        )
          open = undefined;
      }
    }
    return flags;
  };
  /** The text with fenced blocks and inline code spans replaced by a space. */
  const withoutCode = (text: string): string => {
    const lines = text.split("\n");
    const flags = fenceFlags(lines);
    const kept = lines.filter((_, i) => !flags[i]).join("\n");
    let out = "";
    for (let i = 0; i < kept.length;) {
      if (kept[i] !== "`") {
        out += kept[i++];
        continue;
      }
      let j = i;
      while (kept[j] === "`") j++;
      const run = j - i;
      let k = j;
      let end = -1;
      while (k < kept.length) {
        if (kept[k] !== "`") {
          k++;
          continue;
        }
        let e = k;
        while (kept[e] === "`") e++;
        if (e - k === run) {
          end = e;
          break;
        }
        k = e;
      }
      if (end === -1) {
        out += kept.slice(i, j);
        i = j;
      } else {
        out += " ";
        i = end;
      }
    }
    return out;
  };
  interface Parsed {
    preamble: string;
    headings: string[];
  }
  /** The preamble (text before the first second-level heading) and the second-level headings. */
  const parse = (text: string): Parsed => {
    const lines = text.split("\n");
    const flags = fenceFlags(lines);
    const headings: string[] = [];
    const pre: string[] = [];
    let seen = false;
    lines.forEach((line, i) => {
      const m = flags[i] ? null : /^ {0,3}##[ \t]+(.*)$/.exec(line.replace(/\r$/, ""));
      if (m !== null) {
        seen = true;
        headings.push((m[1] as string).trimEnd());
      } else if (!seen) pre.push(line);
    });
    return { preamble: pre.join("\n").trim(), headings };
  };

  const tpl = parse(template);
  const dup = tpl.headings.find((h, i) => tpl.headings.indexOf(h) !== i);
  if (dup !== undefined) return precondition(`the template repeats the heading "## ${dup}"`);
  const bod = parse(body);

  // ---- rules
  const findings: Finding[] = [];
  const add = (rule: string, message: string): void => void findings.push({ rule, message });
  const length = [...titleText].length;
  if (length > 70) add("title-length", `the title has ${length} characters; the limit is 70`);
  if (titleText.trimEnd().endsWith(".")) add("title-period", "the title ends with a period");

  if (tpl.preamble !== "" && bod.preamble === "")
    add("preamble-empty", "the body has no text before its first second-level heading");
  let highest = -1;
  let highestName = "";
  for (const h of tpl.headings) {
    const count = bod.headings.filter((x) => x === h).length;
    if (count === 0) add("section-missing", `the section "## ${h}" is missing`);
    else if (count > 1) add("section-duplicate", `the section "## ${h}" appears ${count} times`);
  }
  const firsts = bod.headings.filter(
    (h, i) => tpl.headings.includes(h) && bod.headings.indexOf(h) === i,
  );
  for (const h of firsts) {
    const idx = tpl.headings.indexOf(h);
    if (idx < highest)
      add(
        "section-order",
        `the section "## ${h}" comes after "## ${highestName}" but the template puts it before`,
      );
    else {
      highest = idx;
      highestName = h;
    }
  }

  const SKIP = /\[(?:skip ci|ci skip|skip actions|no ci)\]/i;
  const hit = (where: string, text: string): void => {
    const m = SKIP.exec(withoutCode(text));
    if (m !== null) add("ci-skip-directive", `the ${where} contains the CI skip directive ${m[0]}`);
  };
  hit("title", titleText);
  hit("body", body);

  if (style === "gitmoji") {
    const seg = new Intl.Segmenter("en", { granularity: "grapheme" });
    const pict = /^\p{Extended_Pictographic}/u;
    const first = [...seg.segment(titleText)][0]?.segment ?? "";
    let rest = titleText;
    if (!pict.test(first) || titleText[first.length] !== " ") {
      add("title-emoji", "the title must start with exactly one emoji followed by a space");
    } else {
      rest = titleText.slice(first.length + 1);
      const second = [...seg.segment(rest)][0]?.segment ?? "";
      if (pict.test(second)) add("title-emoji", "the title starts with more than one emoji");
    }
    const cc = /^[a-z]+(?:\([^)]*\))?:/;
    const lead = cc.exec(rest) ?? cc.exec(titleText);
    if (lead !== null)
      add(
        "title-conventional-commit",
        `the title carries the conventional-commit prefix "${lead[0]}"`,
      );
  }

  const data = {
    title_length: length,
    template: templateLabel,
    required_sections: tpl.headings,
    preamble_required: tpl.preamble !== "",
    title_style: style ?? null,
  };
  emit(
    findings.length === 0 ? 0 : 1,
    data,
    findings,
    findings.length === 0 ? `${NAME}: no finding` : `${NAME}: ${findings.length} finding(s)`,
  );
})();
