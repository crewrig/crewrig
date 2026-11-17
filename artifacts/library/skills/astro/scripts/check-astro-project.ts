// check-astro-project.ts — static checks of an Astro project directory.
//
// Usage: node check-astro-project.ts <project-dir> [--json]
//
// Rules (stable ids):
//   no-config              error    no astro.config.{mjs,js,ts,cjs,mts,cts} in the directory
//   site-missing           error    the config uses the sitemap integration but sets no `site`
//   site-missing-warn      warning  the config sets no `site` (canonical URLs and RSS need it)
//   collection-config      error    src/content holds entries but no collection config exists
//   page-no-layout         warning  a src/pages/**/*.astro page has no layout import and no <html>
//   img-missing-alt        error    <img>, <Image> or <Picture> without an alt attribute
//   client-only-bare       error    client:only without a framework value
//
// --help prints the usage on stdout and exits 0. --json prints one object {ok, data, findings}
// on stdout (human text goes to stderr). Exit codes: 0 no error finding, 1 an error finding,
// 2 usage error, 3 the directory cannot be read. Writes nothing, makes no network call.
//
// Self-contained: no import; Node built-ins come from process.getBuiltinModule.
process.removeAllListeners("warning");
const EXIT = Symbol("exit");
void (() => {
  try {
    type Finding = {
      rule: string;
      message: string;
      severity?: "error" | "warning";
      path?: string;
      line?: number;
    };

    const fs = process.getBuiltinModule("node:fs");
    const argv = process.argv.slice(2);
    const json = argv.includes("--json");
    const findings: Finding[] = [];
    const self = (process.argv[1] ?? "").split(/[\\/]/).pop() ?? "check-astro-project.ts";
    const usage = `Usage: node ${self} <project-dir> [--json]`;

    const human = (s: string): void => {
      (json ? process.stderr : process.stdout).write(`${s}\n`);
    };

    const finish = (code: number, data: object | null): never => {
      if (json) {
        process.stdout.write(`${JSON.stringify({ ok: code === 0, data, findings })}\n`);
      }
      process.exitCode = code;
      throw EXIT;
    };

    if (argv.includes("--help")) {
      process.stdout.write(
        `${usage}\n\nChecks an Astro project: config presence, site, content collection config, pages without a layout,\nmissing alt text and bare client:only. Rule ids: no-config, site-missing, site-missing-warn,\ncollection-config, page-no-layout, img-missing-alt, client-only-bare.\n--json prints {ok, data, findings} on stdout. Exit codes: 0 no error finding, 1 an error finding,\n2 usage error, 3 unreadable directory.\n`,
      );
      process.exitCode = 0;
      throw EXIT;
    }

    const args = argv.filter((a) => a !== "--json");
    const unknown = args.filter((a) => a.startsWith("-"));
    if (args.length !== 1 || unknown.length > 0) {
      process.stderr.write(`${usage}\n`);
      findings.push({
        rule: "usage",
        message: "exactly one project directory is required and no other option is accepted",
      });
      finish(2, null);
    }

    const root = (args[0] ?? "").replace(/\/+$/, "") || "/";
    const isDir = (p: string): boolean => {
      try {
        return fs.statSync(p).isDirectory();
      } catch {
        return false;
      }
    };
    const isFile = (p: string): boolean => {
      try {
        return fs.statSync(p).isFile();
      } catch {
        return false;
      }
    };
    if (!isDir(root)) {
      human(`[FAIL] not a readable directory: ${root}`);
      findings.push({ rule: "precondition", message: `not a readable directory: ${root}` });
      finish(3, null);
    }

    const walk = (dir: string, accept: (name: string) => boolean, out: string[] = []): string[] => {
      let names: string[] = [];
      try {
        names = fs.readdirSync(dir).sort();
      } catch {
        return out;
      }
      for (const n of names) {
        if (n === "node_modules" || n.startsWith(".")) continue;
        const p = `${dir}/${n}`;
        let st: import("node:fs").Stats;
        try {
          st = fs.lstatSync(p);
        } catch {
          continue;
        }
        if (st.isDirectory()) walk(p, accept, out);
        else if (st.isFile() && accept(n)) out.push(p);
      }
      return out;
    };

    const add = (f: Finding): void => {
      findings.push(f);
      const sev = f.severity === "warning" ? "WARN" : "ERROR";
      const at =
        f.path !== undefined ? ` ${f.path}${f.line !== undefined ? `:${f.line}` : ""}` : "";
      human(`[${sev}] ${f.rule}${at}: ${f.message}`);
    };

    /** Blank out comments so that commented-out code is not analysed (keeps offsets and lines). */
    const stripComments = (src: string, html: boolean): string => {
      let s = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
      s = s.replace(/(^|\s)\/\/[^\n]*/gm, (m, p: string) => p + " ".repeat(m.length - p.length));
      if (html) s = s.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
      return s;
    };

    const lineOf = (text: string, offset: number): number => {
      let n = 1;
      for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) n++;
      return n;
    };

    // 1. Config
    const configNames = ["mjs", "js", "ts", "cjs", "mts", "cts"].map((e) => `astro.config.${e}`);
    const configName = configNames.find((n) => isFile(`${root}/${n}`));
    if (configName === undefined) {
      add({
        rule: "no-config",
        message: `no astro.config.* file in ${root}: run the check on the project root`,
      });
    } else {
      const cfg = stripComments(fs.readFileSync(`${root}/${configName}`, "utf8"), false);
      const hasSite = /(^|[\s{,])site\s*:/.test(cfg);
      const usesSitemap = /@astrojs\/sitemap/.test(cfg);
      if (!hasSite && usesSitemap) {
        add({
          rule: "site-missing",
          message:
            'the sitemap integration needs the top-level `site` option: add site: "https://..."',
          path: `${root}/${configName}`,
        });
      } else if (!hasSite) {
        add({
          rule: "site-missing-warn",
          message: "no `site` option: canonical URLs, sitemap and RSS links cannot be absolute",
          severity: "warning",
          path: `${root}/${configName}`,
        });
      }
    }

    // 2. Content collections
    const contentDir = `${root}/src/content`;
    const collectionConfigs = [
      `${root}/src/content/config.ts`,
      `${root}/src/content/config.js`,
      `${root}/src/content/config.mjs`,
      `${root}/src/content.config.ts`,
      `${root}/src/content.config.js`,
      `${root}/src/content.config.mjs`,
    ];
    if (isDir(contentDir)) {
      const entries = walk(contentDir, (n) => /\.(md|mdx|markdoc|json|ya?ml)$/.test(n));
      if (entries.length > 0 && !collectionConfigs.some(isFile)) {
        add({
          rule: "collection-config",
          message:
            "src/content holds entries but no collection config: add src/content.config.ts (or src/content/config.ts) with defineCollection and a Zod schema",
          path: contentDir,
        });
      }
    }

    // 3. Pages without a layout
    const pagesDir = `${root}/src/pages`;
    const astroFiles = walk(`${root}/src`, (n) => n.endsWith(".astro"));
    if (isDir(pagesDir)) {
      for (const f of astroFiles.filter((p) => p.startsWith(`${pagesDir}/`))) {
        const text = stripComments(fs.readFileSync(f, "utf8"), true);
        const hasLayout = /import\s+[^;\n]*from\s+["'][^"']*[Ll]ayout[^"']*["']/.test(text);
        const hasHtml = /<html[\s>]/i.test(text);
        // A leading underscore marks a file that is not routed.
        const base = f.split("/").pop() ?? "";
        if (!hasLayout && !hasHtml && !base.startsWith("_")) {
          add({
            rule: "page-no-layout",
            message:
              "page imports no layout and has no <html>: wrap it in a layout so <head>, lang and meta are shared",
            severity: "warning",
            path: f,
          });
        }
      }
    }

    // 4. alt text and client:only, in every .astro file
    const tagRe = /<(img|Image|Picture)(?=[\s/>])/g;
    const endOfTag = (text: string, from: number): number => {
      let depth = 0;
      let quote = "";
      for (let i = from; i < text.length; i++) {
        const c = text[i] ?? "";
        if (quote !== "") {
          if (c === quote) quote = "";
          continue;
        }
        if (c === '"' || c === "'" || (c === "`" && depth > 0)) quote = c;
        else if (c === "{") depth++;
        else if (c === "}") depth = Math.max(0, depth - 1);
        else if (c === ">" && depth === 0) return i;
      }
      return text.length;
    };
    /** Attribute names of the tag source, skipping quoted values and {expressions}. */
    const attrNames = (tag: string): string[] => {
      const names: string[] = [];
      let i = tag.search(/\s/);
      if (i < 0) return names;
      let depth = 0;
      let quote = "";
      let word = "";
      const flush = (): void => {
        if (word !== "") names.push(word);
        word = "";
      };
      for (; i < tag.length; i++) {
        const c = tag[i] ?? "";
        if (quote !== "") {
          if (c === quote) quote = "";
          continue;
        }
        if (depth > 0) {
          if (c === "{") depth++;
          else if (c === "}") depth--;
          continue;
        }
        if (c === '"' || c === "'") quote = c;
        else if (c === "{") {
          depth++;
          flush();
        } else if (/[\s=/>]/.test(c)) {
          if (c === "=") flush();
          else flush();
        } else word += c;
      }
      flush();
      return names;
    };
    for (const f of astroFiles) {
      const raw = fs.readFileSync(f, "utf8");
      const text = stripComments(raw, true);
      for (let m = tagRe.exec(text); m !== null; m = tagRe.exec(text)) {
        const end = endOfTag(text, m.index + m[0].length);
        const tag = text.slice(m.index + 1, end);
        const names = attrNames(tag);
        const hasSpread = /\{\s*\.\.\./.test(tag);
        if (!names.includes("alt") && !hasSpread) {
          add({
            rule: "img-missing-alt",
            message: `<${m[1]}> has no alt attribute: describe the image, or use alt="" when it is decorative`,
            path: f,
            line: lineOf(text, m.index),
          });
        }
      }
      const co = /client:only(?![=\w:-])/g;
      for (let m = co.exec(text); m !== null; m = co.exec(text)) {
        add({
          rule: "client-only-bare",
          message: 'client:only needs the framework name, for example client:only="react"',
          path: f,
          line: lineOf(text, m.index),
        });
      }
    }

    const errors = findings.filter((f) => (f.severity ?? "error") === "error").length;
    const warnings = findings.length - errors;
    if (findings.length === 0) human("[OK] no finding");
    finish(errors > 0 ? 1 : 0, {
      root,
      config: configName ?? null,
      astro_files: astroFiles.length,
      errors,
      warnings,
    });
  } catch (e) {
    if (e !== EXIT) throw e;
  }
})();
