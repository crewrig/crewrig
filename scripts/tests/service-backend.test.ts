// service-backend.test.ts — scripts/lib/service/backend.ts (spec 0252
// requirement 5): platform selection and the unsupported-OS error.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  UNSUPPORTED_OS_MESSAGE,
  UnsupportedOsError,
  backendKindFor,
  selectBackend,
  type BackendKind,
  type ServiceBackend,
} from "../lib/service/backend.ts";

function stub(kind: BackendKind): ServiceBackend {
  const ok = { ok: true } as const;
  return {
    kind,
    install: () => ok,
    start: () => ok,
    stop: () => ok,
    status: () => ({ registered: true, running: false }),
    uninstall: () => ok,
    supervisorPid: () => ({ state: "none" }),
  };
}

const loaded: BackendKind[] = [];
const load = (kind: BackendKind): Promise<unknown> => {
  loaded.push(kind);
  return Promise.resolve({ createBackend: () => stub(kind) });
};

test("each platform selects its backend and loads only that module", async () => {
  for (const [platform, kind] of [
    ["darwin", "launchd"],
    ["linux", "systemd"],
    ["win32", "schtasks"],
  ] as const) {
    loaded.length = 0;
    assert.equal((await selectBackend(platform, load)).kind, kind);
    assert.deepEqual(loaded, [kind]);
  }
});

test("an unsupported platform raises the shell's wording and loads nothing", async () => {
  loaded.length = 0;
  for (const platform of ["freebsd", "aix", "sunos", ""]) {
    await assert.rejects(selectBackend(platform, load), (err: unknown) => {
      assert.ok(err instanceof UnsupportedOsError);
      assert.equal(
        err.message,
        "MCP daemon: unsupported OS — manage the supervisor unit manually.",
      );
      return true;
    });
    assert.equal(backendKindFor(platform), null);
  }
  assert.equal(
    UNSUPPORTED_OS_MESSAGE,
    "MCP daemon: unsupported OS — manage the supervisor unit manually.",
  );
  assert.deepEqual(loaded, []);
});

test("a module without a conforming createBackend is refused", async () => {
  await assert.rejects(
    selectBackend("linux", () => Promise.resolve({})),
    /no createBackend/,
  );
  await assert.rejects(
    selectBackend("linux", () => Promise.resolve({ createBackend: () => ({}) })),
    /did not return/,
  );
  await assert.rejects(
    selectBackend("linux", () => Promise.resolve({ createBackend: () => stub("launchd") })),
    /did not return a systemd backend/,
  );
});
