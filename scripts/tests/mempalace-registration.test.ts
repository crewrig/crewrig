// mempalace-registration.test.ts — the pure helpers of the session-start check
// (spec 0246 R1, R5, R7 as amended by delta-01; plan v4 steps 2 and 8, v1-F2).
//
// scripts/lib/mempalace-registration.ts is imported directly. Wherever the
// shell has an equivalent (the launcher endpoint, the configuration path), the
// two are run on the same input in a scratch HOME and must agree.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import {
  CLIS,
  type Cli,
  FIXTURES,
  REPO,
  assertNoCliInvoked,
  bashLib,
  makeSandbox,
} from "./lib/session-check-harness.ts";
import {
  type ChannelSpec,
  type Classification,
  SESSION_CHECK_CHANNELS,
  configPath,
  launcherPath,
  parseLauncher,
  redactUrl,
  render,
  warningFor,
} from "../lib/mempalace-registration.ts";

const EXPECTED = "http://127.0.0.1:41000/mcp";
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe("the expected endpoint comes from the installed launcher only (R1)", () => {
  test("the real template, materialised by install_mcp_launcher on a non-default port, reads the same in both readers (v1-F2)", () => {
    const sb = makeSandbox();
    const dst = path.join(sb.root, "installed-launcher.sh");
    const env = {
      CREWRIG_REPO_DIR: REPO,
      MEMPALACE_PYTHON: "/usr/bin/python3",
      MEMPALACE_MCP_LAUNCHER_PATH: dst,
      MEMPALACE_MCP_PORT: "41000",
    };

    const install = bashLib(sb, "install_mcp_launcher", { env });
    const shell = bashLib(sb, "mcp_installed_endpoint", { env });

    assert.equal(install.status, 0, install.stdout + install.stderr);
    assert.equal(launcherPath(env, sb.home), dst);
    assert.equal(parseLauncher(fs.readFileSync(dst, "utf8"))?.url, EXPECTED);
    assert.equal(shell.stdout.trim(), EXPECTED);
    assertNoCliInvoked(sb);
  });

  test("an unsubstituted template, or a launcher without a port, means no installed daemon in both readers", () => {
    const sb = makeSandbox();
    const template = fs.readFileSync(
      path.join(REPO, "scripts", "lib", "mcp-daemon-launcher.sh"),
      "utf8",
    );
    const cases: Array<[string, string]> = [
      ["placeholders", template],
      ["no MCP_PORT line", 'MCP_HOST="127.0.0.1"\n'],
      ["empty port", 'MCP_HOST="127.0.0.1"\nMCP_PORT=""\n'],
    ];
    for (const [name, text] of cases) {
      const file = path.join(sb.root, `launcher-${name.replace(/\W/g, "-")}.sh`);
      fs.writeFileSync(file, text);

      const shell = bashLib(sb, "mcp_installed_endpoint", {
        env: { MEMPALACE_MCP_LAUNCHER_PATH: file },
      });

      assert.equal(parseLauncher(text), null, name);
      assert.notEqual(shell.status, 0, name);
      assert.equal(shell.stdout, "", name);
    }
  });

  test("the default launcher path is ~/.crewrig/mcp-daemon-launcher.sh, an empty override is ignored", () => {
    assert.equal(launcherPath({}, "/h"), "/h/.crewrig/mcp-daemon-launcher.sh");
    assert.equal(
      launcherPath({ MEMPALACE_MCP_LAUNCHER_PATH: "" }, "/h"),
      "/h/.crewrig/mcp-daemon-launcher.sh",
    );
  });

  test("each CLI's configuration path is the one mcp_assistant_config_path names", () => {
    const sb = makeSandbox();
    for (const cli of CLIS) {
      const shell = bashLib(sb, `mcp_assistant_config_path ${cli}`);
      assert.equal(configPath(cli, sb.home), shell.stdout.trim(), cli);
    }
  });
});

// --- R5 texts ---------------------------------------------------------------------

const ctx = (cli: Cli, serving = true) => ({
  serving,
  expected: EXPECTED,
  config: `~/${path.relative("/h", configPath(cli, "/h"))}`,
});

const CLASSES: Classification[] = [
  { class: "ok" },
  { class: "absent", reason: "no-file" },
  { class: "absent", reason: "no-entry" },
  { class: "stdio" },
  { class: "wrong-endpoint", registered: "http://127.0.0.1:41893/mcp" },
  { class: "unrecognised", reason: "content" },
  { class: "unrecognised", reason: "non-strict" },
];

describe("warning texts (R5 as amended by delta-01)", () => {
  for (const cli of CLIS) {
    test(`${cli}: each class names the CLI and its one repair, within 600 bytes`, () => {
      const w = (c: Classification, serving = true): string | null =>
        warningFor(cli, c, ctx(cli, serving));

      assert.equal(w({ class: "ok" }), null);

      const noFile = w({ class: "absent", reason: "no-file" }) ?? "";
      assert.ok(noFile.includes(`scripts/setup-${cli}-interactive.sh`), noFile);
      assert.ok(
        !noFile.includes("switch-http"),
        `a missing file must not point at switch-http: ${noFile}`,
      );

      for (const c of [
        { class: "absent", reason: "no-entry" },
        { class: "stdio" },
      ] as Classification[]) {
        const text = w(c) ?? "";
        assert.ok(text.includes("task mempalace:switch-http") && /restart/.test(text), text);
        assert.ok(!text.includes("mempalace:repair"), text);
      }
      assert.match(w({ class: "stdio" }) ?? "", /refused/);
      assert.match(w({ class: "absent", reason: "no-entry" }) ?? "", /unavailable/);

      const wrong = w({ class: "wrong-endpoint", registered: "http://127.0.0.1:41893/mcp" }) ?? "";
      for (const part of [
        "wrong-endpoint",
        "http://127.0.0.1:41893/mcp",
        EXPECTED,
        "task mempalace:switch-http",
      ]) {
        assert.ok(wrong.includes(part), `${part} missing: ${wrong}`);
      }

      const content = w({ class: "unrecognised", reason: "content" }) ?? "";
      assert.ok(content.includes("task mempalace:repair"), content);
      assert.ok(!content.includes("not a single strict JSON document"), content);

      for (const c of CLASSES) {
        const text = w(c);
        if (text === null) continue;
        assert.ok(text.includes(cli), `${c.class}: ${text}`);
        assert.ok(Buffer.byteLength(text) <= 600, `${c.class}: ${Buffer.byteLength(text)} bytes`);
      }
    });

    test(`${cli}: a daemon that is not serving gets one warning naming task mempalace:status, except for stdio`, () => {
      for (const c of CLASSES) {
        const text = warningFor(cli, c, ctx(cli, false));
        if (c.class === "stdio") {
          assert.equal(
            text,
            null,
            "stdio with no serving daemon is setup's intended fallback (R6)",
          );
        } else {
          assert.ok(
            text !== null && text.includes("task mempalace:status") && text.includes(cli),
            `${c.class}: ${text}`,
          );
          assert.ok(Buffer.byteLength(text) <= 600);
        }
      }
    });
  }

  test("the 600-byte cap holds with an oversized path, endpoint and registered URL, and keeps the repair", () => {
    const longPath = `~/${"d/".repeat(300)}settings.json`;
    const fat = "\u{1F600}".repeat(120); // 480 bytes of variable text, as redactUrl may return
    const big = { serving: true, expected: `http://${"h".repeat(64)}:65535/mcp`, config: longPath };
    const repairs: Array<[Classification, string]> = [
      [{ class: "absent", reason: "no-file" }, "setup-"],
      [{ class: "absent", reason: "no-entry" }, "task mempalace:switch-http"],
      [{ class: "stdio" }, "task mempalace:switch-http"],
      [{ class: "wrong-endpoint", registered: fat }, "task mempalace:switch-http"],
      [{ class: "unrecognised", reason: "content" }, "task mempalace:repair"],
      [{ class: "unrecognised", reason: "non-strict" }, "task mempalace:switch-http"],
    ];
    for (const cli of CLIS) {
      for (const [c, repair] of repairs) {
        const text = warningFor(cli, c, big) ?? "";
        assert.ok(
          Buffer.byteLength(text) <= 600,
          `${cli} ${c.class}: ${Buffer.byteLength(text)} bytes`,
        );
        assert.ok(text.includes(repair), `${cli} ${c.class} lost its repair: ${text}`);
        assert.ok(
          !LONE_SURROGATE.test(text),
          `${cli} ${c.class}: truncation split a surrogate pair`,
        );
      }
      const down =
        warningFor(cli, { class: "absent", reason: "no-entry" }, { ...big, serving: false }) ?? "";
      assert.ok(Buffer.byteLength(down) <= 600 && down.includes("task mempalace:status"), down);
    }
  });
});

// --- redaction (plan v4 Contracts, v4-F5) ------------------------------------------

describe("redactUrl", () => {
  test("every pair of redaction-vectors.json", () => {
    const { vectors } = JSON.parse(
      fs.readFileSync(path.join(FIXTURES, "redaction-vectors.json"), "utf8"),
    ) as {
      vectors: Array<{ name: string; input: string; expected: string }>;
    };
    assert.ok(vectors.length >= 8);

    const diffs = vectors
      .filter((v) => redactUrl(v.input) !== v.expected)
      .map((v) => `${v.name}: ${JSON.stringify(redactUrl(v.input))}`);

    assert.deepEqual(diffs, []);
  });
});

// --- output channels (R7, v1-F5) ---------------------------------------------------

/** The value at a dotted field path, or undefined. */
function at(obj: unknown, field: string): unknown {
  return field.split(".").reduce<unknown>((o, k) => {
    // `name[]` steps into the array's single element (Antigravity's injectSteps).
    const list = k.endsWith("[]");
    const v =
      o !== null && typeof o === "object"
        ? (o as Record<string, unknown>)[list ? k.slice(0, -2) : k]
        : undefined;
    if (!list) return v;
    return Array.isArray(v) && v.length === 1 ? v[0] : undefined;
  }, obj);
}

/** Every string leaf of a JSON value, with its path; array steps are written `name[]`. */
function leaves(obj: unknown, prefix = ""): Array<[string, string]> {
  if (typeof obj === "string") return [[prefix, obj]];
  if (Array.isArray(obj)) return obj.flatMap((v) => leaves(v, `${prefix}[]`));
  if (obj === null || typeof obj !== "object") return [];
  return Object.entries(obj).flatMap(([k, v]) => leaves(v, prefix === "" ? k : `${prefix}.${k}`));
}

describe("render (R7)", () => {
  const W = "MemPalace: a warning";

  for (const cli of CLIS) {
    test(`${cli}: the warning lands on exactly the channels SESSION_CHECK_CHANNELS names`, () => {
      const spec = SESSION_CHECK_CHANNELS[cli];

      const out = render(cli, W);

      assert.equal(render(cli, null), "");
      if (spec.user === null && spec.model === null) {
        assert.equal(out, "");
        return;
      }
      assert.ok(out.endsWith("\n"));
      const parsed: unknown = JSON.parse(out);
      const fields = [spec.user, spec.model].filter((f): f is string => f !== null);
      for (const f of fields) assert.equal(at(parsed, f), W, f);
      const warningLeaves = leaves(parsed)
        .filter(([, v]) => v === W)
        .map(([p]) => p);
      assert.deepEqual(warningLeaves.sort(), [...fields].sort());
      if (fields.some((f) => f.startsWith("hookSpecificOutput."))) {
        assert.equal(at(parsed, "hookSpecificOutput.hookEventName"), spec.event);
      }
    });
  }

  test("a CLI with one channel nulled emits only the other; with both nulled, nothing (v1-F5)", () => {
    const table = SESSION_CHECK_CHANNELS as Record<Cli, ChannelSpec>;
    const saved = table.claude;
    try {
      table.claude = {
        event: "SessionStart",
        user: null,
        model: "hookSpecificOutput.additionalContext",
      };
      assert.deepEqual(JSON.parse(render("claude", W)), {
        hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: W },
      });
      table.claude = { event: "SessionStart", user: "systemMessage", model: null };
      assert.deepEqual(JSON.parse(render("claude", W)), { systemMessage: W });
      table.claude = { event: "SessionStart", user: null, model: null };
      assert.equal(render("claude", W), "");
    } finally {
      table.claude = saved;
    }
  });
});
