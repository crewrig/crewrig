// render-gate-html.ts — wrap a gate presentation in a theme-safe HTML page.
// Usage: node render-gate-html.ts --title <text> --body-file <path|-> [--theme auto|system|dark|light]
//                                 [--out <file>] [--dry-run] [--json]
// The review viewer ignores colour rules declared only in <head>, so every colour sits inline on
// <body> and <main>, or in a <style> block inside <body>. Exit codes: 0 page written (or planned
// under --dry-run), 2 usage error, 3 unreadable body or unwritable output. Writes only the --out
// file (default: a new file in the temporary directory), makes no network call. Self-contained on
// purpose: no import, built-ins through process.getBuiltinModule.

process.removeAllListeners("warning");

void (() => {
  const fs = process.getBuiltinModule("node:fs");
  const os = process.getBuiltinModule("node:os");
  const path = process.getBuiltinModule("node:path");
  const crypto = process.getBuiltinModule("node:crypto");

  const NAME = "render-gate-html.ts";
  const USAGE = `Usage: node ${NAME} --title <text> --body-file <path|-> [--theme auto|system|dark|light] [--out <file>] [--dry-run] [--json]

Wraps a presentation body in an HTML page whose colours survive the review viewer.

Options:
  --title <text>      page heading, escaped
  --body-file <path>  the body as an HTML fragment, inserted as it is inside <main>; \`-\` reads
                      standard input. Embed the real changed content, and images as data: URIs
  --theme <name>      auto (default, also "system"): follows the OS theme; dark; light
  --out <file>        where to write the page (default: gate-presentation-<id>.html in the
                      temporary directory)
  --dry-run           report the path and the size, write nothing
  --json              print one JSON object {ok, data, findings} on stdout
  --help              print this text

data: {path, theme, bytes, written}
Exit codes: 0 page written (or planned), 2 usage error, 3 body unreadable or output unwritable.
`;

  interface Finding {
    rule: string;
    message: string;
  }
  const argv = process.argv.slice(2);
  let json = false;
  const emit = (code: number, data: unknown, findings: Finding[], lines: string[]): void => {
    const text = `${lines.join("\n")}\n`;
    if (json) {
      process.stdout.write(`${JSON.stringify({ ok: code === 0, data, findings })}\n`);
      process.stderr.write(text);
    } else (code >= 2 ? process.stderr : process.stdout).write(text);
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

  const opts: Record<string, string> = {};
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i] as string;
    if (raw === "--json") continue;
    if (raw === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (!raw.startsWith("-") || raw === "-") return usageError(`unexpected argument ${raw}`);
    const eq = raw.indexOf("=");
    const key = eq === -1 ? raw : raw.slice(0, eq);
    if (!["--title", "--body-file", "--theme", "--out"].includes(key))
      return usageError(`unknown option ${raw}`);
    const value = eq !== -1 ? raw.slice(eq + 1) : argv[++i];
    if (value === undefined || value === "") return usageError(`${key} needs a value`);
    opts[key] = value;
  }
  const title = opts["--title"];
  const bodyFile = opts["--body-file"];
  if (title === undefined) return usageError("--title is required");
  if (bodyFile === undefined) return usageError("--body-file is required");
  let theme = opts["--theme"] ?? "auto";
  if (theme === "system") theme = "auto";
  if (!["auto", "dark", "light"].includes(theme))
    return usageError("--theme must be auto, system, dark or light");

  let body: string;
  try {
    body = fs.readFileSync(bodyFile === "-" ? 0 : bodyFile, "utf8");
  } catch {
    return emit(
      3,
      null,
      [{ rule: "precondition", message: `cannot read ${bodyFile}` }],
      [`${NAME}: cannot read ${bodyFile}`],
    );
  }
  const esc = (s: string): string =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const h1 = esc(title);

  const LIGHT = { bg: "#ffffff", card: "#f6f8fa", text: "#111111", border: "#d0d7de" };
  const DARK = { bg: "#0d1117", card: "#161b22", text: "#e6edf3", border: "#30363d" };
  let page: string;
  if (theme === "auto") {
    page = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="color-scheme" content="light dark">
    <title>${h1}</title>
  </head>
  <body style="margin:0; padding:1.5rem; background:${LIGHT.bg}; color:${LIGHT.text};">
    <style>
      :root {
        --bg: ${LIGHT.bg};
        --card-bg: ${LIGHT.card};
        --text: ${LIGHT.text};
        --border: ${LIGHT.border};
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: ${DARK.bg};
          --card-bg: ${DARK.card};
          --text: ${DARK.text};
          --border: ${DARK.border};
        }
      }
      body { background: var(--bg) !important; color: var(--text) !important; }
      .card { background: var(--card-bg); color: var(--text); border: 1px solid var(--border); }
    </style>
    <main class="card" style="padding:1.5rem; border-radius:8px;">
      <h1>${h1}</h1>
${body}
    </main>
  </body>
</html>
`;
  } else {
    const c = theme === "dark" ? DARK : LIGHT;
    page = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="color-scheme" content="${theme} only">
    <title>${h1}</title>
  </head>
  <body style="margin:0; padding:1.5rem; background:${c.bg}; color:${c.text};">
    <main style="background:${c.card}; color:${c.text}; border:1px solid ${c.border}; border-radius:8px; padding:1.5rem;">
      <h1 style="color:${c.text};">${h1}</h1>
${body}
    </main>
  </body>
</html>
`;
  }

  const out =
    opts["--out"] ??
    path.join(os.tmpdir(), `gate-presentation-${crypto.randomBytes(4).toString("hex")}.html`);
  const bytes = Buffer.byteLength(page, "utf8");
  if (!dryRun) {
    try {
      fs.writeFileSync(out, page, { mode: 0o600 });
    } catch {
      return emit(
        3,
        null,
        [{ rule: "precondition", message: `cannot write ${out}` }],
        [`${NAME}: cannot write ${out}`],
      );
    }
  }
  emit(
    0,
    { path: out, theme, bytes, written: !dryRun },
    [],
    [`${dryRun ? "would write" : "wrote"} ${out} (${bytes} bytes, theme ${theme})`],
  );
})();
