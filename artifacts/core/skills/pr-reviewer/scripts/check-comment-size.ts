// check-comment-size.ts — fails when a plan or verdict comment body exceeds 12288 bytes.
//
// Usage: node check-comment-size.ts [path|-]
// With no argument, or `-`, the body is read from stdin. Author-side tool (spec 0275 R-E2):
// run it on the comment body before posting; CI only checks it against committed fixtures.
// Budget 12288 bytes (12 KB, UTF-8): a size greater than the budget fails; exactly the budget
// passes. Bytes are the UTF-8 length of the content, never a character count.
//
// Exit: 0 within budget, 1 over budget or unreadable input.
// Output: `OK: <n> bytes (budget: 12288 bytes)` on stdout, or an `ERROR:` / `Error:` line on stderr.
// Self-contained on purpose (spec 0289): no import, built-ins through process.getBuiltinModule.
// The repository-root scripts/check-comment-size.ts delegates to this file.

const fs = process.getBuiltinModule("node:fs");

const BUDGET = 12288;

interface SizeOutcome {
  code: 0 | 1;
  stdout: string;
  stderr: string;
}

function reason(err: unknown): string {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ENOENT") return "No such file or directory";
  if (code === "EACCES") return "Permission denied";
  if (code === "EISDIR") return "Is a directory";
  return err instanceof Error ? err.message : String(err);
}

function evaluateCommentSize(content: Uint8Array): SizeOutcome {
  const size = content.length;
  if (size > BUDGET) {
    return {
      code: 1,
      stdout: "",
      stderr:
        `ERROR: comment is ${size} bytes — over the ${BUDGET}-byte budget.\n` +
        "Move bulk (long evidence, command output) to a linked artifact and keep a reference.\n",
    };
  }
  return {
    code: 0,
    stdout: `OK: ${size} bytes (budget: ${BUDGET} bytes)\n`,
    stderr: "",
  };
}

function evaluateCommentSizeOfFile(file: string): SizeOutcome {
  let bytes: Buffer;
  try {
    if (fs.statSync(file).isDirectory())
      throw Object.assign(new Error("Is a directory"), { code: "EISDIR" });
    bytes = fs.readFileSync(file);
  } catch (err) {
    return { code: 1, stdout: "", stderr: `Error: ${file}: ${reason(err)}\n` };
  }
  return evaluateCommentSize(bytes);
}

function evaluateStdin(): SizeOutcome {
  try {
    return evaluateCommentSize(fs.readFileSync(0));
  } catch (err) {
    return { code: 1, stdout: "", stderr: `Error: stdin: ${reason(err)}\n` };
  }
}

const arg = process.argv[2];
const outcome = arg === undefined || arg === "-" ? evaluateStdin() : evaluateCommentSizeOfFile(arg);
if (outcome.stdout !== "") process.stdout.write(`${outcome.stdout.replace(/\n$/, "")}\n`);
if (outcome.stderr !== "") process.stderr.write(`${outcome.stderr.replace(/\n$/, "")}\n`);
process.exitCode = outcome.code;
