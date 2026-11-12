// check-comment-size.ts — fails when a plan or verdict comment body exceeds 12288 bytes.
//
// Usage: node check-comment-size.ts [--json] [path|-]
// With no path, or `-`, the body is read from stdin. Run it on the comment body before posting;
// CI only checks it against committed fixtures. Budget 12288 bytes (12 KB, UTF-8): a size
// greater than the budget fails; exactly the budget passes. Bytes are the UTF-8 length of the
// content, never a character count.
//
// Exit: 0 within budget, 1 over budget, 2 usage error, 3 unreadable input. With --json it prints
// one {ok, data, findings} object on stdout and the human text on stderr.
// Output: `OK: <n> bytes (budget: 12288 bytes)` on stdout, or an `ERROR:` / `Error:` line on stderr.
// Self-contained on purpose: no import, built-ins through process.getBuiltinModule.
// The repository-root scripts/check-comment-size.ts delegates to this file.

// The body runs inside a function so that these top-level names stay local to the file.
void (() => {
  const fs = process.getBuiltinModule("node:fs");

  const BUDGET = 12288;
  const USAGE =
    "Usage: node check-comment-size.ts [--json] [path|-]\n" +
    "  Checks that a comment body is at most 12288 bytes (UTF-8). Reads stdin when no path or `-`.\n" +
    "  Exit 0 within budget, 1 over budget, 2 usage error, 3 unreadable input.\n";

  interface Finding {
    rule: string;
    message: string;
  }

  function reason(err: unknown): string {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return "No such file or directory";
    if (code === "EACCES") return "Permission denied";
    if (code === "EISDIR") return "Is a directory";
    return err instanceof Error ? err.message : String(err);
  }

  function main(argv: string[]): number {
    let json = false;
    let help = false;
    let usageError: string | undefined;
    const paths: string[] = [];
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i] as string;
      if (a === "--") {
        paths.push(...argv.slice(i + 1));
        break;
      }
      if (a === "--json") json = true;
      else if (a === "--help" || a === "-h") help = true;
      else if (a.length > 1 && a.startsWith("-")) usageError ??= `unknown option ${a}`;
      else paths.push(a);
    }
    const human = (s: string, stream: "stdout" | "stderr"): void => {
      process[json ? "stderr" : stream].write(`${s.replace(/\n$/, "")}\n`);
    };
    const done = (code: number, data: object | null, findings: Finding[]): number => {
      if (json) process.stdout.write(`${JSON.stringify({ ok: code === 0, data, findings })}\n`);
      return code;
    };
    if (help) {
      process.stdout.write(USAGE);
      return 0;
    }
    if (usageError === undefined && paths.length > 1) usageError = "at most one path is accepted";
    if (usageError !== undefined) {
      human(`Error: ${usageError}\n${USAGE}`, "stderr");
      return done(2, null, [{ rule: "usage", message: usageError }]);
    }
    const arg = paths[0];
    let bytes: Buffer;
    try {
      if (arg === undefined || arg === "-") bytes = fs.readFileSync(0);
      else {
        if (fs.statSync(arg).isDirectory())
          throw Object.assign(new Error("Is a directory"), { code: "EISDIR" });
        bytes = fs.readFileSync(arg);
      }
    } catch (err) {
      const message = `${arg === undefined || arg === "-" ? "stdin" : arg}: ${reason(err)}`;
      human(`Error: ${message}`, "stderr");
      return done(3, null, [{ rule: "precondition", message }]);
    }
    const size = bytes.length;
    if (size > BUDGET) {
      human(
        `ERROR: comment is ${size} bytes — over the ${BUDGET}-byte budget.\n` +
          "Move bulk (long evidence, command output) to a linked artifact and keep a reference.",
        "stderr",
      );
      return done(1, { bytes: size, budget: BUDGET }, [
        {
          rule: "over-budget",
          message: `comment is ${size} bytes, over the ${BUDGET}-byte budget; move bulk to a linked artifact`,
        },
      ]);
    }
    human(`OK: ${size} bytes (budget: ${BUDGET} bytes)`, "stdout");
    return done(0, { bytes: size, budget: BUDGET }, []);
  }

  process.exitCode = main(process.argv.slice(2));
})();
