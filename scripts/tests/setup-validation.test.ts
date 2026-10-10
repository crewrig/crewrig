// setup-validation.test.ts — the validation backend of the setup graph (spec 0256 requirement 23),
// compared with the bytes the shell wrote in the PR A goldens.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { Env, Io } from "../lib/extension/types.ts";
import { SetupExit } from "../lib/setup/exit.ts";
import { configureValidationBackend } from "../lib/setup/validation-backend.ts";
import type { ValidationSession } from "../lib/setup/validation-backend.ts";

const GOLDEN = path.join(
  import.meta.dirname,
  "fixtures/setup-golden/claude/default-answers/tree.json.golden",
);

/** The sha256 the shell recorded for `<HOME>/.crewrig/validation.conf` in the default-answers case. */
function goldenHash(): string {
  const tree: unknown = JSON.parse(fs.readFileSync(GOLDEN, "utf8"));
  const entries: unknown =
    typeof tree === "object" && tree !== null ? Reflect.get(tree, "tree") : undefined;
  const rows = Array.isArray(entries) ? entries : [];
  for (const row of rows as unknown[]) {
    if (typeof row !== "object" || row === null) continue;
    if (Reflect.get(row, "path") === "<HOME>/.crewrig/validation.conf") {
      const sha: unknown = Reflect.get(row, "sha256");
      if (typeof sha === "string") return sha;
    }
  }
  throw new Error("validation.conf not found in the golden");
}

const sha256 = (file: string): string =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");

describe("validation backend", () => {
  let home: string;
  let out: string[];
  let err: string[];
  let io: Io;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "setup-validation-"));
    out = [];
    err = [];
    io = {
      out: (line) => void out.push(line),
      err: (line) => void err.push(line),
      errRaw: (text) => void err.push(text),
    };
  });
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

  const conf = (): string => path.join(home, ".crewrig", "validation.conf");
  const run = (
    env: Env,
    answers: readonly (string | undefined)[] = [],
    hasCommand = () => false,
  ) => {
    const asked: string[] = [];
    const queue = [...answers];
    const session: ValidationSession = {
      choose: async (q) => {
        asked.push(`${q.id}|${q.cancel}|${q.header}|${q.options.join(",")}`);
        return queue.shift();
      },
    };
    const ctx = { io, env, platform: process.platform, home };
    return { asked, done: configureValidationBackend({ ctx, session, hasCommand }) };
  };

  it("asks the four questions and, on cancel, writes the shell's default bytes", async () => {
    const { asked, done } = run({}, [undefined, undefined, undefined, undefined]);
    await done;
    assert.deepEqual(asked, [
      "validation.backend|default|Validation backend? (internal = built-in AskUserQuestion prompt; plannotator = rich browser review, opt-in)|internal,plannotator",
      "validation.translate|default|Translate the spec/plan into your preferred language for the gate presentation only? (the repo artifact stays English)|off,on",
      "validation.pedagogy|default|Pedagogy level for validation requests? (simple / contextual / professor)|contextual,simple,professor",
      "validation.illustration|default|Generate illustrations for reviews? (honoured only with the plannotator backend + a browser surface)|off,on",
    ]);
    assert.equal(
      fs.readFileSync(conf(), "utf8"),
      "# crewrig user-gate validation backend (spec 0080)\n" +
        "# Per-user, machine-local; not a committed layer file. Read by the user-validate skill.\n" +
        "backend=internal\ntranslate=off\npedagogy=contextual\nillustration=off\n",
    );
    assert.equal(sha256(conf()), goldenHash());
    assert.deepEqual(out, [
      "",
      "User-gate validation backend (spec 0080):",
      "  Validation backend recorded: backend=internal translate=off pedagogy=contextual illustration=off",
      `    -> ${conf()}`,
    ]);
    assert.deepEqual(err, []);
  });

  it("records the chosen answers", async () => {
    await run({}, ["plannotator", "on", "professor", "on"]).done;
    assert.equal(
      fs.readFileSync(conf(), "utf8").split("\n").slice(2).join("\n"),
      "backend=plannotator\ntranslate=on\npedagogy=professor\nillustration=on\n",
    );
  });

  it("bypasses every question when one VALIDATION_* variable is set, defaulting the others", async () => {
    for (const [name, line] of [
      [
        "VALIDATION_BACKEND",
        "backend=plannotator\ntranslate=off\npedagogy=contextual\nillustration=off",
      ],
      [
        "VALIDATION_TRANSLATE",
        "backend=internal\ntranslate=on\npedagogy=contextual\nillustration=off",
      ],
      ["VALIDATION_PEDAGOGY", "backend=internal\ntranslate=off\npedagogy=simple\nillustration=off"],
      [
        "VALIDATION_ILLUSTRATION",
        "backend=internal\ntranslate=off\npedagogy=contextual\nillustration=on",
      ],
    ] as const) {
      const value = line.split("\n").find((l) => l.startsWith(name.slice(11).toLowerCase() + "="));
      const { asked, done } = run({ [name]: value?.split("=")[1] }, [], () => true);
      await done;
      assert.deepEqual(asked, [], name);
      assert.equal(fs.readFileSync(conf(), "utf8").split("\n").slice(2, 6).join("\n"), line, name);
    }
    assert.ok(!out.includes(""), "no blank line or title in the bypass");
  });

  it("treats an empty VALIDATION_* variable as unset", async () => {
    const { asked, done } = run({ VALIDATION_BACKEND: "" }, [
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    await done;
    assert.equal(asked.length, 4);
  });

  it("matches the golden bytes on the bypass path too", async () => {
    await run({ VALIDATION_TRANSLATE: "off" }).done;
    assert.equal(sha256(conf()), goldenHash());
  });

  for (const [name, bad, text] of [
    [
      "VALIDATION_BACKEND",
      "gnome",
      "  ERROR: invalid validation backend 'gnome' (want: internal|plannotator)",
    ],
    ["VALIDATION_TRANSLATE", "yes", "  ERROR: invalid validation translate 'yes' (want: on|off)"],
    [
      "VALIDATION_PEDAGOGY",
      "pro",
      "  ERROR: invalid validation pedagogy 'pro' (want: simple|contextual|professor)",
    ],
    ["VALIDATION_ILLUSTRATION", "1", "  ERROR: invalid validation illustration '1' (want: on|off)"],
  ] as const) {
    it(`prints the ${name} enum error on stdout and exits 1 without writing`, async () => {
      await assert.rejects(
        run({ [name]: bad }).done,
        (error: unknown) => error instanceof SetupExit && error.status === 1,
      );
      assert.deepEqual(out, [text]);
      assert.deepEqual(err, []);
      assert.ok(!fs.existsSync(conf()));
    });
  }

  it("leaves an existing file byte-unchanged on an invalid value", async () => {
    await run({ VALIDATION_BACKEND: "plannotator" }, [], () => true).done;
    const before = fs.readFileSync(conf());
    await assert.rejects(run({ VALIDATION_PEDAGOGY: "x" }).done);
    assert.deepEqual(fs.readFileSync(conf()), before);
  });

  it(
    "writes mode 0644, replaces the file idempotently and leaves no temporary file",
    { skip: process.platform === "win32" },
    async () => {
      await run({ VALIDATION_BACKEND: "internal" }).done;
      const first = fs.readFileSync(conf());
      assert.equal(fs.statSync(conf()).mode & 0o777, 0o644);
      await run({ VALIDATION_BACKEND: "internal" }).done;
      assert.deepEqual(fs.readFileSync(conf()), first);
      assert.equal(fs.statSync(conf()).mode & 0o777, 0o644);
      assert.deepEqual(fs.readdirSync(path.dirname(conf())), ["validation.conf"]);
      await run({ VALIDATION_BACKEND: "plannotator" }, [], () => true).done;
      assert.match(fs.readFileSync(conf(), "utf8"), /backend=plannotator\n/);
    },
  );

  it("prints the plannotator guidance, and the PATH note only when the binary is absent", async () => {
    await run({ VALIDATION_BACKEND: "plannotator" }, [], () => false).done;
    assert.deepEqual(out.slice(2), [
      "  Plannotator backend selected. Install the binary if it is not present:",
      "    curl -fsSL https://plannotator.ai/install.sh | bash",
      "  Note: 'plannotator' is not on PATH yet — until it is installed, gates",
      "        fall back to the 'internal' backend at gate time (spec 0080 R4).",
    ]);
    out.length = 0;
    await run({ VALIDATION_BACKEND: "plannotator" }, [], () => true).done;
    assert.equal(out.length, 4);
  });

  it(
    "finds the binary on the PATH of the context by default",
    { skip: process.platform === "win32" },
    async () => {
      const bin = path.join(home, "bin");
      fs.mkdirSync(bin);
      fs.writeFileSync(path.join(bin, "plannotator"), "#!/bin/sh\n", { mode: 0o755 });
      const ctx = {
        io,
        env: { VALIDATION_BACKEND: "plannotator", PATH: `/nonexistent:${bin}` },
        platform: process.platform,
        home,
      };
      await configureValidationBackend({ ctx, session: { choose: async () => undefined } });
      assert.equal(out.length, 4);
      out.length = 0;
      await configureValidationBackend({
        ctx: { ...ctx, env: { VALIDATION_BACKEND: "plannotator", PATH: "/nonexistent" } },
        session: { choose: async () => undefined },
      });
      assert.equal(out.length, 6);
    },
  );
});
