// gate-config.ts — read the machine-local gate configuration and print the effective settings.
// Usage: node gate-config.ts [--conf <path>] [--json]
// Reads ~/.crewrig/validation.conf (key=value lines; blank lines and # comments ignored). A missing
// file, a missing key or an invalid value falls back to the default, so the gate never fails for a
// configuration reason. Exit codes: 0 effective settings printed (findings, if any, are warnings),
// 2 usage error. Writes nothing, makes no network call. Self-contained on purpose: no import,
// built-ins through process.getBuiltinModule.

process.removeAllListeners("warning");

void (() => {
  const fs = process.getBuiltinModule("node:fs");
  const os = process.getBuiltinModule("node:os");
  const path = process.getBuiltinModule("node:path");

  const NAME = "gate-config.ts";
  const USAGE = `Usage: node ${NAME} [--conf <path>] [--json]

Prints the effective gate settings of this machine.

Options:
  --conf <path>  read this file instead of ~/.crewrig/validation.conf
  --json         print one JSON object {ok, data, findings} on stdout
  --help         print this text

Keys and values (the first value is the default):
  backend        internal | plannotator
  translate      off | on
  pedagogy       contextual | simple | professor
  illustration   off | on
  theme          auto | dark | light      ("system" is read as "auto")

data: {path, found, backend, translate, pedagogy, illustration, theme, raw_passthrough_allowed}
  raw_passthrough_allowed is true only when no presentation option is active (translate off,
  pedagogy simple, illustration off, theme auto): the artifact file can then go to the viewer as
  it is. Any other combination needs a presentation document built for the gate.
A missing file, a missing key or an invalid value gives the default; an invalid value, an unknown
key and an unreadable file add a warning finding.
Exit codes: 0 settings printed, 2 usage error.
`;

  interface Finding {
    rule: string;
    message: string;
    severity?: "warning";
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

  let conf = "";
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i] as string;
    if (raw === "--json") continue;
    if (!raw.startsWith("-") || raw === "-") return usageError(`unexpected argument ${raw}`);
    const eq = raw.indexOf("=");
    const key = eq === -1 ? raw : raw.slice(0, eq);
    if (key !== "--conf") return usageError(`unknown option ${raw}`);
    const value = eq !== -1 ? raw.slice(eq + 1) : argv[++i];
    if (value === undefined || value === "") return usageError("--conf needs a path");
    conf = value;
  }
  if (conf === "")
    conf = path.join(process.env["HOME"] ?? os.homedir(), ".crewrig", "validation.conf");

  const SCHEMA: Record<string, string[]> = {
    backend: ["internal", "plannotator"],
    translate: ["off", "on"],
    pedagogy: ["contextual", "simple", "professor"],
    illustration: ["off", "on"],
    theme: ["auto", "dark", "light"],
  };
  const settings: Record<string, string> = {};
  for (const [k, values] of Object.entries(SCHEMA)) settings[k] = values[0] as string;
  const findings: Finding[] = [];

  let text: string | null = null;
  try {
    text = fs.readFileSync(conf, "utf8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== "ENOENT")
      findings.push({
        rule: "unreadable",
        severity: "warning",
        message: `${conf} could not be read (${code ?? "error"}); the defaults apply`,
      });
  }
  if (text !== null) {
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (t === "" || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      const key = t.slice(0, eq).trim();
      let value = t
        .slice(eq + 1)
        .trim()
        .toLowerCase();
      if (!Object.hasOwn(SCHEMA, key)) {
        findings.push({
          rule: "unknown-key",
          severity: "warning",
          message: `key ${key} is not a gate option and is ignored`,
        });
        continue;
      }
      if (key === "theme" && value === "system") value = "auto";
      if (!(SCHEMA[key] as string[]).includes(value))
        findings.push({
          rule: "invalid-value",
          severity: "warning",
          message: `${key}=${value} is not one of ${(SCHEMA[key] as string[]).join(", ")}; the default ${settings[key]} applies`,
        });
      else settings[key] = value;
    }
  }

  const passthrough =
    settings["translate"] === "off" &&
    settings["pedagogy"] === "simple" &&
    settings["illustration"] === "off" &&
    settings["theme"] === "auto";
  const data = {
    path: conf,
    found: text !== null,
    ...settings,
    raw_passthrough_allowed: passthrough,
  };
  emit(0, data, findings, [
    ...Object.keys(SCHEMA).map((k) => `${k}=${settings[k]}`),
    `raw_passthrough_allowed=${passthrough}`,
    ...findings.map((f) => `warning: ${f.message}`),
  ]);
})();
