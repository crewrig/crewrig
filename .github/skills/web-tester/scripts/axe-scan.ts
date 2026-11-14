// axe-scan.ts - run axe-core on a page and classify the violations by impact, or classify an
// existing axe results file offline.
//
// Usage: node axe-scan.ts <url-or-html-file> [--fail-on <impact>] [--timeout <seconds>] [--json]
//        node axe-scan.ts --from-json <axe-results.json> [--fail-on <impact>] [--json]
//
// Network: the only network use is the browser navigating to the URL the user passes. A local
// HTML file (loaded as a file:// URL) and --from-json make no network call.
//
// The script imports no npm package. For a live scan it looks, from the current directory, for
// `@axe-core/playwright`, or for `playwright` (or `playwright-core`, `@playwright/test`) together
// with `axe-core`, then runs the scan in a node child process started in that directory. When
// neither set is installed it exits 3 and names the missing package and the install command.
//
// Self-contained on purpose: the skill's scripts/ folder is copied out of the checkout, so this
// file imports nothing and loads Node built-ins with process.getBuiltinModule.
process.removeAllListeners("warning");
void (() => {
  const fs = process.getBuiltinModule("node:fs");
  const path = process.getBuiltinModule("node:path");
  const url = process.getBuiltinModule("node:url");
  const cp = process.getBuiltinModule("node:child_process");
  const nodeModule = process.getBuiltinModule("node:module");

  type Impact = "critical" | "serious" | "moderate" | "minor";
  type Finding = { rule: string; message: string; severity?: "error" | "warning" };
  type Violation = { id: string; impact: Impact; help: string; helpUrl: string; nodes: number };

  const IMPACTS: Impact[] = ["critical", "serious", "moderate", "minor"];
  const rank = (i: Impact): number => IMPACTS.indexOf(i);

  const USAGE = `Usage: axe-scan.ts <url-or-html-file> [--fail-on <impact>] [--timeout <seconds>] [--json]
       axe-scan.ts --from-json <axe-results.json> [--fail-on <impact>] [--json]`;

  const HELP = `${USAGE}

Runs axe-core on a page and lists the violations by impact (critical, serious, moderate,
minor) with the rule id, the help URL and the number of nodes. With --from-json it classifies
an existing axe results file instead and needs no browser.

Options:
  --from-json <file>   classify an axe results file (an axe results object, or an array of them)
  --fail-on <impact>   lowest impact that fails the run: critical, serious (default), moderate, minor
  --timeout <seconds>  limit of the browser scan (default 60)
  --json               print one {ok, data, findings} object on stdout, human text on stderr
  --help               print this usage

Network: the only network use is the browser navigating to the URL you pass. A local HTML file
and --from-json make none.

Live scan needs, in the current directory's node_modules, @axe-core/playwright or playwright
plus axe-core, and an installed browser (npx playwright install chromium).

Exit codes: 0 no violation at or above --fail-on, 1 at least one, 2 usage error,
3 precondition failure (missing package or browser, unreadable or invalid input, scan error).
`;

  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const say = (s: string): void => {
    (json ? process.stderr : process.stdout).write(s);
  };

  const finish = (code: number, data: object | null, findings: Finding[]): void => {
    process.exitCode = code;
    if (json) {
      process.stdout.write(`${JSON.stringify({ ok: code === 0, data, findings })}\n`);
    }
  };
  const fail = (code: 2 | 3, rule: "usage" | "precondition", message: string): void => {
    process.stderr.write(`axe-scan: ${message}\n`);
    if (code === 2) process.stderr.write(`${USAGE}\n`);
    finish(code, null, [{ rule, message }]);
  };

  /** Parse `--name value` and `--name=value`; returns an error message or the parsed options. */
  const parse = (
    args: string[],
  ): { error: string } | { positional: string[]; opts: Record<string, string> } => {
    const valued = new Set(["--from-json", "--fail-on", "--timeout"]);
    const opts: Record<string, string> = {};
    const positional: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i] ?? "";
      if (a === "--json") continue;
      if (a.startsWith("--")) {
        const eq = a.indexOf("=");
        const name = eq === -1 ? a : a.slice(0, eq);
        if (!valued.has(name)) return { error: `unknown option: ${name}` };
        let value: string | undefined;
        if (eq !== -1) value = a.slice(eq + 1);
        else {
          value = args[i + 1];
          i += 1;
        }
        if (value === undefined || value === "") return { error: `${name} needs a value` };
        opts[name] = value;
      } else positional.push(a);
    }
    return { positional, opts };
  };

  /** Normalise an axe results payload to a violation list; undefined when it is not one. */
  const classify = (payload: unknown): Violation[] | undefined => {
    const items: unknown[] = Array.isArray(payload) ? payload : [payload];
    const byId = new Map<string, Violation>();
    for (const item of items) {
      const list = (item as { violations?: unknown } | null)?.violations;
      if (!Array.isArray(list)) return undefined;
      for (const v of list as Record<string, unknown>[]) {
        if (typeof v?.id !== "string") return undefined;
        // axe leaves impact null on a few rules; ranking it lowest keeps it listed, never dropped.
        const impact = IMPACTS.includes(v.impact as Impact) ? (v.impact as Impact) : "minor";
        const nodes = Array.isArray(v.nodes) ? v.nodes.length : 0;
        const prior = byId.get(v.id);
        if (prior !== undefined) prior.nodes += nodes;
        else
          byId.set(v.id, {
            id: v.id,
            impact,
            help: typeof v.help === "string" ? v.help : "",
            helpUrl: typeof v.helpUrl === "string" ? v.helpUrl : "",
            nodes,
          });
      }
    }
    return [...byId.values()].sort(
      (a, b) => rank(a.impact) - rank(b.impact) || a.id.localeCompare(b.id),
    );
  };

  /** The scan that runs in the child process, with the project's own packages. */
  const CHILD = `
const { createRequire } = require("node:module");
const req = createRequire(process.cwd() + "/noop.js");
const first = (names) => { for (const n of names) { try { return req(n); } catch {} } return undefined; };
(async () => {
  const pw = first(["playwright", "playwright-core", "@playwright/test"]);
  const browser = await pw.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.AXE_SCAN_URL, { waitUntil: "load", timeout: 30000 });
    let results;
    try {
      const mod = req("@axe-core/playwright");
      const AxeBuilder = mod.default || mod.AxeBuilder || mod;
      results = await new AxeBuilder({ page }).analyze();
    } catch (e) {
      if (!/Cannot find module/.test(String(e && e.message))) throw e;
      const axe = req("axe-core");
      await page.addScriptTag({ content: axe.source });
      results = await page.evaluate(() => axe.run());
    }
    process.stdout.write(JSON.stringify({ violations: results.violations }));
  } finally {
    await browser.close();
  }
})().catch((e) => { process.stderr.write(String((e && e.message) || e)); process.exit(1); });
`;

  /** Names the missing package for a live scan, or undefined when the scan can run. */
  const missingPackage = (): { missing: string; install: string } | undefined => {
    const req = nodeModule.createRequire(path.join(process.cwd(), "noop.js"));
    const has = (n: string): boolean => {
      try {
        req.resolve(n);
        return true;
      } catch {
        return false;
      }
    };
    const playwright = ["playwright", "playwright-core", "@playwright/test"].some(has);
    if (has("@axe-core/playwright") && playwright) return undefined;
    if (has("axe-core") && playwright) return undefined;
    if (!playwright) {
      return {
        missing: "playwright",
        install:
          "npm install --save-dev playwright @axe-core/playwright && npx playwright install chromium",
      };
    }
    return {
      missing: "@axe-core/playwright (or axe-core)",
      install: "npm install --save-dev @axe-core/playwright",
    };
  };

  const report = (
    source: string,
    target: string,
    failOn: Impact,
    violations: Violation[],
  ): void => {
    const counts: Record<Impact, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
    const findings: Finding[] = [];
    let blocking = 0;
    let text = `axe-scan: ${target} (fail on ${failOn} or worse)\n`;
    for (const v of violations) {
      counts[v.impact] += 1;
      const fails = rank(v.impact) <= rank(failOn);
      if (fails) blocking += 1;
      const line = `${v.impact} ${v.id}: ${v.help} (${v.helpUrl}) - ${v.nodes} node${v.nodes === 1 ? "" : "s"}`;
      text += `${fails ? "[FAIL]" : "[info]"} ${line}\n`;
      findings.push({
        rule: `axe:${v.id}`,
        message: `${line}: fix the nodes or lower --fail-on if this impact is accepted`,
        severity: fails ? "error" : "warning",
      });
    }
    text += `summary: ${IMPACTS.map((i) => `${counts[i]} ${i}`).join(", ")}\n`;
    say(text);
    finish(blocking > 0 ? 1 : 0, { source, target, fail_on: failOn, counts, violations }, findings);
  };

  const main = (): void => {
    if (argv.includes("--help")) {
      process.stdout.write(HELP);
      return;
    }
    const parsed = parse(argv);
    if ("error" in parsed) return fail(2, "usage", parsed.error);
    const { positional, opts } = parsed;
    const failOn = opts["--fail-on"] ?? "serious";
    if (!IMPACTS.includes(failOn as Impact)) {
      return fail(2, "usage", `--fail-on must be one of ${IMPACTS.join(", ")}, got: ${failOn}`);
    }
    const fromJson = opts["--from-json"];
    if (fromJson !== undefined && positional.length > 0) {
      return fail(2, "usage", "give either a URL or file to scan, or --from-json, not both");
    }
    if (fromJson === undefined && positional.length !== 1) {
      return fail(2, "usage", "exactly one URL or HTML file is required (or --from-json <file>)");
    }
    if (fromJson !== undefined && opts["--timeout"] !== undefined) {
      return fail(2, "usage", "--timeout applies to a live scan only");
    }
    const timeout = Number(opts["--timeout"] ?? "60");
    if (!Number.isFinite(timeout) || timeout <= 0) {
      return fail(2, "usage", "--timeout must be a positive number of seconds");
    }

    if (fromJson !== undefined) {
      let payload: unknown;
      try {
        payload = JSON.parse(fs.readFileSync(fromJson, "utf8"));
      } catch (e) {
        return fail(3, "precondition", `cannot read ${fromJson} as JSON: ${(e as Error).message}`);
      }
      const violations = classify(payload);
      if (violations === undefined) {
        return fail(
          3,
          "precondition",
          `${fromJson} is not an axe results file: expected an object with a violations array (or an array of such objects)`,
        );
      }
      return report("from-json", fromJson, failOn as Impact, violations);
    }

    const target = positional[0] ?? "";
    let pageUrl: string;
    if (/^https?:\/\//i.test(target) || /^file:\/\//i.test(target)) pageUrl = target;
    else if (/^[a-z][a-z0-9+.-]+:/i.test(target)) {
      return fail(
        2,
        "usage",
        `only http, https, file URLs and local file paths are accepted: ${target}`,
      );
    } else {
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
        return fail(3, "precondition", `not a readable HTML file: ${target}`);
      }
      pageUrl = url.pathToFileURL(path.resolve(target)).href;
    }

    const gap = missingPackage();
    if (gap !== undefined) {
      return fail(
        3,
        "precondition",
        `${gap.missing} is not installed in ${process.cwd()}: run \`${gap.install}\`, or classify an existing results file with --from-json`,
      );
    }
    const run = cp.spawnSync(process.execPath, ["-e", CHILD], {
      cwd: process.cwd(),
      env: { ...process.env, AXE_SCAN_URL: pageUrl },
      encoding: "utf8",
      timeout: timeout * 1000,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (run.error !== undefined || run.status !== 0) {
      const detail = (run.error?.message ?? run.stderr ?? "").trim().split("\n")[0] ?? "";
      if (/Executable doesn't exist|browserType\.launch/i.test(run.stderr ?? "")) {
        return fail(
          3,
          "precondition",
          "no Playwright browser is installed: run `npx playwright install chromium`",
        );
      }
      return fail(3, "precondition", `the scan of ${pageUrl} failed: ${detail || "no output"}`);
    }
    let violations: Violation[] | undefined;
    try {
      violations = classify(JSON.parse(run.stdout));
    } catch {
      violations = undefined;
    }
    if (violations === undefined) {
      return fail(3, "precondition", "the scan returned no readable axe results");
    }
    report("scan", pageUrl, failOn as Impact, violations);
  };

  main();
})();
