// framework-release-guard.ts — the guards of a framework release job (spec 0310 R1, R6, R7, R12). It
// writes nothing to the forge: it fetches `origin/<release branch>` and `origin/main` itself.
//
// Usage: node scripts/framework-release-guard.ts --kind prerelease --tag <tag> [--commit <sha>] [--repo <dir>]
//        node scripts/framework-release-guard.ts --kind stable --version <X.Y.Z> --ref <ref> --releases-json <file>
//          [--commit <sha>] [--repo <dir>]
// Exit: 0 every guard holds, 1 a guard fails, 2 usage. Run `node scripts/lib/node-floor-guard.js` first
// on an unverified Node.js: the tool needs Node.js 24 or later.
//
// ENTRY FORM (spec 0250 R3; spec 0243 R5) — the form of scripts/monorepo-release.ts, do not "tidy" it
// into an ordinary module: no top-level `import`/`export`, the first statement removes the `warning`
// listeners, no `uncaughtException` handler, and `process.exitCode` rather than `process.exit`.

process.removeAllListeners("warning");

void (async () => {
  try {
    const { main } = await import("./lib/framework-release/guard-main.ts");
    process.exitCode = main(process.argv.slice(2), {
      out: (line: string) => void process.stdout.write(`${line}\n`),
      err: (line: string) => void process.stderr.write(`${line}\n`),
    });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    const shown = Array.from(text, (ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f ? `\\x${code.toString(16).padStart(2, "0")}` : ch;
    }).join("");
    process.stderr.write(`Error: ${shown}\n`);
    process.exitCode = 1;
  }
})();
