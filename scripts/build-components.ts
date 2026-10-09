// build-components.ts — compile every artifact tier for the four supported CLIs and
// check the committed outputs against their sources (ADR-0011, spec 0019; ported by
// spec 0250). It replaces the shell tool of the same name, which stays as a
// forwarding shim.
//
// Usage: node scripts/build-components.ts [--target gemini|claude|copilot|antigravity|all]
//          [--tier <name>]... [--check] [--list-output-dirs]
//          [--resolve <source> <target>] [--diagnostics <path>]
// Run `node scripts/lib/node-floor-guard.js` first on an unverified Node.js: the
// tool needs Node.js 24 or later. The one third-party package it reads YAML with,
// `js-yaml`, comes from the setup dependency step.
//
// The modules live under scripts/lib/build-components/, one concern per file;
// `main.ts` there holds the order of operations and the exit codes.
//
// ENTRY FORM (spec 0250 R3; spec 0243 R5) — do not "tidy" it into an ordinary module:
//  - No top-level `import`/`export` and nothing declared at global scope, so
//    Node.js loads the file as CommonJS and prints no
//    MODULE_TYPELESS_PACKAGE_JSON warning for it. The module graph comes from
//    `import()`, and `js-yaml` is loaded there, after `--list-output-dirs` has
//    answered, so that flag works with no YAML library on the machine.
//  - The first statement removes the `warning` listeners, which silences the
//    entry's own deferred warning and that of every module loaded below.
//  - No `uncaughtException` handler: it would blind the deprecation channel.
//  - `process.exitCode`, never `process.exit`: standard output drains first.

process.removeAllListeners("warning");

void (async () => {
  try {
    const { main } = await import("./lib/build-components/main.ts");
    process.exitCode = await main({
      argv: process.argv.slice(2),
      env: process.env,
      platform: process.platform,
      entryFile: __filename,
      io: {
        out: (line: string) => void process.stdout.write(`${line}\n`),
        err: (line: string) => void process.stderr.write(`${line}\n`),
        errRaw: (text: string) => void process.stderr.write(text),
      },
    });
  } catch (error) {
    // A path inside the message may hold a control character: show it as `\xNN`.
    const text = error instanceof Error ? error.message : String(error);
    const shown = Array.from(text, (ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f ? `\\x${code.toString(16).padStart(2, "0")}` : ch;
    }).join("");
    process.stderr.write(`Error: ${shown}\n`);
    process.exitCode = 1;
  }
})();
