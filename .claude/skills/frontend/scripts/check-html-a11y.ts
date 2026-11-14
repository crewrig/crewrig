#!/usr/bin/env node
// check-html-a11y.ts — static accessibility check of one HTML file: image alt text, form control
// labels, heading order, landmarks and the html lang attribute.
//
// Usage: node scripts/check-html-a11y.ts <file | -> [--json]
//
// Reads the file, or standard input for "-". The scanner is a small tolerant tag tokenizer, not
// a conforming HTML parser: it skips comments, <script> and <style> bodies, accepts unquoted and
// single-quoted attributes, and never fails on unclosed or stray tags. It cannot see markup that
// JavaScript builds at runtime, so a clean run is necessary for WCAG 2.1 AA, not sufficient.
//
// A page is treated as a full document when it has an <html> element; page-level rules (lang,
// main landmark, an h1) only apply to documents, so a fragment can be checked too.
//
// Exit codes: 0 no error finding (warnings allowed), 1 at least one error finding, 2 usage
// error, 3 the input cannot be read.
//
// Self-contained on purpose: the skill's scripts/ folder is copied out of the checkout, so this
// file imports nothing and loads Node built-ins with process.getBuiltinModule.
void (() => {
  type Finding = {
    rule: string;
    message: string;
    severity?: "error" | "warning";
    line?: number;
  };
  type Tag = {
    name: string;
    closing: boolean;
    attrs: Map<string, string>;
    line: number;
  };

  const USAGE = "Usage: node scripts/check-html-a11y.ts <file | -> [--json]";
  const HELP = `${USAGE}

Static accessibility check of one HTML file ("-" reads standard input). Rules:
  html-lang        the <html> element needs a non-empty lang attribute
  img-alt          every <img> needs an alt attribute (alt="" marks a decorative image)
  form-label       every input, select and textarea needs a label (label for/id, wrapping
                   <label>, aria-label or aria-labelledby; a placeholder is not a label)
  heading-order    heading levels do not skip a level; a document has one h1
  landmarks        a document has exactly one <main>; several <nav> need distinct names
It sees only the static markup, not what scripts add later.

--json prints one {ok, data, findings} object on stdout and the human text on stderr.
Exit codes: 0 no error finding, 1 an error finding, 2 usage error, 3 unreadable input.
`;

  const VOID_SKIP = new Set(["script", "style"]);
  const UNLABELLED_TYPES = new Set(["hidden", "submit", "button", "reset", "image"]);

  function tokenize(src: string): Tag[] {
    const tags: Tag[] = [];
    const re =
      /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
    const lineAt = (index: number): number => {
      let n = 1;
      for (let i = 0; i < index; i++) if (src.charCodeAt(i) === 10) n++;
      return n;
    };
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      if (m[2] === undefined) continue; // a comment or CDATA section
      const name = m[2].toLowerCase();
      const closing = m[1] === "/";
      const attrs = new Map<string, string>();
      if (!closing) {
        const ar = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
        let a: RegExpExecArray | null;
        while ((a = ar.exec(m[3] ?? "")) !== null) {
          const key = (a[1] as string).toLowerCase();
          if (!attrs.has(key)) attrs.set(key, a[2] ?? a[3] ?? a[4] ?? "");
        }
      }
      tags.push({ name, closing, attrs, line: lineAt(m.index) });
      if (!closing && VOID_SKIP.has(name)) {
        const end = src.toLowerCase().indexOf(`</${name}`, re.lastIndex);
        re.lastIndex = end === -1 ? src.length : end;
      }
    }
    return tags;
  }

  function check(src: string): { findings: Finding[]; data: object } {
    const tags = tokenize(src);
    const findings: Finding[] = [];
    const add = (
      rule: string,
      message: string,
      line: number,
      severity: "error" | "warning" = "error",
    ): void => {
      findings.push({ rule, message, severity, line });
    };
    const open = tags.filter((t) => !t.closing);
    const htmlTag = open.find((t) => t.name === "html");
    const isDocument = htmlTag !== undefined;

    // html lang
    if (htmlTag !== undefined && (htmlTag.attrs.get("lang") ?? "").trim() === "") {
      add(
        "html-lang",
        'The <html> element has no lang attribute; add one such as lang="en" so screen readers pick the right voice.',
        htmlTag.line,
      );
    }

    // images
    let images = 0;
    for (const t of open.filter((x) => x.name === "img")) {
      images++;
      if (!t.attrs.has("alt")) {
        const decorative = ["presentation", "none"].includes(
          (t.attrs.get("role") ?? "").toLowerCase(),
        );
        if (!decorative) {
          add(
            "img-alt",
            'An <img> has no alt attribute; describe the image, or write alt="" when it is purely decorative.',
            t.line,
          );
        }
      } else if (
        /^[\w-]+\.(png|jpe?g|gif|webp|avif|svg)$/i.test((t.attrs.get("alt") ?? "").trim())
      ) {
        add(
          "img-alt",
          "An alt text is a file name; describe what the image conveys instead.",
          t.line,
          "warning",
        );
      }
    }

    // form controls and labels
    const labelFor = new Set<string>();
    for (const t of open.filter((x) => x.name === "label")) {
      const f = t.attrs.get("for");
      if (f !== undefined && f !== "") labelFor.add(f);
    }
    let controls = 0;
    let labelDepth = 0;
    for (const t of tags) {
      if (t.name === "label") {
        labelDepth = t.closing ? Math.max(0, labelDepth - 1) : labelDepth + 1;
        continue;
      }
      if (t.closing || !["input", "select", "textarea"].includes(t.name)) continue;
      if (t.name === "input" && UNLABELLED_TYPES.has((t.attrs.get("type") ?? "text").toLowerCase()))
        continue;
      if (t.attrs.has("hidden") || (t.attrs.get("aria-hidden") ?? "").toLowerCase() === "true")
        continue;
      controls++;
      const id = t.attrs.get("id") ?? "";
      const named =
        (t.attrs.get("aria-label") ?? "").trim() !== "" ||
        (t.attrs.get("aria-labelledby") ?? "").trim() !== "" ||
        labelDepth > 0 ||
        (id !== "" && labelFor.has(id));
      if (!named) {
        const hint = t.attrs.has("placeholder") ? " A placeholder is not a label." : "";
        add(
          "form-label",
          `A <${t.name}> has no label; add <label for="id">, wrap it in a <label>, or set aria-label.${hint}`,
          t.line,
        );
      }
    }

    // headings
    const headings = open
      .filter((x) => /^h[1-6]$/.test(x.name))
      .map((x) => ({ level: Number(x.name[1]), line: x.line }));
    let prev = isDocument ? 0 : (headings[0]?.level ?? 0);
    for (const h of headings) {
      if (h.level > prev + 1) {
        add(
          "heading-order",
          `Heading level h${h.level} follows ${prev === 0 ? "no heading" : `h${prev}`}; do not skip levels.`,
          h.line,
        );
      }
      prev = h.level;
    }
    const h1s = headings.filter((h) => h.level === 1);
    if (isDocument && h1s.length === 0) {
      add(
        "heading-order",
        "The document has no h1; give the page one top-level heading.",
        htmlTag.line,
      );
    }
    if (h1s.length > 1) {
      add(
        "heading-order",
        `The page has ${h1s.length} h1 elements; keep exactly one.`,
        (h1s[1] as { line: number }).line,
        "warning",
      );
    }

    // landmarks
    const mains = open.filter((x) => x.name === "main" || (x.attrs.get("role") ?? "") === "main");
    if (isDocument && mains.length === 0) {
      add(
        "landmarks",
        "The document has no <main> landmark; wrap the primary content in <main>.",
        htmlTag.line,
      );
    }
    if (mains.length > 1) {
      add(
        "landmarks",
        `The page has ${mains.length} main landmarks; keep exactly one.`,
        (mains[1] as Tag).line,
      );
    }
    const navs = open.filter((x) => x.name === "nav");
    if (navs.length > 1) {
      const seen = new Set<string>();
      for (const n of navs) {
        const label = (n.attrs.get("aria-label") ?? n.attrs.get("aria-labelledby") ?? "").trim();
        if (label === "") {
          add(
            "landmarks",
            "One of several <nav> elements has no aria-label; name each so users can tell them apart.",
            n.line,
          );
        } else if (seen.has(label)) {
          add(
            "landmarks",
            `Two <nav> elements share the name "${label}"; give each a distinct one.`,
            n.line,
            "warning",
          );
        }
        seen.add(label);
      }
    }

    return {
      findings,
      data: {
        document: isDocument,
        images,
        controls,
        headings: headings.length,
        mains: mains.length,
        navs: navs.length,
      },
    };
  }

  function main(): void {
    const fs = process.getBuiltinModule("node:fs");
    const argv = process.argv.slice(2);
    const json = argv.includes("--json");
    if (argv.includes("--help")) {
      process.stdout.write(HELP);
      return;
    }
    const fail = (code: 2 | 3, rule: "usage" | "precondition", message: string): void => {
      process.stderr.write(`${message}${code === 2 ? `\n${USAGE}` : ""}\n`);
      if (json) {
        process.stdout.write(
          `${JSON.stringify({ ok: false, data: null, findings: [{ rule, message }] })}\n`,
        );
      }
      process.exitCode = code;
    };
    const unknown = argv.find((a) => a.startsWith("-") && a !== "-" && a !== "--json");
    if (unknown !== undefined) return fail(2, "usage", `unknown option ${unknown}`);
    const args = argv.filter((a) => a !== "--json");
    if (args.length !== 1)
      return fail(2, "usage", "exactly one file (or - for standard input) is required");
    const target = args[0] as string;

    let src: string;
    try {
      src = target === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(target, "utf8");
    } catch (e) {
      return fail(
        3,
        "precondition",
        `cannot read ${target === "-" ? "standard input" : target}: ${(e as Error).message}`,
      );
    }

    const { findings, data } = check(src);
    const errors = findings.filter((f) => f.severity !== "warning");
    const say = (s: string): void => {
      (json ? process.stderr : process.stdout).write(`${s}\n`);
    };
    for (const f of findings) {
      say(
        `${f.severity === "warning" ? "WARN " : "ERROR"} ${target}:${f.line ?? 0} [${f.rule}] ${f.message}`,
      );
    }
    say(
      errors.length === 0
        ? "OK: no accessibility error found in the static markup."
        : `${errors.length} error(s), ${findings.length - errors.length} warning(s).`,
    );
    if (json) {
      process.stdout.write(`${JSON.stringify({ ok: errors.length === 0, data, findings })}\n`);
    }
    process.exitCode = errors.length === 0 ? 0 : 1;
  }

  main();
})();
