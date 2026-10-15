// create-extension.ts — scaffold a new extension from extension-skeleton/ (spec 0258, R23-R25). It
// replaces the shell script of the same name (reduced to a forwarding shim by the switch pull
// request of spec 0258).
//
// Usage: NAME=<name> [TIER=core|library|org] node scripts/create-extension.ts [--components <a,b,...>]
// Components come from `--components`, else from CREWRIG_TEST_FZF_SELECTION (one per line), else
// from a prompt when standard input is a terminal. Run `node scripts/lib/node-floor-guard.js`
// first on an unverified Node.js: the tool needs Node.js 24 or later. It runs only inside the
// repository, so it imports `scripts/lib/`.
//
// ENTRY FORM (spec 0250 R3; spec 0243 R5) — the form of scripts/build-extension.ts, do not "tidy" it
// into an ordinary module: no top-level `import`/`export` (Node.js loads the file as CommonJS and
// prints no MODULE_TYPELESS_PACKAGE_JSON warning), the first statement removes the `warning`
// listeners, no `uncaughtException` handler, and `process.exitCode` rather than `process.exit` so
// that standard output drains.

process.removeAllListeners("warning");

void (async () => {
  try {
    const { main } = await import("./lib/create-extension/main.ts");
    process.exitCode = await main({
      argv: process.argv.slice(2),
      env: process.env,
      entryFile: __filename,
      stdinIsTty: process.stdin.isTTY === true,
      stdin: process.stdin,
      stdout: process.stdout,
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
