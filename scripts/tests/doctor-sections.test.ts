// doctor-sections.test.ts — black-box oracle of `doctor-mempalace` (spec 0252
// requirements 20, 22, 24; plan v3 steps 33 and 35). The TypeScript entry and its bash
// shim are run as processes against an isolated HOME: the three labelled sections, the
// verdict, an exit status that does not depend on the entry, and the absence of the
// fourth section on POSIX. The Windows fourth section (*4. Background service
// mechanism*) is driven in process through the single os-inspect seam and a stand-in
// `schtasks` on POSIX (registered, running and absent states, the prohibiting policy,
// UNDETERMINED, snapshot failure; the exit status never changes), and on win32 through
// the real entry against the real Task Scheduler (no task is created).
// The Windows fourth-section tests live in doctor-sections-windows.test.ts.

import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import { FOURTH, REPO, entries, home, posix } from "./lib/doctor-fixture.ts";

const SECTIONS = [
  "1. What a session actually launches",
  "2. What resolves on your PATH",
  "3. What a fresh setup would select",
  "Verdict",
];

describe("the three sections and the verdict", () => {
  for (const [name, run, skip] of entries) {
    test(
      `${name}: labelled sections, a finding for a missing interpreter, restart note`,
      { skip },
      () => {
        const h = home("missing", {
          mcpServers: {
            mempalace: {
              command: "/nonexistent/python",
              args: [path.join(h0(), "scripts", "mempalace-http-wrapper.py")],
            },
          },
        });
        const r = run(h);
        for (const heading of SECTIONS) assert.ok(r.out.includes(heading), `missing ${heading}`);
        assert.match(
          r.out,
          /MemPalace doctor — which MemPalace will actually answer on this machine/,
        );
        assert.match(r.out, /NOT PRESENT — this CLI has no MCP configuration on this machine/);
        assert.match(r.out, /NOT OK — \d+ finding\(s\):/);
        assert.match(r.out, /NOTE: A memory-server session that is already running keeps serving/);
        assert.equal(r.status, 1);
        // The fourth section is Windows only: present on win32, absent everywhere else.
        assert.equal(r.out.includes(FOURTH), !posix, "the fourth section is Windows only");
      },
    );
  }

  test(
    "an HTTP registration is reported by endpoint, auth is not shown, and is not a finding on its own",
    { skip: !posix },
    () => {
      const h = home("http", {
        mcpServers: {
          mempalace: {
            url: "http://127.0.0.1:41893/mcp",
            headers: { Authorization: "Bearer s3cret" },
          },
        },
      });
      const a = entries[0]![1](h);
      const b = entries[1]![1](h);
      assert.match(a.out, /transport:\s+http \(shared daemon, spec 0113\)/);
      assert.match(a.out, /bearer header present \(value not shown\)/);
      assert.ok(!a.out.includes("s3cret"));
      assert.equal(a.status, b.status, "the shim returns the entry's exit status");
      assert.equal(a.out, b.out, "the shim returns the entry's output");
    },
  );

  test("a registration with no Authorization header is flagged loudly", { skip: !posix }, () => {
    const h = home("noauth", { mcpServers: { mempalace: { url: "http://127.0.0.1:41893/mcp" } } });
    assert.match(entries[0]![1](h).out, /NO Authorization HEADER/);
  });

  test("an unguarded argv is reported and is not a finding on its own", { skip: !posix }, () => {
    const h = home("unguarded", { mcpServers: { mempalace: { command: "echo", args: ["hi"] } } });
    const r = entries[0]![1](h);
    assert.match(r.out, /UNGUARDED — this argv routes through no MemPalace wrapper at all,/);
    assert.ok(!/UNGUARDED[\s\S]*finding[\s\S]*UNGUARDED/.test(r.out));
  });

  test("an interpreter-less wrapper and a missing wrapper are reported", { skip: !posix }, () => {
    const a = home("malformed", {
      mcpServers: { mempalace: { command: "mempalace-http-wrapper.py", args: [] } },
    });
    assert.match(entries[0]![1](a).out, /MALFORMED — the wrapper is the first argv element/);
    const b = home("nowrapper", {
      mcpServers: {
        mempalace: { command: "python3", args: ["/nonexistent/mempalace-http-wrapper.py"] },
      },
    });
    const r = entries[0]![1](b);
    assert.match(
      r.out,
      /WRAPPER MISSING — \/nonexistent\/mempalace-http-wrapper\.py does not resolve/,
    );
    assert.equal(r.status, 1);
  });
});

/** This checkout's `scripts/` directory (a wrapper that exists, so the interpreter is the finding). */
function h0(): string {
  return path.join(REPO, "scripts", "lib");
}
