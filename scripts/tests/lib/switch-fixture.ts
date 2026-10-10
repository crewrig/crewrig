// switch-fixture.ts — the stand-in service backend shared by the switch tests
// (spec 0252 requirement 18).

import type { ServiceBackend } from "../../lib/service/backend.ts";

export const backend: ServiceBackend = {
  kind: "systemd",
  install: () => ({ ok: true }),
  start: () => ({ ok: true }),
  stop: () => ({ ok: true }),
  status: () => ({ registered: true, running: true }),
  uninstall: () => ({ ok: true }),
  supervisorPid: () => ({ state: "none" }),
};
