// framework-release-build.ts — build the archive and the notes of a framework release (spec 0310 R3, R4, R11). It
// reads lib/framework-release/manifest.txt and writes only into --out.
//
// Usage: node scripts/framework-release-build.ts --kind <prerelease|stable> --tag <tag> --out <dir>
//          --workflow-path <.github/workflows/file.yml> [--root <checkout>] [--repository <owner/name>]
// Exit: 0 built, 1 failure (an absent manifest entry included), 2 usage. Run `node scripts/lib/node-floor-guard.js` first
// on an unverified Node.js: the tool needs Node.js 24 or later. Prints `asset=`, `sha256=`; `$GITHUB_OUTPUT` gets both.
//
// ENTRY FORM (spec 0250 R3; spec 0243 R5) — the form of scripts/monorepo-release.ts, do not "tidy" it
// into an ordinary module: no top-level `import`/`export`, the first statement removes the `warning`
// listeners, no `uncaughtException` handler, and `process.exitCode` rather than `process.exit`.

process.removeAllListeners("warning");

void (async () => {
  try {
    const { main } = await import("./lib/framework-release/build-main.ts");
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
