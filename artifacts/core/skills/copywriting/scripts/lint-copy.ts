// lint-copy.ts - check the numeric limits and the banned phrases of one page of copy.
//
// Usage: node scripts/lint-copy.ts <file|-> [--banned <file>] [--format md|html] [--json]
//
// The constants below are the single source of truth for the limits: the skill's prose points
// here and `--help` prints them. Self-contained on purpose (no import): the skill installs as a
// plain directory, so built-in modules come from process.getBuiltinModule.
process.removeAllListeners("warning");
void (() => {
  const LIMITS = { headline: 70, cta: 25, title: 60, description: 155 };

  /** Default banned phrases (replaced, not extended, by --banned). Matched case-insensitively. */
  const DEFAULT_BANNED = [
    "leverage",
    "leveraging",
    "synergy",
    "best-in-class",
    "world-class",
    "cutting-edge",
    "state-of-the-art",
    "next-generation",
    "game-changing",
    "game changer",
    "revolutionary",
    "blazingly fast",
    "seamless",
    "seamlessly",
    "supercharge",
    "unlock the power",
    "one-stop shop",
    "turnkey",
    "low-hanging fruit",
    "moving the needle",
    "take it to the next level",
  ];

  /** CTA labels that name no action. A CTA equal to one of these (case-insensitive) is flagged. */
  const WEAK_CTAS = [
    "click here",
    "click",
    "here",
    "submit",
    "ok",
    "more",
    "read more",
    "learn more",
  ];

  type Finding = { rule: string; message: string; severity?: "warning"; line?: number };
  type Cta = { text: string; line: number };

  const fs = process.getBuiltinModule("node:fs");
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const findings: Finding[] = [];

  const usage = "Usage: lint-copy.ts <file|-> [--banned <file>] [--format md|html] [--json]";
  const help = `${usage}

Lints one page of copy against the numeric limits and the banned phrases.

Input: a Markdown or HTML file, or - for standard input. The format comes from the extension
(.html, .htm = HTML, anything else = Markdown) or, for - and unknown extensions, from the
content (a leading <!doctype or <html means HTML). --format overrides both.

How the copy is found
  Markdown  title, description : single-line (or > / | block) keys of the front matter
            headline           : the first "# " heading outside code fences
            CTA                : a link alone on its line, optionally in a list item or bold
  HTML      title, description : <title>, <meta name="description" content="...">
            headline           : the first <h1>
            CTA                : every <button>, and every <a> whose class has btn, button or
                                 cta as a word, or whose role is button

Limits (characters, counted as Unicode code points)
  headline     at most ${LIMITS.headline}
  CTA          at most ${LIMITS.cta}
  SEO title    at most ${LIMITS.title}
  meta description  at most ${LIMITS.description}
A CTA that names no action (${WEAK_CTAS.join(", ")}) is an error too.

Banned phrases: ${DEFAULT_BANNED.length} built in. --banned <file> replaces them with the phrases of
the file (one per line, # starts a comment, blank lines ignored). Matching ignores case, and a
space or hyphen in a phrase matches either.

A missing headline, title or meta description is a warning, not an error.
--json prints one object {ok, data, findings} on standard output.
Exit codes: 0 no error finding, 1 at least one error finding, 2 usage error,
3 unreadable input or banned-phrase file.
`;

  const emit = (code: number, data: object | null): void => {
    process.exitCode = code;
    if (json) {
      process.stdout.write(`${JSON.stringify({ ok: code === 0, data, findings })}\n`);
    }
  };

  const fail = (code: 2 | 3, rule: "usage" | "precondition", message: string): void => {
    findings.push({ rule, message });
    process.stderr.write(`${message}\n`);
    emit(code, null);
  };

  const len = (s: string): number => Array.from(s).length;
  const norm = (s: string): string => s.replace(/\s+/g, " ").trim();
  const decode = (s: string): string =>
    s
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'");
  const lineOf = (text: string, index: number): number => text.slice(0, index).split("\n").length;
  const stripMd = (s: string): string =>
    norm(
      s
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/[*_`]/g, "")
        .replace(/<[^>]+>/g, ""),
    );
  const stripTags = (s: string): string => norm(decode(s.replace(/<[^>]+>/g, " ")));

  const main = (): void => {
    let banned = DEFAULT_BANNED;
    let format: string | undefined;
    let bannedPath: string | undefined;
    const positional: string[] = [];
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i] ?? "";
      if (a === "--json") continue;
      if (a === "--help") {
        process.stdout.write(help);
        process.exitCode = 0;
        return;
      }
      const m = /^(--banned|--format)(?:=(.*))?$/.exec(a);
      if (m !== null) {
        let v = m[2];
        if (v === undefined) {
          v = argv[++i];
          if (v === undefined) return fail(2, "usage", `${m[1]} needs a value`);
        }
        if (m[1] === "--banned") bannedPath = v;
        else format = v;
      } else if (a.startsWith("-") && a !== "-") {
        return fail(2, "usage", `unknown option ${a}\n${usage}`);
      } else positional.push(a);
    }
    if (positional.length !== 1) return fail(2, "usage", `exactly one input is required\n${usage}`);
    if (format !== undefined && format !== "md" && format !== "html")
      return fail(2, "usage", "--format must be md or html");

    if (bannedPath !== undefined) {
      try {
        banned = fs
          .readFileSync(bannedPath, "utf8")
          .split(/\r?\n/)
          .map((l) => l.replace(/#.*/, "").trim())
          .filter((l) => l !== "");
      } catch {
        return fail(3, "precondition", `cannot read the banned-phrase file ${bannedPath}`);
      }
    }

    const source = positional[0] ?? "-";
    let text: string;
    try {
      text = fs.readFileSync(source === "-" ? 0 : source, "utf8").replace(/\r\n/g, "\n");
    } catch {
      return fail(3, "precondition", `cannot read the input ${source}`);
    }

    const isHtml =
      format !== undefined
        ? format === "html"
        : /\.html?$/i.test(source)
          ? true
          : /\.[a-z0-9]+$/i.test(source) && source !== "-"
            ? false
            : /^\s*<(!doctype|html)/i.test(text);

    let headline: { text: string; line: number } | undefined;
    let title: { text: string; line: number } | undefined;
    let description: { text: string; line: number } | undefined;
    const ctas: Cta[] = [];
    // Text to scan for banned phrases, with tags, fences and scripts blanked but line breaks kept.
    let scan = text;

    if (isHtml) {
      const blank = (s: string): string => s.replace(/[^\n]/g, " ");
      scan = text
        .replace(/<!--[\s\S]*?-->/g, blank)
        .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, blank)
        .replace(/<[^>]+>/g, blank);
      let m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text);
      if (m) title = { text: stripTags(m[1] ?? ""), line: lineOf(text, m.index) };
      for (const tag of text.matchAll(/<meta\b[^>]*>/gi)) {
        if (!/\bname\s*=\s*["']description["']/i.test(tag[0])) continue;
        const c = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag[0]);
        if (c) {
          description = { text: norm(decode(c[1] ?? c[2] ?? "")), line: lineOf(text, tag.index) };
        }
      }
      m = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(text);
      if (m) headline = { text: stripTags(m[1] ?? ""), line: lineOf(text, m.index) };
      for (const b of text.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi))
        ctas.push({ text: stripTags(b[1] ?? ""), line: lineOf(text, b.index) });
      for (const a of text.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
        const attrs = a[1] ?? "";
        const cls = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
        const isCta =
          /\brole\s*=\s*["']button["']/i.test(attrs) ||
          (cls !== null && /(^|[\s_-])(btn|button|cta)($|[\s_-])/i.test(cls[1] ?? cls[2] ?? ""));
        if (isCta) ctas.push({ text: stripTags(a[2] ?? ""), line: lineOf(text, a.index) });
      }
    } else {
      const lines = text.split("\n");
      let i = 0;
      if (lines[0]?.trim() === "---") {
        const end = lines.findIndex((l, n) => n > 0 && l.trim() === "---");
        if (end > 0) {
          for (i = 1; i < end; i++) {
            const kv = /^(title|description):\s*(.*)$/.exec(lines[i] ?? "");
            if (!kv) continue;
            const at = i + 1;
            let v = (kv[2] ?? "").trim();
            if (/^[>|][+-]?$/.test(v)) {
              const parts: string[] = [];
              while (/^\s+\S/.test(lines[i + 1] ?? "") && i + 1 < end)
                parts.push((lines[++i] ?? "").trim());
              v = parts.join(" ");
            } else v = v.replace(/^(["'])(.*)\1$/, "$2");
            if (kv[1] === "title") title = { text: v, line: at };
            else description = { text: v, line: at };
          }
          i = end + 1;
        }
      }
      let fence = false;
      const kept = lines.map((l, n) => {
        if (n < i) return l; // front matter: title and description are copy, scanned as written
        if (/^\s*(```|~~~)/.test(l)) {
          fence = !fence;
          return "";
        }
        if (fence) return "";
        if (headline === undefined) {
          const h = /^#\s+(.+?)\s*#*\s*$/.exec(l);
          if (h) headline = { text: stripMd(h[1] ?? ""), line: n + 1 };
        }
        const c =
          /^\s*(?:[-*+]\s+)?(?:\*\*|__|\*|_)?\[([^\]]+)\]\([^)]*\)(?:\*\*|__|\*|_)?\s*$/.exec(l);
        if (c) ctas.push({ text: stripMd(c[1] ?? ""), line: n + 1 });
        return l;
      });
      scan = kept.join("\n");
    }

    const check = (
      label: string,
      item: { text: string; line: number } | undefined,
      max: number,
      rule: string,
    ): void => {
      if (item === undefined || item.text === "") {
        findings.push({
          rule: `missing-${rule}`,
          severity: "warning",
          message: `no ${label} found: add one, or check the input follows the conventions in --help`,
        });
        return;
      }
      const n = len(item.text);
      if (n > max)
        findings.push({
          rule: `${rule}-too-long`,
          line: item.line,
          message: `${label} is ${n} characters, the limit is ${max}: shorten "${item.text}"`,
        });
    };
    check("headline", headline, LIMITS.headline, "headline");
    check("SEO title", title, LIMITS.title, "title");
    check("meta description", description, LIMITS.description, "description");

    for (const c of ctas) {
      const n = len(c.text);
      if (n > LIMITS.cta)
        findings.push({
          rule: "cta-too-long",
          line: c.line,
          message: `CTA "${c.text}" is ${n} characters, the limit is ${LIMITS.cta}: shorten it`,
        });
      if (WEAK_CTAS.includes(c.text.toLowerCase().replace(/[.!]+$/, "")))
        findings.push({
          rule: "weak-cta",
          line: c.line,
          message: `CTA "${c.text}" names no action: start with a verb that says what the click does`,
        });
    }

    const meta = isHtml && description ? `\n${description.text}` : "";
    const haystack = scan + meta;
    for (const phrase of banned) {
      const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/(\\?[\s-])+/g, "[\\s-]+");
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, "giu");
      for (const m of haystack.matchAll(re)) {
        const line =
          m.index >= scan.length && description ? description.line : lineOf(haystack, m.index);
        findings.push({
          rule: "banned-phrase",
          line,
          message: `banned phrase "${m[0]}": say what the product does in plain words`,
        });
      }
    }

    findings.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
    const errors = findings.filter((f) => f.severity !== "warning");
    const where = source === "-" ? "stdin" : source;
    for (const f of findings) {
      const tag = f.severity === "warning" ? "WARN" : "FAIL";
      (json ? process.stderr : process.stdout).write(
        `[${tag}] ${where}${f.line ? `:${f.line}` : ""}: ${f.rule}: ${f.message}\n`,
      );
    }
    const summary = `${errors.length} error(s), ${findings.length - errors.length} warning(s) in ${where}\n`;
    if (!json) {
      // Human text goes to stdout without --json; findings were printed above on stderr as well.
      process.stdout.write(errors.length === 0 ? `[OK] ${summary}` : summary);
    } else process.stderr.write(summary);
    emit(errors.length === 0 ? 0 : 1, {
      source: where,
      format: isHtml ? "html" : "md",
      headline: headline?.text ?? null,
      title: title?.text ?? null,
      description: description?.text ?? null,
      ctas: ctas.map((c) => c.text),
      limits: LIMITS,
    });
  };

  main();
})();
